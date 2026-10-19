import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMaterialCustodyShortfalls,
  classifyShortfallRecency,
  MATERIAL_CUSTODY_DETECTION_LIVE_SINCE,
  type MaterialCustodyEventInput,
  type MaterialConsumptionMovementInput,
} from '../materialCustodyShortfall';

const TECH = 'tech-1';
const PRODUCT = 'product-1';

function movement(partial: Partial<MaterialConsumptionMovementInput> & { id: string }): MaterialConsumptionMovementInput {
  return {
    technicianId: TECH,
    productId: PRODUCT,
    movementType: 'egreso',
    quantity: 1,
    createdAt: '2026-10-18T20:00:00.000Z',
    jobType: 'installation',
    jobId: 'job-1',
    reversesMovementId: null,
    ...partial,
  };
}

// ---- Caso real confirmado: Jadir Zavaleta, 18/10/2026 — cero entregas de material, consumo igual se registro ----

test('detectMaterialCustodyShortfalls: sin ninguna entrega previa -> todo el consumo es deficit', () => {
  const found = detectMaterialCustodyShortfalls([], [movement({ id: 'm1', quantity: 1 })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 0);
  assert.equal(found[0].shortfall, 1);
  assert.equal(found[0].technicianId, TECH);
  assert.equal(found[0].productId, PRODUCT);
  assert.equal(found[0].jobType, 'installation');
  assert.equal(found[0].jobId, 'job-1');
});

test('detectMaterialCustodyShortfalls: con entrega suficiente antes del consumo -> no hay hallazgo', () => {
  const delivery: MaterialCustodyEventInput = { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 5, createdAt: '2026-10-18T10:00:00.000Z' };
  const found = detectMaterialCustodyShortfalls([delivery], [movement({ id: 'm1', quantity: 2 })]);
  assert.deepEqual(found, []);
});

test('detectMaterialCustodyShortfalls: entrega parcial -> deficit es exactamente lo que falta', () => {
  const delivery: MaterialCustodyEventInput = { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 1, createdAt: '2026-10-18T10:00:00.000Z' };
  const found = detectMaterialCustodyShortfalls([delivery], [movement({ id: 'm1', quantity: 4 })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 1);
  assert.equal(found[0].shortfall, 3);
});

test('detectMaterialCustodyShortfalls: la entrega llega DESPUES del consumo -> igual queda marcado (orden cronologico real)', () => {
  const deliveryAfter: MaterialCustodyEventInput = { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 5, createdAt: '2026-10-19T10:00:00.000Z' };
  const found = detectMaterialCustodyShortfalls([deliveryAfter], [movement({ id: 'm1', quantity: 2, createdAt: '2026-10-18T20:00:00.000Z' })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 0);
});

test('detectMaterialCustodyShortfalls: devolucion reduce el saldo simulado antes del consumo', () => {
  const events: MaterialCustodyEventInput[] = [
    { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 5, createdAt: '2026-10-18T09:00:00.000Z' },
    { technicianId: TECH, productId: PRODUCT, eventType: 'return', quantity: 4, createdAt: '2026-10-18T10:00:00.000Z' },
  ];
  const found = detectMaterialCustodyShortfalls(events, [movement({ id: 'm1', quantity: 2 })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 1);
  assert.equal(found[0].shortfall, 1);
});

test('detectMaterialCustodyShortfalls: una reversion (ingreso que corrige un egreso) repone el saldo para el siguiente consumo', () => {
  const movements: MaterialConsumptionMovementInput[] = [
    movement({ id: 'm1', quantity: 2, createdAt: '2026-10-18T10:00:00.000Z' }),
    movement({ id: 'm2', movementType: 'ingreso', quantity: 2, reversesMovementId: 'm1', createdAt: '2026-10-18T10:05:00.000Z' }),
    movement({ id: 'm3', quantity: 2, createdAt: '2026-10-18T10:10:00.000Z' }),
  ];
  const found = detectMaterialCustodyShortfalls([], movements);
  // m1 queda marcado (en ese momento no habia custodia); la reversion de m1
  // repone el saldo simulado a 0, asi que m3 (misma cantidad que se repuso)
  // ya no excede el saldo disponible — mismo efecto neto que una correccion
  // real de cantidad (accion 'correct' de campo_inventory_operation).
  assert.equal(found.length, 1);
  assert.equal(found[0].movementId, 'm1');
});

test('detectMaterialCustodyShortfalls: consumo sin tecnico atribuible (edicion administrativa directa) se ignora', () => {
  const found = detectMaterialCustodyShortfalls([], [movement({ id: 'm1', technicianId: null })]);
  assert.deepEqual(found, []);
});

test('detectMaterialCustodyShortfalls: consumo sin orden (jobType/jobId null) se ignora', () => {
  const found = detectMaterialCustodyShortfalls([], [movement({ id: 'm1', jobType: null, jobId: null })]);
  assert.deepEqual(found, []);
});

test('detectMaterialCustodyShortfalls: tecnicos y productos distintos no se mezclan', () => {
  const events: MaterialCustodyEventInput[] = [
    { technicianId: 'tech-2', productId: PRODUCT, eventType: 'delivery', quantity: 10, createdAt: '2026-10-18T09:00:00.000Z' },
  ];
  const found = detectMaterialCustodyShortfalls(events, [movement({ id: 'm1', technicianId: TECH, quantity: 1 })]);
  assert.equal(found.length, 1); // la entrega de tech-2 no cubre a TECH
});

test('detectMaterialCustodyShortfalls: el saldo nunca queda negativo para el siguiente consumo (no infla el deficit)', () => {
  const found = detectMaterialCustodyShortfalls([], [
    movement({ id: 'm1', quantity: 5, createdAt: '2026-10-18T10:00:00.000Z' }),
    movement({ id: 'm2', quantity: 1, createdAt: '2026-10-18T11:00:00.000Z' }),
  ]);
  assert.equal(found.length, 2);
  assert.equal(found[0].movementId, 'm2'); // orden: mas reciente primero
  assert.equal(found[0].availableBefore, 0); // no -5
  assert.equal(found[1].movementId, 'm1');
  assert.equal(found[1].availableBefore, 0);
});

// ---- classifyShortfallRecency ----

test('classifyShortfallRecency: mientras la deteccion no este activada (LIVE_SINCE null), todo es historico', () => {
  assert.equal(MATERIAL_CUSTODY_DETECTION_LIVE_SINCE, null);
  assert.equal(classifyShortfallRecency('2026-10-18T20:00:00.000Z'), 'historico');
  assert.equal(classifyShortfallRecency('2099-01-01T00:00:00.000Z'), 'historico');
});
