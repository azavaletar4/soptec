import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readHostWifiSignal, type FirmwareIdentity } from '../tr069HostsSignal';
import { hostStatusLabel, hostWifiSignalPresentation, type HostEntry } from '../../../../src/lib/tr069Hosts';

const at = '2026-10-28T22:03:39.213Z', now = Date.parse(at) + 1000;
const mac = 'aa:bb:cc:dd:ee:01', wlan = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';
const leaf = (value: unknown) => ({ _value: value, _timestamp: at });
// Identidad real verificada (ver tr069HostsSignal.ts): única combinación donde
// X_HW_RSSI se interpreta como dBm sin que el equipo declare la unidad.
const VERIFIED_IDENTITY: FirmwareIdentity = { oui: '00259E', productClass: 'HG8145X6-13', softwareVersion: 'V5R023C00S342' };

function fixture(dbm = -60, unit: string | null = 'dBm') {
  const raw = { MACAddress: leaf(mac), Layer2Interface: leaf(wlan) };
  const associated = { AssociatedDeviceMACAddress: leaf(mac.toUpperCase()), SignalStrength: leaf(dbm), ...(unit ? { SignalStrengthUnit: leaf(unit) } : {}) };
  const wlans = { 1: { AssociatedDevice: { 1: associated } } };
  const signal = readHostWifiSignal(raw, wlans);
  const row: HostEntry = { hostName: 'Equipo', ipAddress: null, macAddress: mac, connection: 'WiFi', connectionReportedAt: at,
    macReportedAt: at, layer2Interface: wlan, layer2ReportedAt: at, active: true, activeReportedAt: at, band: null, reportedAt: at, wifiSignal: signal };
  return { raw, associated, wlans, row };
}
// Variante con X_HW_RSSI directo en el propio Host (como lo reporta la Huawei
// real), para probar el alcance verificado por fabricante+modelo+firmware.
function xhwFixture(dbm: number, identity: FirmwareIdentity | undefined, mac2 = mac) {
  const raw = { MACAddress: leaf(mac2), Layer2Interface: leaf(wlan), X_HW_RSSI: leaf(dbm) };
  const wlans = { 1: { AssociatedDevice: {} } };
  const signal = readHostWifiSignal(raw, wlans, identity);
  const row: HostEntry = { hostName: 'Equipo', ipAddress: null, macAddress: mac2, connection: 'WiFi', connectionReportedAt: at,
    macReportedAt: at, layer2Interface: wlan, layer2ReportedAt: at, active: true, activeReportedAt: at, band: null, reportedAt: at, wifiSignal: signal };
  return { raw, wlans, row };
}

test('señal simulada con MAC/WLAN y unidad explícita: intensidad dBm, cuatro niveles orientativos sin porcentaje', () => {
  for (const [dbm, level] of [
    [-30, 'excellent'], [-55, 'excellent'], [-56, 'good'], [-60, 'good'], [-67, 'good'],
    [-68, 'fair'], [-75, 'fair'], [-76, 'poor'], [-100, 'poor'],
  ] as const) {
    const { row } = fixture(dbm);
    assert.deepEqual(hostWifiSignalPresentation(row, at, now), { label: `${dbm} dBm`, level });
    assert.ok(!hostWifiSignalPresentation(row, at, now).label.includes('%'));
    assert.ok(!/mbps|kbps|velocidad/i.test(hostWifiSignalPresentation(row, at, now).label));
  }
});

test('X_HW_RSSI en el firmware verificado (Huawei HG8145X6-13 / V5R023C00S342): sí se interpreta como dBm, con los cuatro niveles', () => {
  for (const [dbm, level] of [[-39, 'excellent'], [-55, 'excellent'], [-56, 'good'], [-67, 'good'], [-68, 'fair'], [-75, 'fair'], [-76, 'poor']] as const) {
    const { row } = xhwFixture(dbm, VERIFIED_IDENTITY);
    assert.ok(row.wifiSignal, `dbm=${dbm} debería producir señal verificada`);
    assert.deepEqual(hostWifiSignalPresentation(row, at, now), { label: `${dbm} dBm`, level });
  }
});

test('el mismo X_HW_RSSI en un modelo o firmware NO verificado nunca se interpreta como dBm — la regla no se generaliza', () => {
  const variants: (FirmwareIdentity | undefined)[] = [
    undefined, // identidad desconocida/no proyectada
    { oui: null, productClass: null, softwareVersion: null },
    { ...VERIFIED_IDENTITY, softwareVersion: 'V5R023C00S999' }, // mismo modelo, otro firmware
    { ...VERIFIED_IDENTITY, productClass: 'HG8145V5' }, // otro modelo Huawei
    { ...VERIFIED_IDENTITY, oui: '001122' }, // otro fabricante/OUI
    { oui: '00259E', productClass: 'HG8145X6-13', softwareVersion: '' },
  ];
  for (const identity of variants) {
    const { row } = xhwFixture(-40, identity);
    assert.equal(row.wifiSignal, null, 'sin verificación exacta de oui+modelo+firmware, nunca se interpreta la unidad');
    assert.equal(hostWifiSignalPresentation(row, at, now).label, 'No disponible');
  }
});

test('en el firmware verificado, RSSI/SignalStrength genéricos SIGUEN exigiendo unidad explícita (la excepción es solo para X_HW_RSSI)', () => {
  const raw = { MACAddress: leaf(mac), Layer2Interface: leaf(wlan) };
  const associated = { AssociatedDeviceMACAddress: leaf(mac.toUpperCase()), SignalStrength: leaf(-40) }; // sin SignalStrengthUnit
  const wlans = { 1: { AssociatedDevice: { 1: associated } } };
  assert.equal(readHostWifiSignal(raw, wlans, VERIFIED_IDENTITY), null, 'SignalStrength sin unidad sigue sin ser verificable, aun en firmware confiable para X_HW_RSSI');
});

test('RSSI sin unidad verificada, porcentajes, valores imposibles o señal ausente: No disponible', () => {
  for (const [value, unit] of [[-60, null], [70, '%'], [15, 'dBm'], [-121, 'dBm']] as const) {
    const { row } = fixture(value, unit); assert.equal(row.wifiSignal, null);
    assert.equal(hostWifiSignalPresentation(row, at, now).label, 'No disponible');
  }
  const f = fixture(); assert.equal(hostWifiSignalPresentation({ ...f.row, wifiSignal: null }, at, now).label, 'No disponible');
});

test('nunca mezcla señal de otra MAC, otra interfaz WLAN o asociaciones ambiguas', () => {
  const f = fixture();
  f.associated.AssociatedDeviceMACAddress = leaf('AA:BB:CC:DD:EE:FF'); assert.equal(readHostWifiSignal(f.raw, f.wlans), null);
  const g = fixture(); g.raw.Layer2Interface = leaf(wlan.replace('WLANConfiguration.1', 'WLANConfiguration.5')); assert.equal(readHostWifiSignal(g.raw, g.wlans), null);
  const h = fixture(); (h.wlans[1].AssociatedDevice as any)[2] = { ...h.associated }; assert.equal(readHostWifiSignal(h.raw, h.wlans), null);
  const i = fixture(); assert.equal(hostWifiSignalPresentation({ ...i.row, macAddress: 'AA:BB:CC:DD:EE:FF' }, at, now).label, 'No disponible');
});

test('señal o vínculo antiguo/inválido, equipo sin confirmar o desconectado no se presenta como intensidad actual', () => {
  const { row } = fixture();
  assert.equal(hostWifiSignalPresentation(row, at, now + 11 * 60_000).label, 'No disponible');
  for (const field of ['macReportedAt', 'layer2ReportedAt', 'activeReportedAt', 'connectionReportedAt'] as const) {
    assert.equal(hostWifiSignalPresentation({ ...row, [field]: null }, at, now).label, 'No disponible');
  }
  assert.equal(hostWifiSignalPresentation({ ...row, active: false }, at, now).label, 'No disponible');
  assert.equal(hostWifiSignalPresentation({ ...row, wifiSignal: { ...row.wifiSignal!, macReportedAt: 'invalid' } }, at, now).label, 'No disponible');
});

test('Ethernet confirmado: No aplica; nunca interpreta RSSI ajeno como WiFi', () => {
  const { row } = fixture(); assert.deepEqual(hostWifiSignalPresentation({ ...row, connection: 'Cable' }, at, now), { label: 'No aplica', level: null });
});

test('caso real confirmado (29/10): S26-Ultra conectado por WiFi, X_HW_RSSI=-40 real, firmware verificado por el cruce con la propia ONT (-39 dBm) — ahora SÍ se muestra la señal', () => {
  const cache = JSON.parse(fs.readFileSync(new URL('../../../../docs/TR069-HOSTS-SIGNAL-CACHE-20261029.json', import.meta.url), 'utf8'));
  // La investigación original sigue siendo válida: ni X_HW_RSSIUnit, RSSI,
  // RSSIUnit, SignalStrength ni SignalStrengthUnit existen en ningún Host —
  // la unidad nunca la declara el equipo; se confirmó por otra vía (ver
  // cache.ontOwnInterfaceCrossCheck) y solo para esta identidad exacta.
  for (const suffix of ['X_HW_RSSIUnit', 'RSSI', 'RSSIUnit', 'SignalStrength', 'SignalStrengthUnit']) {
    assert.ok(cache.hostLeaves.filter((l: any) => l.path.endsWith('.' + suffix)).every((l: any) => !l.valuePresent),
      suffix + ' nunca declarado con valor en este equipo');
  }
  assert.equal(cache.identity.oui, VERIFIED_IDENTITY.oui);
  assert.equal(cache.identity.productClass, VERIFIED_IDENTITY.productClass);
  assert.equal(cache.identity.softwareVersion, VERIFIED_IDENTITY.softwareVersion);
  assert.equal(cache.ontOwnInterfaceCrossCheck.tr069XHwRssi, -40);
  assert.equal(cache.ontOwnInterfaceCrossCheck.ontInterfaceRssiDbm, -39);

  const byHost = (i: number) => {
    const field = (name: string) => cache.hostLeaves.find((l: any) => l.path === `InternetGatewayDevice.LANDevice.1.Hosts.Host.${i}.${name}`);
    const leaf = (name: string) => { const l = field(name); return l?.valuePresent ? { _value: l.value, _timestamp: l.timestamp, _type: l.type } : {}; };
    return {
      MACAddress: leaf('MACAddress'), Layer2Interface: leaf('Layer2Interface'),
      X_HW_RSSI: leaf('X_HW_RSSI'), Active: leaf('Active'), InterfaceType: leaf('InterfaceType'), HostName: leaf('HostName'),
    };
  };
  const wlans = { 1: { AssociatedDevice: {} } };
  const buildRow = (host: ReturnType<typeof byHost>, identity?: FirmwareIdentity): HostEntry => ({
    hostName: host.HostName._value, ipAddress: null, macAddress: host.MACAddress._value,
    connection: 'WiFi', connectionReportedAt: cache.checkedAt, macReportedAt: cache.checkedAt,
    layer2Interface: host.Layer2Interface._value, layer2ReportedAt: cache.checkedAt,
    active: host.Active._value === true, activeReportedAt: cache.checkedAt, band: null, reportedAt: cache.checkedAt,
    wifiSignal: readHostWifiSignal(host, wlans, identity),
  });

  // Sin la identidad verificada (como antes de confirmarla), los 4 Hosts
  // reales siguen "No disponible" — incluido S26-Ultra con su -40 real.
  for (const i of [1, 2, 3, 4]) {
    const row = buildRow(byHost(i));
    assert.equal(row.wifiSignal, null, `Host.${i} sin identidad verificada no debe tener señal`);
  }

  // Con la identidad real y verificada: S26-Ultra (activo, -40) SÍ muestra
  // señal — Excelente/verde. Los desconectados (X_HW_RSSI=0) siguen sin señal
  // verificable: 0 está fuera del rango válido, nunca se confunde con 0 dBm.
  const s26 = byHost(4);
  assert.equal(s26.HostName._value, 'S26-Ultra-de-Warner');
  assert.equal(s26.X_HW_RSSI._value, -40);
  const s26Row = buildRow(s26, VERIFIED_IDENTITY);
  assert.ok(s26Row.wifiSignal, 'con identidad verificada, -40 real debe producir señal');
  assert.deepEqual(hostWifiSignalPresentation(s26Row, cache.lastInform, Date.parse(cache.checkedAt)), { label: '-40 dBm', level: 'excellent' });

  for (const i of [1, 3]) { // Z2359 e iPhone: WiFi pero desconectados, X_HW_RSSI=0
    const host = byHost(i);
    assert.equal(host.X_HW_RSSI._value, 0);
    const row = buildRow(host, VERIFIED_IDENTITY);
    assert.equal(row.wifiSignal, null, `Host.${i} con X_HW_RSSI=0 (desconectado) nunca es "0 dBm"`);
  }
});

test('caché real de señal: cinco X_HW_RSSI sin valor/unidad y cero asociaciones; Inform reciente no actualiza Active', () => {
  const cache = JSON.parse(fs.readFileSync(new URL('../../../../docs/TR069-HOSTS-SIGNAL-CACHE-20261028.json', import.meta.url), 'utf8'));
  const signals = cache.leaves.filter((p: any) => p.path.endsWith('.X_HW_RSSI'));
  assert.equal(signals.length, 5); assert.ok(signals.every((p: any) => !p.valuePresent && p.timestamp === null));
  assert.equal(cache.associations, 0); assert.equal(cache.tasksSent, 0);
  const actual = fixture().row;
  const active = cache.leaves.find((p: any) => p.path.endsWith('Host.2.Active'));
  assert.equal(hostStatusLabel({ ...actual, active: active.value, activeReportedAt: active.timestamp }, cache.lastInform, Date.parse(cache.checkedAt)), 'Sin confirmar');
});
