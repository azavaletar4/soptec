import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserveContractNap, reserveContractNapSyncOntZone } from '../napAssignment';

test('NAP: full destination, reservation failure and RPC denial leave prior assignment untouched', async () => {
  for (const message of ['La caja NAP esta llena', 'reservation failed', 'permission denied']) {
    const ports = [{ id: 'old', contract_id: 'contract', estado: 'ocupado' }];
    const before = structuredClone(ports); let calls = 0;
    await assert.rejects(reserveContractNap(async (name, args) => {
      calls++; assert.equal(name, 'assign_contract_nap'); assert.equal(args.p_contract_id, 'contract');
      return { data: null, error: { message, code: 'P0001' } };
    }, { napId: 'full', contractId: 'contract', clientId: 'client' }), /asignación anterior se conserva/);
    assert.equal(calls, 1); assert.deepEqual(ports, before);
  }
});
test('NAP: lost RPC response after commit is uncertain, never claims the old assignment is retained', async () => {
  let assignment = 'old';
  await assert.rejects(reserveContractNap(async () => {
    assignment = 'destination';
    return { data: null, error: { message: 'Failed to fetch' } };
  }, { napId: 'nap', contractId: 'contract', clientId: 'client' }), error => {
    assert.match((error as Error).message, /consulta antes de reintentar/);
    assert.doesNotMatch((error as Error).message, /anterior se conserva/);
    return true;
  });
  assert.equal(assignment, 'destination');
});
test('NAP: successful and repeated requests rely on the transaction and return its port', async () => {
  const rpc = async () => ({ data: 'reserved-port', error: null });
  const input = { napId: 'nap', contractId: 'contract', clientId: 'client' };
  assert.equal(await reserveContractNap(rpc, input), 'reserved-port');
  assert.equal(await reserveContractNap(rpc, input), 'reserved-port');
});
test('NAP: missing contract does not call RPC; lost response is not reported as a confirmed reservation', async () => {
  let calls = 0;
  const rpc = async () => { calls++; return { data: null, error: null }; };
  await assert.rejects(reserveContractNap(rpc, { napId: 'nap', contractId: '', clientId: 'client' }));
  assert.equal(calls, 0);
  await assert.rejects(reserveContractNap(rpc, { napId: 'nap', contractId: 'contract', clientId: 'client' }), /consulta antes de reintentar/);
});

// ---- reserveContractNapSyncOntZone (Fase 158: NAP + zona de la ONT, una sola transaccion) ----

test('NAP+zona ONT: lee la fila devuelta (TABLE) y traduce sus 3 columnas', async () => {
  const rpc = async (name: string, args: Record<string, string>) => {
    assert.equal(name, 'assign_contract_nap_sync_ont_zone'); assert.equal(args.p_contract_id, 'contract');
    return { data: [{ nap_port_id: 'port-1', ont_zone_synced: true, ont_zone_skip_reason: null }], error: null };
  };
  const result = await reserveContractNapSyncOntZone(rpc, { napId: 'nap', contractId: 'contract', clientId: 'client' });
  assert.deepEqual(result, { napPortId: 'port-1', ontZoneSynced: true, ontZoneSkipReason: null });
});

test('NAP+zona ONT: sin ONT vinculada — ontZoneSynced false con el motivo, la NAP igual se confirma', async () => {
  const rpc = async () => ({ data: [{ nap_port_id: 'port-1', ont_zone_synced: false, ont_zone_skip_reason: 'sin_ont_vinculada' }], error: null });
  const result = await reserveContractNapSyncOntZone(rpc, { napId: 'nap', contractId: 'contract', clientId: 'client' });
  assert.deepEqual(result, { napPortId: 'port-1', ontZoneSynced: false, ontZoneSkipReason: 'sin_ont_vinculada' });
});

test('NAP+zona ONT: rechazo de permisos (SOPORTE/FACTURACION/etc.) nunca se reporta como exito parcial', async () => {
  const rpc = async () => ({ data: null, error: { message: 'No tienes permisos para esta accion', code: '42501' } });
  await assert.rejects(
    reserveContractNapSyncOntZone(rpc, { napId: 'nap', contractId: 'contract', clientId: 'client' }),
    /anterior \(NAP y zona de la ONT\) se conserva/,
  );
});

test('NAP+zona ONT: respuesta perdida tras aplicar (sin codigo) nunca reporta la reserva anterior como vigente', async () => {
  await assert.rejects(
    reserveContractNapSyncOntZone(async () => ({ data: null, error: { message: 'Failed to fetch' } }), { napId: 'nap', contractId: 'contract', clientId: 'client' }),
    error => { assert.doesNotMatch((error as Error).message, /anterior/); return true; },
  );
});
