import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readHostWifiSignal } from '../tr069HostsSignal';
import { hostStatusLabel, hostWifiSignalPresentation, type HostEntry } from '../../../../src/lib/tr069Hosts';

const at = '2026-10-28T22:03:39.213Z', now = Date.parse(at) + 1000;
const mac = 'aa:bb:cc:dd:ee:01', wlan = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';
const leaf = (value: unknown) => ({ _value: value, _timestamp: at });
function fixture(dbm = -60, unit: string | null = 'dBm') {
  const raw = { MACAddress: leaf(mac), Layer2Interface: leaf(wlan) };
  const associated = { AssociatedDeviceMACAddress: leaf(mac.toUpperCase()), SignalStrength: leaf(dbm), ...(unit ? { SignalStrengthUnit: leaf(unit) } : {}) };
  const wlans = { 1: { AssociatedDevice: { 1: associated } } };
  const signal = readHostWifiSignal(raw, wlans);
  const row: HostEntry = { hostName: 'Equipo', ipAddress: null, macAddress: mac, connection: 'WiFi', connectionReportedAt: at,
    macReportedAt: at, layer2Interface: wlan, layer2ReportedAt: at, active: true, activeReportedAt: at, band: null, reportedAt: at, wifiSignal: signal };
  return { raw, associated, wlans, row };
}

test('señal simulada con MAC/WLAN y unidad explícita: intensidad dBm, verde/amarillo/rojo sin porcentaje', () => {
  for (const [dbm, level] of [[-60, 'good'], [-67, 'good'], [-68, 'fair'], [-75, 'fair'], [-76, 'poor']] as const) {
    const { row } = fixture(dbm);
    assert.deepEqual(hostWifiSignalPresentation(row, at, now), { label: `${dbm} dBm`, level });
    assert.ok(!hostWifiSignalPresentation(row, at, now).label.includes('%'));
  }
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

test('caso real reportado (29/10): S26-Ultra conectado por WiFi con X_HW_RSSI=-40 real, pero sin unidad declarada en ningún nivel — sigue "No disponible", no es un error', () => {
  const cache = JSON.parse(fs.readFileSync(new URL('../../../../docs/TR069-HOSTS-SIGNAL-CACHE-20261029.json', import.meta.url), 'utf8'));
  // Confirma la investigación de solo lectura: ni X_HW_RSSIUnit, RSSI, RSSIUnit,
  // SignalStrength ni SignalStrengthUnit existen en ningún Host — y no hay
  // ninguna instancia AssociatedDevice para correlacionar por esa vía tampoco.
  for (const suffix of ['X_HW_RSSIUnit', 'RSSI', 'RSSIUnit', 'SignalStrength', 'SignalStrengthUnit']) {
    assert.ok(cache.hostLeaves.filter((l: any) => l.path.endsWith('.' + suffix)).every((l: any) => !l.valuePresent),
      suffix + ' nunca declarado con valor en este equipo');
  }
  assert.equal(cache.associatedDeviceLeaves.length, 0, 'sin asociaciones WiFi reportadas en esta muestra');

  const byHost = (i: number) => {
    const field = (name: string) => cache.hostLeaves.find((l: any) => l.path === `InternetGatewayDevice.LANDevice.1.Hosts.Host.${i}.${name}`);
    const leaf = (name: string) => { const l = field(name); return l?.valuePresent ? { _value: l.value, _timestamp: l.timestamp, _type: l.type } : {}; };
    return {
      MACAddress: leaf('MACAddress'), Layer2Interface: leaf('Layer2Interface'),
      X_HW_RSSI: leaf('X_HW_RSSI'), Active: leaf('Active'), InterfaceType: leaf('InterfaceType'), HostName: leaf('HostName'),
    };
  };
  const wlans = { 1: { AssociatedDevice: {} } };
  // Cuatro dispositivos reales, cuatro MAC distintas: ninguno obtiene señal verificable.
  for (const i of [1, 2, 3, 4]) {
    const host = byHost(i);
    assert.equal(readHostWifiSignal(host, wlans), null, `Host.${i} (${host.HostName._value}) no debe tener señal sin unidad verificada`);
  }

  // El caso exacto reportado: S26-Ultra, activo, WiFi, X_HW_RSSI real -40 (valor
  // plausible de dBm) — igual se presenta "No disponible", nunca se inventa la unidad.
  const s26 = byHost(4);
  assert.equal(s26.HostName._value, 'S26-Ultra-de-Warner');
  assert.equal(s26.X_HW_RSSI._value, -40);
  const row: HostEntry = {
    hostName: s26.HostName._value, ipAddress: '192.168.100.35', macAddress: s26.MACAddress._value,
    connection: 'WiFi', connectionReportedAt: cache.checkedAt, macReportedAt: cache.checkedAt,
    layer2Interface: s26.Layer2Interface._value, layer2ReportedAt: cache.checkedAt,
    active: true, activeReportedAt: cache.checkedAt, band: null, reportedAt: cache.checkedAt,
    wifiSignal: readHostWifiSignal(s26, wlans),
  };
  assert.equal(row.wifiSignal, null);
  assert.deepEqual(hostWifiSignalPresentation(row, cache.lastInform, Date.parse(cache.checkedAt)), { label: 'No disponible', level: null });
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
