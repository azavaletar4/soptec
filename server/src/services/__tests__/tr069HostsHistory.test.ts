import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyHostsHistory, HOSTS_HISTORY_MAX_GHOSTS, HOSTS_HISTORY_RETENTION_MS } from '../tr069HostsHistory';
import { hostStatusLabel, hostConnectionLabel } from '../../../../src/lib/tr069Hosts';
import type { HostEntry, HostsInventory } from '../../../../src/lib/tr069Hosts';

function tmpDir(t: { after: (fn: () => void) => void }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-history-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function host(mac: string, at: string, overrides: Partial<HostEntry> = {}): HostEntry {
  return {
    hostName: 'Host-' + mac, ipAddress: '192.168.100.1', macAddress: mac,
    connection: 'WiFi', connectionReportedAt: at, macReportedAt: at,
    layer2Interface: null, layer2ReportedAt: null, wifiSignal: null, band: null,
    active: true, activeReportedAt: at, reportedAt: at,
    ...overrides,
  };
}

function inventory(hosts: HostEntry[], lastInform = '2026-10-29T18:00:00.000Z'): HostsInventory {
  return { found: true, deviceId: 'device-1', serial: 'HWTC1D3691B7', lastInform, hostsReportedAt: lastInform, hosts };
}

const AT = '2026-10-27T19:45:00.000Z';
const NOW = Date.parse('2026-10-29T19:00:00.000Z');

test('cinco Hosts históricos, luego solo dos reportados recientemente: los tres ausentes se conservan como "Sin confirmar", nunca como "Desconectado"', async t => {
  const dir = tmpDir(t);
  const five = [1, 2, 3, 4, 5].map(i => host(`aa:bb:cc:dd:ee:0${i}`, AT, { active: i === 2 }));
  const first = applyHostsHistory(inventory(five, AT), dir, () => Date.parse(AT));
  assert.equal(first.hosts.length, 5, 'primera lectura: nada que recuperar del historial todavía');

  // Segunda lectura real: el equipo ya solo reporta dos (los otros tres
  // desaparecieron de su propio árbol TR-069, no solo quedaron "inactivos").
  const recentAt = '2026-10-29T18:59:11.685Z';
  const two = [host('aa:bb:cc:dd:ee:01', recentAt, { active: false }), host('aa:bb:cc:dd:ee:02', recentAt, { active: true })];
  const merged = applyHostsHistory(inventory(two, recentAt), dir, () => NOW);

  assert.equal(merged.hosts.length, 5, 'los tres ausentes se mantienen visibles, no desaparecen del panel');
  const macs = merged.hosts.map(h => h.macAddress).sort();
  assert.deepEqual(macs, ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02', 'aa:bb:cc:dd:ee:03', 'aa:bb:cc:dd:ee:04', 'aa:bb:cc:dd:ee:05']);

  const byMac = new Map(merged.hosts.map(h => [h.macAddress, h] as const));
  // Los dos reportados ahora mismo: frescos, con su estado real tal cual.
  assert.equal(hostStatusLabel(byMac.get('aa:bb:cc:dd:ee:01')!, merged.lastInform, NOW), 'Desconectado');
  assert.equal(hostStatusLabel(byMac.get('aa:bb:cc:dd:ee:02')!, merged.lastInform, NOW), 'Conectado');
  // Los tres ausentes: su dato histórico se conserva sin cambios (nunca se
  // inventa un nuevo "Active"), y por su antigüedad ya se presenta como
  // "Sin confirmar" — nunca como "Desconectado" confirmado.
  for (const mac of ['aa:bb:cc:dd:ee:03', 'aa:bb:cc:dd:ee:04', 'aa:bb:cc:dd:ee:05']) {
    const h = byMac.get(mac)!;
    assert.equal(h.activeReportedAt, AT, 'no se reescribe la fecha real del equipo');
    assert.equal(hostStatusLabel(h, merged.lastInform, NOW), 'Sin confirmar');
    assert.equal(hostConnectionLabel(h, merged.lastInform, NOW), 'Sin confirmar');
  }
});

test('un host que vuelve a aparecer deja de presentarse como fantasma y adopta su lectura nueva', async t => {
  const dir = tmpDir(t);
  applyHostsHistory(inventory([host('aa:bb:cc:dd:ee:01', AT), host('aa:bb:cc:dd:ee:02', AT)], AT), dir, () => Date.parse(AT));
  const onlyOne = applyHostsHistory(inventory([host('aa:bb:cc:dd:ee:01', AT)], AT), dir, () => Date.parse(AT) + 60_000);
  assert.equal(onlyOne.hosts.length, 2);
  const laterAt = '2026-10-29T19:00:00.000Z';
  const backAgain = applyHostsHistory(inventory([host('aa:bb:cc:dd:ee:01', laterAt), host('aa:bb:cc:dd:ee:02', laterAt, { active: false })], laterAt), dir, () => Date.parse(laterAt));
  assert.equal(backAgain.hosts.length, 2, 'sin duplicados al reaparecer');
  assert.equal(backAgain.hosts.find(h => h.macAddress === 'aa:bb:cc:dd:ee:02')!.activeReportedAt, laterAt, 'adopta la lectura real nueva, no la fantasma');
});

test('host sin MAC: se devuelve tal cual en esta respuesta, pero no se recuerda si luego desaparece', async t => {
  const dir = tmpDir(t);
  const noMac = host('', AT, { macAddress: null });
  const first = applyHostsHistory(inventory([noMac, host('aa:bb:cc:dd:ee:01', AT)]), dir, () => Date.parse(AT));
  assert.equal(first.hosts.length, 2);
  const second = applyHostsHistory(inventory([host('aa:bb:cc:dd:ee:01', AT)]), dir, () => Date.parse(AT) + 1000);
  assert.equal(second.hosts.length, 1, 'el host sin MAC no se puede identificar entre lecturas: no se revive');
});

test('retención: un fantasma no visto en 30 días deja de mostrarse', async t => {
  const dir = tmpDir(t);
  applyHostsHistory(inventory([host('aa:bb:cc:dd:ee:01', AT)]), dir, () => Date.parse(AT));
  const justBefore = applyHostsHistory(inventory([]), dir, () => Date.parse(AT) + HOSTS_HISTORY_RETENTION_MS - 1000);
  assert.equal(justBefore.hosts.length, 1, 'todavía dentro del plazo de retención');
  const after = applyHostsHistory(inventory([]), dir, () => Date.parse(AT) + HOSTS_HISTORY_RETENTION_MS + 1000);
  assert.equal(after.hosts.length, 0, 'fuera del plazo de retención, deja de mostrarse');
});

test('límite defensivo: nunca más de HOSTS_HISTORY_MAX_GHOSTS fantasmas, se conservan los vistos más recientemente', async t => {
  const dir = tmpDir(t);
  const many = Array.from({ length: HOSTS_HISTORY_MAX_GHOSTS + 10 }, (_, i) =>
    host(`aa:aa:aa:aa:aa:${String(i).padStart(2, '0')}`, AT));
  // Cada host se "ve" en un instante distinto para poder distinguir cuáles son más recientes.
  let clock = Date.parse(AT);
  for (const h of many) { applyHostsHistory(inventory([h]), dir, () => (clock += 1000)); }
  const result = applyHostsHistory(inventory([]), dir, () => clock + 1000);
  assert.equal(result.hosts.length, HOSTS_HISTORY_MAX_GHOSTS);
  // El primero visto (el más antiguo) debe haber sido descartado por el límite.
  assert.ok(!result.hosts.some(h => h.macAddress === many[0]!.macAddress));
  assert.ok(result.hosts.some(h => h.macAddress === many[many.length - 1]!.macAddress));
});

test('equipo no identificado o sin deviceId: se devuelve igual, sin leer ni escribir historial', async t => {
  const dir = tmpDir(t);
  const notFound: HostsInventory = { found: false, deviceId: null, serial: 'HWTC1D3691B7', lastInform: null, hostsReportedAt: null, hosts: [] };
  const result = applyHostsHistory(notFound, dir, () => NOW);
  assert.deepEqual(result, notFound);
  assert.deepEqual(fs.readdirSync(dir), []);
});
