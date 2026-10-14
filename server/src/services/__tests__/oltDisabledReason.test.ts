import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDisabledReason } from '../oltDisabledReason';

const contratoA = 'ctr-a-00000000-0000-0000-0000-000000000001';
const contratoB = 'ctr-b-00000000-0000-0000-0000-000000000002';

test('admin_state=disable y sin contrato en mora -> "manual"', () => {
  const reason = resolveDisabledReason({ admin_state: 'disable', contract_id: contratoA }, new Set());
  assert.equal(reason, 'manual');
});

test('admin_state=enable pero su contrato EXACTO esta en mora -> "billing"', () => {
  const reason = resolveDisabledReason({ admin_state: 'enable', contract_id: contratoA }, new Set([contratoA]));
  assert.equal(reason, 'billing');
});

test('admin_state=disable Y su contrato EXACTO en mora -> "both"', () => {
  const reason = resolveDisabledReason({ admin_state: 'disable', contract_id: contratoA }, new Set([contratoA]));
  assert.equal(reason, 'both');
});

test('cliente con 2 contratos: UNO en mora (contratoA) y OTRO al dia (contratoB) -> nunca se contagia la deuda al que esta al dia', () => {
  const suspendidos = new Set([contratoA]);
  const servicioEnMora = resolveDisabledReason({ admin_state: 'enable', contract_id: contratoA }, suspendidos);
  const servicioAlDia = resolveDisabledReason({ admin_state: 'enable', contract_id: contratoB }, suspendidos);
  assert.equal(servicioEnMora, 'billing');
  assert.equal(servicioAlDia, null); // ni 'billing' ni ningun otro motivo: esta conectada y al dia.
});

test('cliente con 2 contratos: UNO en mora Y admin-disabled manualmente, el otro al dia y habilitado -> cada uno con SU propio motivo', () => {
  const suspendidos = new Set([contratoA]);
  const servicioProblema = resolveDisabledReason({ admin_state: 'disable', contract_id: contratoA }, suspendidos);
  const servicioOk = resolveDisabledReason({ admin_state: 'enable', contract_id: contratoB }, suspendidos);
  assert.equal(servicioProblema, 'both');
  assert.equal(servicioOk, null);
});

test('ONT SIN contrato (sin vincular o vinculo parcial) -> nunca puede ser "billing", aunque haya contratos en mora en el sistema', () => {
  const reason = resolveDisabledReason({ admin_state: 'enable', contract_id: null }, new Set([contratoA, contratoB]));
  assert.equal(reason, null);
});

test('ONT SIN contrato pero admin-disabled -> "manual" (nunca inventa una deuda sin contrato exacto)', () => {
  const reason = resolveDisabledReason({ admin_state: 'disable', contract_id: null }, new Set([contratoA]));
  assert.equal(reason, 'manual');
});

test('sin deuda confirmada en ningun contrato (set vacio) y admin_state=enable -> null (ni deshabilitada ni cortada)', () => {
  const reason = resolveDisabledReason({ admin_state: 'enable', contract_id: contratoA }, new Set());
  assert.equal(reason, null);
});

test('contrato de la ONT no coincide con ninguno de los suspendidos -> null, nunca una coincidencia parcial/ambigua', () => {
  const reason = resolveDisabledReason({ admin_state: 'enable', contract_id: contratoB }, new Set([contratoA]));
  assert.equal(reason, null);
});
