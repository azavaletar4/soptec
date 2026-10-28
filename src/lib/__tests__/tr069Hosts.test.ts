import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hostStatusLabel, latestHostsReport, HOST_STATUS_MAX_AGE_MS, type HostEntry } from '../tr069Hosts';

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
    hosts: [{ ...row, reportedAt: old }, { ...row, reportedAt: 'invalid' }] };
  assert.equal(latestHostsReport(inventory), old);
  assert.equal(latestHostsReport({ ...inventory, hosts: [] }), null);
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
