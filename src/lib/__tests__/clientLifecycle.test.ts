import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClientSection, clientLifecycleStatus, countClientLifecycles, isRetiredClient, readAllClientPages, type ClientLifecycle } from '../clientLifecycle';

const row = (status: ClientLifecycle['status'], contracts: ClientLifecycle['service_contracts'][number]['status'][] = [], installations: ClientLifecycle['installations'][number]['status'][] = []): ClientLifecycle => ({
  status, service_contracts: contracts.map((status) => ({ status })), installations: installations.map((status) => ({ status })),
});

// ---- clientLifecycleStatus / countClientLifecycles (Dashboard): el mismo
// comportamiento de siempre, sin ninguna excepción -- se preservan exactas
// las mismas aserciones de antes de introducir las 4 secciones, probando
// que el Dashboard no cambia aunque ClientesView ahora tenga más detalle. ----

test('baja definitiva: ficha sin contratos o todos los contratos cancelados', () => {
  for (const c of [row('retired'), row('retired', ['cancelled']), row('active', ['cancelled', 'cancelled'])]) {
    assert.equal(isRetiredClient(c), true);
    assert.equal(clientLifecycleStatus(c), 'retired');
  }
});

test('fichas sin contratos permanecen consultables pero no son abonados', () => {
  for (const status of ['active', 'suspended', 'prospect'] as const) {
    assert.equal(isRetiredClient(row(status)), false);
    assert.equal(clientLifecycleStatus(row(status)), status);
    assert.equal(classifyClientSection(row(status)), 'current');
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

test('contadores: una contratación nunca instalada cae en prospectos, nunca en retirados', () => {
  const clients = [row('prospect', ['cancelled'], ['cancelled']), row('retired', ['cancelled'], []), row('active', ['active'])];
  const counts = countClientLifecycles(clients);
  assert.deepEqual(counts, { active: 1, suspended: 0, prospect: 1, retired: 1 });
});

// ---- classifyClientSection: las 4 secciones reales de ClientesView.vue ----

// Caso real: 742 contratos vigentes en producción, pero solo 65 (8.8%) tienen
// una instalación 'completed' vinculada -- 674 son abonados reales sin NINGÚN
// registro de instalación (el seguimiento de Altas llegó después de buena
// parte de la migración). Exigir una instalación completada para "vigente"
// habría reclasificado mal al 90% de los abonados reales como "pendientes de
// instalación". La señal correcta es la EXISTENCIA de una Alta abierta, nunca
// la ausencia de una completada.
test('abonado real sin ningún registro de instalación (patrón del 90% de los contratos vigentes reales): vigente, nunca "pendiente"', () => {
  for (const status of ['active', 'suspended'] as const) {
    const c = row('active', [status]);
    assert.equal(classifyClientSection(c), 'current');
  }
});

test('contrato vigente con una Alta todavía abierta: pendiente de instalación, no "vigente" a secas', () => {
  for (const status of ['pending', 'scheduled', 'in_progress'] as const) {
    assert.equal(classifyClientSection(row('active', ['active'], [status])), 'pending_install');
  }
});

test('Alta independiente abierta (sin contrato vigente): también pendiente de instalación, nunca retirado ni no-instalado', () => {
  for (const status of ['pending', 'scheduled', 'in_progress'] as const) {
    assert.equal(classifyClientSection(row('retired', ['cancelled'], [status])), 'pending_install');
  }
});

// Caso real que origina esta fase: Jheraldin Vidal Cruz (CTR-2026-00297).
// Aceptó la contratación, el técnico fue, rechazó la instalación.
// contract_cancel_unfulfilled canceló su única línea y dejó la ficha en
// 'prospect' -- nunca recibió servicio real.
test('contratación cancelada antes de instalación (caso Jheraldin): no instalado, nunca vigente ni retirado', () => {
  const jheraldin = row('prospect', ['cancelled'], ['cancelled']);
  assert.equal(classifyClientSection(jheraldin), 'unfulfilled');
  assert.equal(isRetiredClient(jheraldin), false);
  assert.equal(clientLifecycleStatus(jheraldin), 'prospect');
  // Sin ninguna instalación registrada en absoluto (contrato cancelado antes
  // de siquiera programar una Alta) se mantiene el mismo resultado.
  assert.equal(classifyClientSection(row('prospect', ['cancelled'], [])), 'unfulfilled');
});

// Patrón real confirmado en producción (2 casos verificados, solo lectura):
// baja administrativa, contrato cancelado, CERO filas de instalación -- no
// todo contrato real tiene una orden de Alta registrada. Sin evidencia de
// instalación en absoluto, se respeta el estado crudo de la ficha.
test('cliente retirado real sin ningún registro de instalación (patrón confirmado en producción): retirado, no "no instalado"', () => {
  const bajaReal = row('retired', ['cancelled'], []);
  assert.equal(classifyClientSection(bajaReal), 'retired');
  assert.equal(isRetiredClient(bajaReal), true);
});

test('instalación completada alguna vez: retirado, la excepción de "nunca instalado" nunca gana sobre evidencia real', () => {
  assert.equal(classifyClientSection(row('retired', ['cancelled'], ['completed', 'cancelled'])), 'retired');
  // Incluso si la ficha quedó en 'prospect' por error: una instalación
  // completada real pesa más que el estado crudo.
  assert.equal(classifyClientSection(row('prospect', ['cancelled'], ['completed'])), 'retired');
});

test('múltiples servicios: cancelar la línea no instalada no reclasifica mientras otra siga vigente', () => {
  for (const status of ['active', 'suspended'] as const) {
    // La ficha puede haber quedado en 'prospect' tras cancelar la primera
    // línea -- igual debe primar el servicio que sigue vigente.
    const c = row('prospect', ['cancelled', status], ['cancelled']);
    assert.equal(classifyClientSection(c), 'current');
    assert.equal(clientLifecycleStatus(c), status);
  }
});

test('múltiples contratos cancelados, ninguno instalado: no instalado una sola vez, no por cada línea', () => {
  const c = row('prospect', ['cancelled', 'cancelled'], ['cancelled']);
  assert.equal(classifyClientSection(c), 'unfulfilled');
});

test('contadores de las 4 secciones particionan exactamente las mismas fichas, sin duplicados', () => {
  const clients = [
    row('active', ['active']), // vigente
    row('active', ['active'], ['pending']), // pendiente de instalación
    row('prospect', ['cancelled'], ['cancelled']), // no instalado (Jheraldin)
    row('retired', ['cancelled'], []), // retirado real
    row('prospect'), // ficha sin contratos: vigente (consultable, no abonado)
  ];
  const buckets = { current: 0, pending_install: 0, unfulfilled: 0, retired: 0 };
  for (const c of clients) buckets[classifyClientSection(c)]++;
  assert.deepEqual(buckets, { current: 2, pending_install: 1, unfulfilled: 1, retired: 1 });
  assert.equal(Object.values(buckets).reduce((a, b) => a + b, 0), clients.length);
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
