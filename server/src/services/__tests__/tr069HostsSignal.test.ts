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

test('caché real de señal: cinco X_HW_RSSI sin valor/unidad y cero asociaciones; Inform reciente no actualiza Active', () => {
  const cache = JSON.parse(fs.readFileSync(new URL('../../../../docs/TR069-HOSTS-SIGNAL-CACHE-20261028.json', import.meta.url), 'utf8'));
  const signals = cache.leaves.filter((p: any) => p.path.endsWith('.X_HW_RSSI'));
  assert.equal(signals.length, 5); assert.ok(signals.every((p: any) => !p.valuePresent && p.timestamp === null));
  assert.equal(cache.associations, 0); assert.equal(cache.tasksSent, 0);
  const actual = fixture().row;
  const active = cache.leaves.find((p: any) => p.path.endsWith('Host.2.Active'));
  assert.equal(hostStatusLabel({ ...actual, active: active.value, activeReportedAt: active.timestamp }, cache.lastInform, Date.parse(cache.checkedAt)), 'Sin confirmar');
});
