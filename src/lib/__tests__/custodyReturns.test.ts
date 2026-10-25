import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialReturnError } from '../custodyReturns';
import type { MyInventoryCustody } from '../../types/domain';

const custody: MyInventoryCustody = { units: [], materials: [{ product: { id: 'cable', name: 'Cable', unit: 'm' }, quantity: 10 }], pendingReturnRequests: [] };
test('devolución parcial, saldo exacto y límites', () => {
  assert.equal(materialReturnError(custody, 'cable', 3.5), null);
  assert.equal(materialReturnError(custody, 'cable', 10), null);
  for (const quantity of [null, 0, -1, NaN, Infinity, 11]) assert.ok(materialReturnError(custody, 'cable', quantity));
  assert.ok(materialReturnError(custody, 'otro', 1));
});
test('bloquea nueva solicitud pendiente; permite solicitar tras rechazo o recepción', () => {
  for (const status of ['pending', 'confirmed', 'rejected'] as const) {
    const data = { ...custody, pendingReturnRequests: [{ id: 'r', product: custody.materials[0]!.product, quantity: 2, status, requested_at: '' }] };
    assert.equal(!!materialReturnError(data, 'cable', 2), status === 'pending');
  }
});
