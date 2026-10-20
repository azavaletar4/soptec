import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableMaterialQuantity, confirmedMaterialQuantity, materialCustodyLabel } from '../materialCustodyAvailability';

test('availableMaterialQuantity: producto en custodia -> su cantidad real', () => {
  const materials = [{ product: { id: 'p1' }, quantity: 12 }, { product: { id: 'p2' }, quantity: 3 }];
  assert.equal(availableMaterialQuantity(materials, 'p1'), 12);
  assert.equal(availableMaterialQuantity(materials, 'p2'), 3);
});

test('availableMaterialQuantity: producto sin custodia -> 0, nunca se inventa', () => {
  assert.equal(availableMaterialQuantity([], 'p1'), 0);
  assert.equal(availableMaterialQuantity([{ product: { id: 'otro' }, quantity: 5 }], 'p1'), 0);
});

test('cero confirmado mantiene limite cero y mensaje de saldo real', () => {
  assert.equal(confirmedMaterialQuantity([], 'p1', 'ready'), 0);
  assert.equal(materialCustodyLabel(0, 'metros', 'ready'), 'Tu custodia: 0 metros');
});

test('carga, error y perfil sin consulta no presentan cero ni un saldo anterior como confirmado', () => {
  const stale = [{ product: { id: 'p1' }, quantity: 12 }];
  for (const state of ['loading', 'error', 'unavailable'] as const) {
    assert.equal(confirmedMaterialQuantity(stale, 'p1', state), undefined);
    assert.equal(confirmedMaterialQuantity([], 'p1', state), undefined);
    assert.doesNotMatch(materialCustodyLabel(undefined, 'metros', state), /0 metros/);
  }
  assert.match(materialCustodyLabel(undefined, 'metros', 'loading'), /Consultando/);
  assert.match(materialCustodyLabel(undefined, 'metros', 'error'), /No se pudo consultar/);
});
