import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserveContractNap } from '../napAssignment';

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
