import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hostConnectionLabel, hostStatusLabel, hostStatusReadAt, latestHostsReport, HOST_STATUS_MAX_AGE_MS, type HostEntry } from '../tr069Hosts';

const now = Date.parse('2026-10-28T21:50:00Z');
const recent = new Date(now - 60_000).toISOString();
const old = new Date(now - HOST_STATUS_MAX_AGE_MS - 1).toISOString();
const row: HostEntry = { hostName: 'Host', ipAddress: null, macAddress: null, connection: null, band: null,
  active: true, activeReportedAt: recent, reportedAt: recent };

test('estado exige Active explícito y fechas recientes del propio valor e Inform', () => {
  assert.equal(hostStatusLabel(row, recent, now), 'Conectado');
  assert.equal(hostStatusLabel({ ...row, active: false }, recent, now), 'Desconectado');
  assert.equal(hostStatusLabel({ ...row, active: null }, recent, now), 'Sin confirmar');
  assert.equal(hostStatusLabel(row, recent, now + HOST_STATUS_MAX_AGE_MS), 'Sin confirmar', 'Expira sin nuevas consultas');
});

test('un Inform o nombre reciente nunca rejuvenece Active antiguo, ausente, inválido o futuro', () => {
  for (const timestamp of [old, null, undefined, 'invalid', new Date(now + 1).toISOString()]) {
    for (const active of [true, false]) {
      assert.equal(hostStatusLabel({ ...row, active, activeReportedAt: timestamp }, recent, now), 'Sin confirmar');
    }
  }
  for (const inform of [old, null, 'invalid', new Date(now + 1).toISOString()]) {
    assert.equal(hostStatusLabel(row, inform, now), 'Sin confirmar');
  }
});

test('hora de lista usa datos de filas; nunca el objeto padre, Inform ni hora de consulta', () => {
  const inventory = { found: true, deviceId: 'id', serial: 'HWTC1D3691B7', lastInform: recent, hostsReportedAt: recent,
    hosts: [{ ...row, activeReportedAt: null, reportedAt: old }, { ...row, activeReportedAt: null, reportedAt: 'invalid' }] };
  assert.equal(latestHostsReport(inventory), old);
  assert.equal(latestHostsReport({ ...inventory, hosts: [] }), null);
});

test('límite exacto de 10 minutos: válido en el límite, caducado un milisegundo después', () => {
  const boundary = new Date(now - HOST_STATUS_MAX_AGE_MS).toISOString();
  for (const active of [true, false]) {
    const host = { ...row, active, activeReportedAt: boundary };
    assert.equal(hostStatusLabel(host, recent, now), active ? 'Conectado' : 'Desconectado');
    assert.equal(hostStatusLabel(host, recent, now + 1), 'Sin confirmar');
    assert.equal(hostStatusReadAt(host, now + 1), boundary);
  }
});

test('tipo WiFi/Ethernet exige fecha propia reciente y no se clasifica información antigua como actual', () => {
  for (const connection of ['WiFi', 'Cable'] as const) {
    const host = { ...row, connection, connectionReportedAt: recent };
    assert.equal(hostConnectionLabel(host, recent, now), connection);
    for (const time of [old, null, undefined, 'invalid', new Date(now + 1).toISOString()]) {
      assert.equal(hostConnectionLabel({ ...host, connectionReportedAt: time }, recent, now), 'Sin confirmar');
    }
    assert.equal(hostConnectionLabel(host, old, now), 'Sin confirmar');
  }
  assert.equal(hostConnectionLabel({ ...row, connection: null, connectionReportedAt: recent }, recent, now), 'Sin confirmar');
});

test('hora de estado permanece visible al caducar y se omiten fechas ausentes, inválidas o futuras', () => {
  assert.equal(hostStatusReadAt({ ...row, activeReportedAt: old }, now), old);
  for (const activeReportedAt of [null, undefined, 'invalid', new Date(now + 1).toISOString()]) {
    assert.equal(hostStatusReadAt({ ...row, activeReportedAt }, now), null);
  }
});

test('cabecera incluye la lectura propia de estado/tipo sin usar Inform ni metadatos ni fechas futuras', () => {
  const inventory = { found: true, deviceId: 'id', serial: 'HWTC1D3691B7', lastInform: new Date(now).toISOString(), hostsReportedAt: new Date(now).toISOString(),
    hosts: [{ ...row, reportedAt: old }, { ...row, reportedAt: old, activeReportedAt: new Date(now + 1).toISOString() }] };
  assert.equal(latestHostsReport(inventory, now), recent);
  const newerType = new Date(now - 1000).toISOString();
  assert.equal(latestHostsReport({ ...inventory, hosts: [{ ...row, connectionReportedAt: newerType }] }, now), newerType);
});

test('evidencia real: cinco Hosts sin Active/InterfaceType/Layer2Interface ni asociaciones o puertos descubiertos', () => {
  const cache = JSON.parse(fs.readFileSync(new URL('../../../docs/TR069-HOSTS-INTERFACES-CACHE-20261028.json', import.meta.url), 'utf8'));
  const paths = cache.paths as Array<{ path: string; valuePresent: boolean; timestamp: string | null }>;
  for (const field of ['Active', 'InterfaceType', 'Layer2Interface']) {
    const leaves = paths.filter(p => new RegExp('Hosts.Host.[1-5].' + field + '$').test(p.path));
    assert.equal(leaves.length, 5);
    assert.ok(leaves.every(p => !p.valuePresent && p.timestamp === null));
  }
  assert.ok(!paths.some(p => /AssociatedDevice\.\d+|LANEthernetInterfaceConfig\.\d+/.test(p.path)));
  assert.ok(paths.some(p => /WLANConfiguration\.1\.X_HW_RFBand$/.test(p.path) && !p.valuePresent));
});
