import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientLifecycleStatus, countClientLifecycles, isRetiredClient, readAllClientPages, type ClientLifecycle } from '../clientLifecycle';

const row = (status: ClientLifecycle['status'], contracts: ClientLifecycle['service_contracts'][number]['status'][] = [], installations: ClientLifecycle['installations'][number]['status'][] = []): ClientLifecycle => ({
  status, service_contracts: contracts.map((status) => ({ status })), installations: installations.map((status) => ({ status })),
});

test('baja definitiva: ficha sin contratos o todos los contratos cancelados', () => {
  for (const c of [row('retired'), row('retired', ['cancelled']), row('active', ['cancelled', 'cancelled'])]) {
    assert.equal(isRetiredClient(c), true);
    assert.equal(clientLifecycleStatus(c), 'retired');
  }
});

test('activo, suspendido y prospecto sin contratos permanecen vigentes', () => {
  for (const status of ['active', 'suspended', 'prospect'] as const) {
    assert.equal(isRetiredClient(row(status)), false);
    assert.equal(clientLifecycleStatus(row(status)), status);
  }
  assert.equal(clientLifecycleStatus(row('retired', ['suspended'])), 'suspended');
});

test('dos servicios: una cancelación nunca oculta otro activo o suspendido', () => {
  for (const status of ['active', 'suspended'] as const) {
    const c = row('retired', ['cancelled', status]);
    assert.equal(isRetiredClient(c), false);
    assert.equal(clientLifecycleStatus(c), status);
  }
});

test('altas abiertas mantienen vigente incluso una ficha retirada con contratos cancelados', () => {
  for (const status of ['pending', 'scheduled', 'in_progress'] as const) {
    const c = row('retired', ['cancelled'], [status]);
    assert.equal(isRetiredClient(c), false);
    assert.equal(clientLifecycleStatus(c), 'prospect');
  }
  assert.equal(isRetiredClient(row('retired', ['cancelled'], ['completed', 'cancelled'])), true);
  assert.equal(clientLifecycleStatus(row('retired', ['active'], ['pending'])), 'active');
});

test('contadores particionan exactamente las mismas filas que las secciones', () => {
  const clients = [row('retired'), row('active', ['active']), row('suspended', ['suspended']), row('retired', ['cancelled', 'active']), row('prospect', [], ['pending'])];
  const counts = countClientLifecycles(clients);
  assert.deepEqual(counts, { active: 2, suspended: 1, prospect: 1, retired: 1 });
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), clients.length);
  assert.equal(clients.filter((c) => !isRetiredClient(c)).length, counts.active + counts.suspended + counts.prospect);
});

test('lectura completa con límite del servidor menor al solicitado y error sin totales parciales', async () => {
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const actual = await readAllClientPages(async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + 137)), error: null }));
  assert.deepEqual(actual, rows);
  const counted = await readAllClientPages(async (from) => {
    assert.ok(from < rows.length, 'No solicitar un rango fuera del total exacto');
    return { data: rows.slice(from, from + 137), error: null, count: rows.length };
  });
  assert.deepEqual(counted, rows);
  await assert.rejects(readAllClientPages(async (from) => from ? { data: null, error: new Error('RLS/network') } : { data: rows.slice(0, 1), error: null }), /RLS\/network/);
});
