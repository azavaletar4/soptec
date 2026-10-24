import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterContractsLinkedToNonAdminRouter, type ContractLinkedToNonAdminRouter } from '../mikrotikReconcileService';

// Fase 173 — reconciliacion PPPoE exclusiva por router administrador.
// filterContractsLinkedToNonAdminRouter es la parte pura (sin Supabase) del
// requisito 8: detectar, SOLO PARA INFORMAR, contratos cuyo
// mikrotik_device_id apunta a un router que no es administrador PPPoE
// (dedicado o balanceador) — reconcileMikrotikDevice nunca los evalua
// porque el loop externo ya filtra solo routers pppoe_admin.

function row(overrides: Partial<ContractLinkedToNonAdminRouter> = {}): ContractLinkedToNonAdminRouter {
  return {
    contractId: 'c1',
    contractNumber: 'CTR-0001',
    pppoeUsername: 'cliente1',
    deviceId: 'd1',
    deviceName: 'Router',
    deviceRole: 'pppoe_admin',
    ...overrides,
  };
}

test('filterContractsLinkedToNonAdminRouter: deja afuera los contratos vinculados a un administrador real', () => {
  const rows = [row({ deviceRole: 'pppoe_admin' })];
  assert.deepEqual(filterContractsLinkedToNonAdminRouter(rows), []);
});

test('filterContractsLinkedToNonAdminRouter: detecta contratos vinculados a un borde dedicado', () => {
  const rows = [row({ contractId: 'c2', deviceRole: 'borde_dedicado', deviceName: 'MikroTik - Borde Dedicado' })];
  const result = filterContractsLinkedToNonAdminRouter(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].deviceRole, 'borde_dedicado');
});

test('filterContractsLinkedToNonAdminRouter: detecta contratos vinculados al balanceador (interfaces PPPoE-WAN del proveedor nunca son abonados)', () => {
  const rows = [row({ contractId: 'c3', deviceRole: 'borde_balanceador', deviceName: 'MikroTik - Balanceador' })];
  const result = filterContractsLinkedToNonAdminRouter(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].deviceRole, 'borde_balanceador');
});

test('filterContractsLinkedToNonAdminRouter: caso mixto — solo reporta los mal asociados, nunca modifica nada (funcion pura)', () => {
  const rows = [
    row({ contractId: 'ok-1', deviceRole: 'pppoe_admin' }),
    row({ contractId: 'mal-1', deviceRole: 'borde_dedicado' }),
    row({ contractId: 'ok-2', deviceRole: 'pppoe_admin' }),
    row({ contractId: 'mal-2', deviceRole: 'borde_balanceador' }),
  ];
  const result = filterContractsLinkedToNonAdminRouter(rows);
  assert.deepEqual(result.map((r) => r.contractId).sort(), ['mal-1', 'mal-2']);
});
