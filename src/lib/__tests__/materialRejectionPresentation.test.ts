import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJobOpenForRetry, parseRejectionItems } from '../materialRejectionPresentation';

test('isJobOpenForRetry: instalacion -- solo pending/scheduled/in_progress admiten reintento', () => {
  assert.equal(isJobOpenForRetry('installation', 'pending'), true);
  assert.equal(isJobOpenForRetry('installation', 'scheduled'), true);
  assert.equal(isJobOpenForRetry('installation', 'in_progress'), true);
  assert.equal(isJobOpenForRetry('installation', 'completed'), false);
  assert.equal(isJobOpenForRetry('installation', 'cancelled'), false);
  assert.equal(isJobOpenForRetry('installation', null), false);
});

test('isJobOpenForRetry: averia (ticket) -- open/in_progress/rescheduled', () => {
  assert.equal(isJobOpenForRetry('ticket', 'open'), true);
  assert.equal(isJobOpenForRetry('ticket', 'in_progress'), true);
  assert.equal(isJobOpenForRetry('ticket', 'rescheduled'), true);
  assert.equal(isJobOpenForRetry('ticket', 'resolved'), false);
  assert.equal(isJobOpenForRetry('ticket', 'closed'), false);
});

test('isJobOpenForRetry: rutina -- pending/scheduled/in_progress', () => {
  assert.equal(isJobOpenForRetry('routine', 'in_progress'), true);
  assert.equal(isJobOpenForRetry('routine', 'completed'), false);
  assert.equal(isJobOpenForRetry('routine', 'cancelled'), false);
});

test('parseRejectionItems: kit con varios materiales', () => {
  const items = parseRejectionItems('kit', { items: [{ productId: 'a', quantity: 1 }, { productId: 'b', quantity: 5 }], reason: 'x' });
  assert.deepEqual(items, [{ productId: 'a', quantity: 1 }, { productId: 'b', quantity: 5 }]);
});

test('parseRejectionItems: consume con un solo material', () => {
  const items = parseRejectionItems('consume', { productId: 'a', quantity: 2, reason: 'x' });
  assert.deepEqual(items, [{ productId: 'a', quantity: 2 }]);
});

test('parseRejectionItems: correct no trae productId -- nunca inventa uno, devuelve vacio', () => {
  assert.deepEqual(parseRejectionItems('correct', { movementId: 'm1', quantity: 1 }), []);
});

test('parseRejectionItems: items malformados se descartan, nunca rompen ni inventan cantidad', () => {
  const items = parseRejectionItems('kit', { items: [{ productId: 'a', quantity: 0 }, { productId: '', quantity: 3 }, { productId: 'b', quantity: -1 }, { quantity: 2 }, { productId: 'c', quantity: 4 }] });
  assert.deepEqual(items, [{ productId: 'c', quantity: 4 }]);
});

test('parseRejectionItems: payload vacio o accion desconocida -> vacio', () => {
  assert.deepEqual(parseRejectionItems('kit', {}), []);
  assert.deepEqual(parseRejectionItems('reverse', { movementId: 'm1' }), []);
});
