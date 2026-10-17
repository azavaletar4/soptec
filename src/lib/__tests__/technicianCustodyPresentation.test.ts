import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCustodyTechnician, currentCustodyDelivery, custodyEquipmentLocation } from '../technicianCustodyPresentation';
import { formatPeruDateTime } from '../oltAlertPresentation';
import type { InventoryUnitEvent } from '../../types/domain';

test('selección inicial con custodia, vacíos y conservación de elección manual al actualizar', () => {
  const rows = [{ id: 'empty', units: [], materials: [] }, { id: 'jadir', units: [{}], materials: [] }];
  assert.equal(chooseCustodyTechnician(null, rows), 'jadir');
  assert.equal(chooseCustodyTechnician('empty', rows), 'empty');
  assert.equal(chooseCustodyTechnician('jadir', [...rows].reverse()), 'jadir');
  assert.equal(chooseCustodyTechnician('removed', rows), 'jadir');
  assert.equal(chooseCustodyTechnician(null, [rows[0]!]), 'empty');
  assert.equal(chooseCustodyTechnician(null, []), null);
  assert.equal(chooseCustodyTechnician(null, [{ id: 'material', units: [], materials: [{}] }]), 'material');
});

const unit = { id: 'ont', status: 'pending_return' as const, custody_technician_id: 'jadir' };
const event = (to_status: string, assigned_to: string, created_at: string) => ({ id: created_at, unit_id: 'ont', to_status, assigned_to, created_at }) as InventoryUnitEvent;
test('entrega vigente proviene del Kardex, no de entregas anteriores ni de otro técnico', () => {
  const delivery = event('with_technician', 'jadir', '2026-10-17T20:00:00Z');
  const request = event('pending_return', 'jadir', '2026-10-18T20:00:00Z');
  assert.equal(currentCustodyDelivery(unit, [delivery, request]), delivery);
  assert.equal(currentCustodyDelivery(unit, []), null);
  assert.equal(currentCustodyDelivery(unit, [event('with_technician', 'other', delivery.created_at)]), null);
  assert.equal(currentCustodyDelivery(unit, [delivery, event('in_stock', 'jadir', request.created_at)]), null);
  assert.equal(currentCustodyDelivery({ ...unit, status: 'in_stock' }, [delivery]), null);
});
test('fecha real en Perú y navegación al Kardex existente', () => {
  const date = formatPeruDateTime('2026-10-18T02:30:00Z');
  assert.match(date, /17/); assert.match(date, /09:30|21:30/);
  assert.equal(formatPeruDateTime('invalid'), 'Fecha no disponible');
  assert.deepEqual(custodyEquipmentLocation('product', 'ont'), { name: 'inventario-detalle', params: { id: 'product' }, query: { unit: 'ont', returnTo: '/inventario/custodia' } });
});
