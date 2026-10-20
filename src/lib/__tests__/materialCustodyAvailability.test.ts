import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableMaterialQuantity, confirmedMaterialQuantity, materialCustodyLabel, withAvailableCustody } from '../materialCustodyAvailability';

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

// Selector de consumo en Averias/Rutinas (Fase 165, etapa 2): solo custodia
// confirmada >0, pero jamas durante carga/error (requisito explicito).
const products = [{ id: 'cable' }, { id: 'patchcord' }, { id: 'drop' }];
const available = (balances: Record<string, number>) => (id: string) => balances[id];
const byId = (p: { id: string }) => p.id;

test('withAvailableCustody: con custodia lista, retira los productos en cero', () => {
  const result = withAvailableCustody(products, available({ cable: 3, patchcord: 0, drop: 0 }), byId, 'ready');
  assert.deepEqual(result.map((p) => p.id), ['cable']);
});

test('withAvailableCustody: tecnico sin custodia en ninguno -> selector vacio (no hay saldo real)', () => {
  const result = withAvailableCustody(products, available({}), byId, 'ready');
  assert.deepEqual(result, []);
});

test('withAvailableCustody: durante carga o error nunca se oculta el catalogo (no es un cero confirmado)', () => {
  for (const state of ['loading', 'error', 'unavailable'] as const) {
    const result = withAvailableCustody(products, available({}), byId, state);
    assert.deepEqual(result.map((p) => p.id), ['cable', 'patchcord', 'drop']);
  }
});

test('withAvailableCustody: material agotado tras consumirlo (cae a 0) se retira de las opciones', () => {
  const before = withAvailableCustody(products, available({ cable: 1 }), byId, 'ready');
  assert.deepEqual(before.map((p) => p.id), ['cable']);
  const after = withAvailableCustody(products, available({ cable: 0 }), byId, 'ready'); // consumido por completo
  assert.deepEqual(after, []);
});

test('withAvailableCustody: cuadrilla — cada tecnico filtra por su propia custodia, no la de otro integrante', () => {
  const leader = withAvailableCustody(products, available({ cable: 5 }), byId, 'ready');
  const support = withAvailableCustody(products, available({ patchcord: 2 }), byId, 'ready');
  assert.deepEqual(leader.map((p) => p.id), ['cable']);
  assert.deepEqual(support.map((p) => p.id), ['patchcord']);
});
