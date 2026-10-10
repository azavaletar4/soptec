import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeProvisioningStore } from './fakeProvisioningStore';
import { handleProvisionRequest, handleReconcileRequest, type ProvisionRequestBody, type ProvisionHandlerDeps } from '../oltProvisioningHandler';
import { startFakeOltCli } from './fakeOltCli';
import { runTelnetCommands } from '../../telnet/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../../telnet/__tests__/fakeOltServer';
import { withOltLock } from '../oltTelnetLock';

const body = (): ProvisionRequestBody => ({ idempotencyKey: 'request-1', slot: 2, port: 2,
  serial: 'HWTCABD21CB4', onuType: 'GPT-2741GNAC', vlan: 120,
  tcontProfile: 'UP', trafficProfile: 'DOWN', clientId: 'client-1', contractId: 'contract-1',
  mikrotik: { deviceId: 'router', secretMode: 'existing', existingSecretName: 'client', existingSecretId: '*1', profile: '100M' },
  wan: { username: 'client', vlanProfile: '120' } });
let count = 0;
async function scenario(fn: (deps: ProvisionHandlerDeps, fake: ReturnType<typeof createFakeProvisioningStore>, calls: { mikro: number; wan: number; commands: string[] }) => Promise<void>) {
  const calls = { mikro: 0, wan: 0, commands: [] as string[] };
  const cli = await startFakeOltCli({ onCommand: cmd => calls.commands.push(cmd) });
  const fake = createFakeProvisioningStore();
  const deviceId = `handler-${++count}`;
  const deps: ProvisionHandlerDeps = { store: fake.store, deviceId, preflight: async () => {},
    withOltLock: fn => withOltLock(deviceId, fn),
    runTelnet: commands => runTelnetCommands({ host: '127.0.0.1', port: cli.port, username: TEST_USERNAME, password: TEST_PASSWORD }, commands, { timeoutMs: 1000 }),
    syncMikrotik: async () => { calls.mikro++; }, buildSyncWan: () => async () => { calls.wan++; } };
  try { await fn(deps, fake, calls); } finally { await cli.close(); }
}

test('handler: completes and replay returns ONT without repeated external writes', () => scenario(async (deps, fake, calls) => {
  const first = await handleProvisionRequest(deps, body());
  assert.equal(first.operation?.status, 'completed'); assert.ok(first.ont);
  const replay = await handleProvisionRequest(deps, body());
  assert.equal(replay.ont?.id, first.ont.id); assert.equal(calls.mikro, 1); assert.equal(calls.wan, 1);
  assert.equal(fake._operations.size, 1);
}));

test('handler: concurrent same-key requests run the entire pipeline once', () => scenario(async (deps, fake, calls) => {
  const results = await Promise.all([handleProvisionRequest(deps, body()), handleProvisionRequest(deps, body())]);
  assert.ok(results.every(r => r.operation?.status === 'completed'));
  assert.equal(calls.mikro, 1); assert.equal(calls.wan, 1); assert.equal(fake._operations.size, 1);
  assert.equal(calls.commands.filter(c => /^onu \d+ type /.test(c)).length, 1);
}));

test('handler: changed client, contract, description, NAP or router rejects same key before IO', () => scenario(async (deps, _fake, calls) => {
  await handleProvisionRequest(deps, body()); const before = calls.commands.length;
  for (const changed of [{ clientId: 'client-2' }, { contractId: 'contract-2' }, { description: 'changed' }, { napId: 'nap-2' },
    { mikrotik: { ...body().mikrotik!, deviceId: 'router-2' } }]) {
    const result = await handleProvisionRequest(deps, { ...body(), ...changed }); assert.equal(result.httpStatus, 409);
  }
  assert.equal(calls.commands.length, before);
}));

test('handler: missing callbacks on reconcile preserve requested pending stages', () => scenario(async (deps, _fake, calls) => {
  deps.syncMikrotik = async () => { calls.mikro++; throw new Error('router unavailable'); };
  const first = await handleProvisionRequest(deps, body());
  assert.equal(first.operation?.status, 'mikrotik_pending'); assert.equal(calls.wan, 1);
  const next = await handleReconcileRequest({ ...deps, syncMikrotik: undefined, buildSyncWan: undefined }, first.operation!.id);
  assert.equal(next.operation?.status, 'mikrotik_pending'); assert.equal(next.mikrotikOk, false); assert.equal(calls.wan, 1);
}));

test('handler: retries failed MikroTik, skips confirmed DB and WAN', () => scenario(async (deps, fake, calls) => {
  let fail = true;
  deps.syncMikrotik = async () => { calls.mikro++; if (fail) throw new Error('timeout'); };
  const first = await handleProvisionRequest(deps, body()); const ont = first.ont!.id;
  fail = false; const next = await handleReconcileRequest(deps, first.operation!.id);
  assert.equal(next.operation?.status, 'completed'); assert.equal(next.ont?.id, ont);
  assert.equal(calls.mikro, 2); assert.equal(calls.wan, 1);
  assert.equal(next.operation?.steps.filter(s => s.stage === 'db').length, 1); assert.equal(fake._onts.size, 1);
}));

test('handler: journal failure stops before OLT mutation', () => scenario(async (deps, fake, calls) => {
  fake.failures.appendStepOnce = true;
  const result = await handleProvisionRequest(deps, body());
  assert.equal(result.httpStatus, 207); assert.ok(result.persistenceWarning);
  assert.equal(calls.commands.filter(c => /^onu \d+ type /.test(c)).length, 0); assert.equal(calls.mikro, 0);
}));

test('handler: resolved ID persistence failure stops before OLT mutation', () => scenario(async (deps, fake, calls) => {
  fake.failures.updateOperationOnce = true;
  const result = await handleProvisionRequest(deps, body());
  assert.equal(result.httpStatus, 207); assert.ok(result.persistenceWarning);
  assert.equal(calls.commands.filter(c => /^onu \d+ type /.test(c)).length, 0);
}));

test('handler: completed row without its ONT is never a success', () => scenario(async (deps, fake) => {
  const first = await handleProvisionRequest(deps, body()); fake._onts.clear();
  const next = await handleReconcileRequest(deps, first.operation!.id);
  assert.equal(next.httpStatus, 500); assert.ok(next.persistenceWarning); assert.equal(next.ont, null);
}));

test('handler: secret values are removed from errors, history and response', () => scenario(async (deps, fake) => {
  deps.sensitiveValues = ['a secret with spaces'];
  deps.syncMikrotik = async () => { throw new Error('router echoed a secret with spaces'); };
  const result = await handleProvisionRequest(deps, body());
  assert.equal(JSON.stringify(result).includes('a secret with spaces'), false);
  assert.equal(JSON.stringify([...fake._operations.values()]).includes('a secret with spaces'), false);
}));

test('handler: failed NAP assignment keeps DB pending and retries the link', () => scenario(async (deps) => {
  let fail = true; deps.syncLinks = async () => { if (fail) throw new Error('NAP full'); };
  const first = await handleProvisionRequest(deps, { ...body(), napId: 'nap-1' });
  assert.equal(first.operation?.status, 'linking');
  fail = false; const next = await handleReconcileRequest(deps, first.operation!.id);
  assert.equal(next.operation?.status, 'completed');
}));

test('handler: final save failure returns a warning and reuses confirmed stages on recovery', () => scenario(async (deps, fake, calls) => {
  const update = deps.store.updateOperation;
  let fail = true;
  deps.store.updateOperation = async (id, patch) => {
    if (patch.status && fail) { fail = false; return { data: null, error: 'database offline' }; }
    return update(id, patch);
  };
  const first = await handleProvisionRequest(deps, body());
  assert.equal(first.httpStatus, 207); assert.ok(first.persistenceWarning);
  assert.notEqual(first.operation?.status, 'completed');
  const next = await handleReconcileRequest(deps, first.operation!.id);
  assert.equal(next.operation?.status, 'completed'); assert.equal(calls.mikro, 1); assert.equal(calls.wan, 1);
  assert.equal(fake._onts.size, 1);
}));
