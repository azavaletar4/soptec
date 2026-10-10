import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncProvisioningSecret, type ProvisioningSecret, type RouterRequest } from '../provisioningMikrotik';
const input = { mode: 'create', name: 'client', password: 'private', profile: '100M', operationKey: 'key' };
function fakeRouter(initial: ProvisioningSecret[] = [], loseResponse = false) {
  const rows = initial; const calls: { method: string; retries?: number }[] = [];
  const request: RouterRequest = async <T>(_path: string, opts: { method?: string; body?: unknown; retries?: number } = {}): Promise<T> => {
    const method = opts.method ?? 'GET'; calls.push({ method, retries: opts.retries });
    if (method === 'PUT') {
      const data = opts.body as ProvisioningSecret; rows.push({ ...data, '.id': '*1' });
      if (loseResponse) { loseResponse = false; throw new Error('lost response'); }
    }
    if (method === 'PATCH') Object.assign(rows[0]!, opts.body);
    return structuredClone(rows) as T;
  };
  return { request, rows, calls };
}
test('MikroTik: creation uses PUT, disables blind retries and confirms result', async () => {
  const router = fakeRouter(); await syncProvisioningSecret(router.request, input);
  assert.equal(router.calls.filter(c => c.method === 'PUT').length, 1);
  assert.equal(router.calls.find(c => c.method === 'PUT')?.retries, 0);
  await syncProvisioningSecret(router.request, input);
  assert.equal(router.rows.length, 1); assert.equal(router.calls.filter(c => c.method === 'PUT').length, 1);
});
test('MikroTik: lost create response is reconciled by operation ownership', async () => {
  const router = fakeRouter([], true); await assert.rejects(syncProvisioningSecret(router.request, input));
  await syncProvisioningSecret(router.request, { ...input, password: undefined });
  assert.equal(router.rows.length, 1);
});
test('MikroTik: unrelated existing username is not overwritten', async () => {
  const router = fakeRouter([{ '.id': '*2', name: 'client', profile: 'other', comment: 'other' }]);
  await assert.rejects(syncProvisioningSecret(router.request, input), /otra operacion/);
  assert.ok(router.calls.every(c => c.method === 'GET'));
});
test('MikroTik: existing secret remains unchanged, including disabled state and actual profile', async () => {
  const router = fakeRouter([{ '.id': '*2', name: 'client', profile: 'old', service: 'pppoe', disabled: 'true' }]);
  await syncProvisioningSecret(router.request, { ...input, mode: 'existing', existingId: '*2' });
  assert.equal(router.rows[0]?.disabled, 'true'); assert.equal(router.rows[0]?.profile, 'old');
  assert.ok(router.calls.every(c => c.method === 'GET'));
});
test('MikroTik: changed existing ID cannot activate another secret', async () => {
  const router = fakeRouter([{ '.id': '*2', name: 'client', profile: 'old' }]);
  await assert.rejects(syncProvisioningSecret(router.request, { ...input, mode: 'existing', existingId: '*wrong' }));
  assert.ok(router.calls.every(c => c.method === 'GET'));
});
