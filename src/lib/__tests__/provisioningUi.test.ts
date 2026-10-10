import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvisioningKey, classifyProvisioningResult, validateProvisioningWan, filterStalePendingOnus } from '../provisioningUi';
test('HTTP LAN: fallback makes unique UUID v4 keys without randomUUID', () => {
  const cryptoApi = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const a = createProvisioningKey(cryptoApi); const b = createProvisioningKey(cryptoApi);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.notEqual(a, b);
});
test('pending ONUs: old cache excludes a newer linked registration at the same PON only', () => {
  const item = { serial: 'HWTC1234', frame: 1, slot: 2, port: 2 };
  const moved = { ...item, port: 9 };
  const ont = { ...item, created_at: '2026-10-09T19:37:00Z', contract_id: 'contract' };
  const cached = '2026-10-09T19:26:00Z';
  assert.deepEqual(filterStalePendingOnus([item, moved], [ont], cached, false), [moved]);
  assert.deepEqual(filterStalePendingOnus([item], [ont], cached, true), [item]);
  assert.deepEqual(filterStalePendingOnus([item], [ont], '2026-10-09T20:00:00Z', false), [item]);
  assert.deepEqual(filterStalePendingOnus([item], [ont], null, false), [item]);
  assert.deepEqual(filterStalePendingOnus([item], [{ ...ont, contract_id: null }], cached, false), [item]);
});
test('WAN: existing PPPoE requires a password unless explicitly deferred', () => {
  assert.match(validateProvisioningWan(false, '')!, /contraseña PPPoE/);
  assert.match(validateProvisioningWan(false, '   ')!, /contraseña PPPoE/);
  assert.equal(validateProvisioningWan(false, 'secret'), null);
  assert.equal(validateProvisioningWan(true, ''), null);
});
test('WAN: completed registration with an omitted WAN shows manual configuration without claiming internet', () => {
  const base = { operation: { status: 'completed', contract_id: 'contract', requested: {} }, outcome: { kind: 'registered' }, ont: { id: '1' } };
  const deferred = classifyProvisioningResult(base);
  assert.equal(deferred.complete, true);
  assert.match(deferred.warnings[0]!, /WAN en modo manual/);
  const configured = classifyProvisioningResult({ ...base, operation: { ...base.operation, requested: { ...base.operation.requested, wan: { username: 'prueba', vlanProfile: '120' } } } });
  assert.deepEqual(configured.warnings, []);
});
test('UI: missing ONT, pending stage or persistence warning prevents success', () => {
  const base = { operation: { status: 'completed' }, outcome: { kind: 'registered' }, ont: { id: '1' } };
  assert.equal(classifyProvisioningResult(base).complete, true);
  for (const result of [{ ...base, ont: null }, { ...base, operation: { status: 'mikrotik_pending' } }, { ...base, persistenceWarning: 'DB failed' }, { ...base, outcome: { kind: 'verify_uncertain' } }]) {
    assert.equal(classifyProvisioningResult(result).complete, false);
  }
});
