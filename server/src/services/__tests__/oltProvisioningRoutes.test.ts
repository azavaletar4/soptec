import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createOltProvisioningRoutes } from '../../routes/oltProvisioning';
import { validateProvisioningContract } from '../provisioningContract';
import { createFakeProvisioningStore } from './fakeProvisioningStore';
import { startFakeOltCli } from './fakeOltCli';
import { runTelnetCommands } from '../../telnet/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../../telnet/__tests__/fakeOltServer';
import type { Role } from '../../types';
import type { ProvisionHandlerResult } from '../oltProvisioningHandler';

const input = () => ({ idempotencyKey: 'request', slot: 2, port: 2, serial: 'HWTCABD21CB4', onuType: 'GPT-2741GNAC', vlan: 120,
  tcontProfile: 'UP', trafficProfile: 'DOWN', clientId: 'client', contractId: 'contract',
  pppoeReference: { deviceId: 'router', username: 'prueba', profile: 'Profile_Balanceador' } });
let nextDevice = 0;
async function fixture(role: Role | null = 'ADMIN') {
  const commands: string[] = []; const calls: string[] = [];
  const secrets = [{ '.id': '*1', name: 'prueba', profile: 'Profile_Balanceador', disabled: true, password: 'fake-password' }];
  const cli = await startFakeOltCli({ onCommand: command => commands.push(command) });
  const fake = createFakeProvisioningStore(); const deviceId = `routes-${++nextDevice}`;
  const app = new Hono();
  // Inject an authenticated principal; JWT/network verification is outside this test.
  app.use('*', async (c, next) => {
    if (!role) return c.json({ error: 'No autenticado' }, 401);
    c.set('user', { id: 'test-user', role }); await next();
  });
  app.route('/', createOltProvisioningRoutes({ store: fake.store, buildDeps: async (_id, body, raw) => ({
    store: fake.store, deviceId, withOltLock: fn => fn(),
    preflight: () => validateProvisioningContract({
      getContract: async id => id === 'contract' ? { id, client_id: 'client', mikrotik_device_id: 'router', pppoe_username: 'prueba', mikrotik_profile: 'Profile_Balanceador' } : null,
      hasOtherContract: async () => false,
      readSecrets: async routerId => { calls.push('GET:' + routerId); return secrets; },
    }, body),
    buildSyncWan: (raw.wan as { password?: string } | undefined)?.password ? () => async () => {
      calls.push('WAN:' + body.wan?.username);
    } : undefined,
    runTelnet: (commands, opts) => runTelnetCommands({ host: '127.0.0.1', port: cli.port, username: TEST_USERNAME, password: TEST_PASSWORD }, commands, { ...opts, timeoutMs: 1000 }),
  }) }));
  const post = (url: string, body: unknown) => app.request(`/${deviceId}/onts` + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { app, fake, deviceId, commands, calls, secrets, post, close: () => cli.close() };
}

test('HTTP: both URLs reject missing/invalid contracts and references before Telnet and insertion', async () => {
  const f = await fixture();
  try {
    for (const url of ['', '/provision']) for (const changed of [
      { clientId: null, contractId: null }, { contractId: 'missing' }, { clientId: 'other' },
      { pppoeReference: { ...input().pppoeReference, deviceId: 'other' } },
      { mikrotik: { deviceId: 'router', secretMode: 'create', profile: 'Profile_Balanceador', newSecretName: 'new' } },
    ]) {
      assert.equal((await f.post(url, { ...input(), ...changed })).status, 400);
    }
    assert.deepEqual(f.commands, []); assert.equal(f.fake._operations.size, 0); assert.equal(f.fake._onts.size, 0);
  } finally { await f.close(); }
});
test('HTTP: old URL shares idempotency with new URL, returns verified ONT and never changes PPPoE', async () => {
  const f = await fixture();
  try {
    const before = structuredClone(f.secrets);
    const first = await f.post('', input()); assert.equal(first.status, 200);
    const firstBody = await first.json() as ProvisionHandlerResult; assert.equal(firstBody.operation?.status, 'completed'); assert.ok(firstBody.ont);
    const commandCount = f.commands.length; const readCount = f.calls.length;
    const replay = await f.post('/provision', input()); assert.equal(replay.status, 200);
    assert.equal((await replay.json() as ProvisionHandlerResult).ont?.id, firstBody.ont.id);
    assert.equal(f.commands.length, commandCount); assert.equal(f.calls.length, readCount);
    assert.equal(f.commands.filter(c => /^onu \d+ type /.test(c)).length, 1);
    assert.deepEqual(f.secrets, before); assert.ok(f.calls.every(c => c === 'GET:router'));
    const changed = await f.post('', { ...input(), pppoeReference: { ...input().pppoeReference, username: 'other' } });
    assert.equal(changed.status, 409); assert.equal(f.commands.length, commandCount);
  } finally { await f.close(); }
});
test('HTTP: old consumer without a key fails safely instead of direct registration', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.post('', { ...input(), idempotencyKey: undefined })).status, 400);
    assert.deepEqual(f.commands, []); assert.equal(f.fake._operations.size, 0);
  } finally { await f.close(); }
});
test('HTTP: historical ONT and completed operation without contract remain readable and unchanged', async () => {
  const f = await fixture();
  try {
    f.fake._onts.set('historical', { id: 'historical', serial: input().serial, port: 9, client_id: null, contract_id: null });
    const old = await f.fake.store.insertOperation({ idempotency_key: 'historical', olt_device_id: f.deviceId, serial: input().serial, frame: 1, slot: 2, port: 9,
      client_id: null, contract_id: null, requested: { onuType: 'old', vlan: 100 } });
    await f.fake.store.updateOperation(old.data!.id, { status: 'completed', ont_db_id: 'historical', onu_id: 9 });
    const before = structuredClone([...f.fake._onts.values()]);
    assert.equal((await f.app.request(`/${f.deviceId}/onts/operations/${old.data!.id}`)).status, 200);
    const restored = await f.post(`/operations/${old.data!.id}/reconcile`, {});
    assert.equal(restored.status, 200); assert.equal((await restored.json() as ProvisionHandlerResult).ont?.contract_id, null);
    assert.deepEqual([...f.fake._onts.values()], before); assert.deepEqual(f.commands, []);
    const created = await f.post('/provision', input()); assert.equal(created.status, 200);
    assert.deepEqual(f.fake._onts.get('historical'), before[0]);
    assert.equal(f.fake._onts.size, 2);
  } finally { await f.close(); }
});
test('HTTP: authentication and provisioning role guard both URLs', async () => {
  for (const role of [null, 'TECNICO_RED', 'SOPORTE', 'FACTURACION', 'CLIENTE'] as const) {
    const f = await fixture(role);
    try {
      for (const url of ['', '/provision']) assert.equal((await f.post(url, input())).status, role ? 403 : 401);
      assert.deepEqual(f.commands, []); assert.equal(f.fake._operations.size, 0);
    } finally { await f.close(); }
  }
});
test('HTTP: recovery preserves requested WAN/reference targets and never persists the retry password', async () => {
  const f = await fixture();
  try {
    const first = await f.post('/provision', { ...input(), wan: { username: 'prueba', vlanProfile: '120' } });
    const pending = await first.json() as ProvisionHandlerResult;
    assert.equal(pending.operation?.status, 'mikrotik_pending');
    const raw = { wan: { username: 'other', vlanProfile: '999', password: 'fake-retry-secret' },
      pppoeReference: { deviceId: 'other', username: 'other', profile: 'other' } };
    const result = await f.post(`/operations/${pending.operation!.id}/reconcile`, raw);
    assert.equal(result.status, 200);
    const recovered = await result.json() as ProvisionHandlerResult;
    assert.equal(recovered.operation?.status, 'completed');
    assert.deepEqual(recovered.operation?.requested.pppoeReference, input().pppoeReference);
    assert.deepEqual(recovered.operation?.requested.wan, { username: 'prueba', vlanProfile: '120' });
    assert.equal(JSON.stringify(recovered).includes('fake-retry-secret'), false);
    assert.ok(f.calls.includes('WAN:prueba')); assert.ok(!f.calls.includes('WAN:other'));
    assert.equal(f.commands.filter(c => /^onu \d+ type /.test(c)).length,1);
    assert.equal((await f.post(`/operations/${pending.operation!.id}/reconcile`, null)).status,400);
  } finally { await f.close(); }
});
