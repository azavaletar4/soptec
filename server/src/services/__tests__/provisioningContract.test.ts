import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProvisioningContract, type ContractReferenceRepository, type ContractReference } from '../provisioningContract';
import type { ProvisionRequestBody } from '../oltProvisioningHandler';

const contract: ContractReference = { id: 'contract', client_id: 'client', mikrotik_device_id: 'router', pppoe_username: 'prueba', mikrotik_profile: 'Profile_Balanceador' };
const body = () => ({ clientId: 'client', contractId: 'contract', pppoeReference: { deviceId: 'router', username: 'prueba', profile: 'Profile_Balanceador' } });
function fixture() {
  const secrets = [{ '.id': '*1', name: 'prueba', profile: 'Profile_Balanceador', disabled: 'true', password: 'fake-secret' }];
  const calls: string[] = [];
  const repository: ContractReferenceRepository = {
    getContract: async id => { calls.push('contract'); return id === contract.id ? { ...contract } : null; },
    hasOtherContract: async () => { calls.push('conflict'); return false; },
    readSecrets: async id => { calls.push('GET:' + id); return secrets; },
  };
  return { repository, secrets, calls };
}
test('contract: missing identifiers, nonexistent contract and wrong client fail before RouterOS', async () => {
  for (const changed of [{ clientId: null }, { contractId: null }, { contractId: '' }, { contractId: 'missing' }, { clientId: 'other' }]) {
    const f = fixture();
    await assert.rejects(validateProvisioningContract(f.repository, { ...body(), ...changed }));
    assert.ok(!f.calls.some(c => c.startsWith('GET:')));
  }
});
test('contract: valid reference only reads and preserves secret password/profile/disabled state', async () => {
  const f = fixture(); const before = structuredClone(f.secrets);
  await validateProvisioningContract(f.repository, body());
  await validateProvisioningContract(f.repository, { clientId: 'client', contractId: 'contract' });
  assert.deepEqual(f.secrets, before);
  assert.deepEqual(f.calls, ['contract', 'conflict', 'GET:router', 'contract', 'conflict', 'GET:router']);
});
test('contract: mismatched router/user/profile, explicit creation and different WAN user are rejected', async () => {
  const invalid: Partial<ProvisionRequestBody>[] = [
    { pppoeReference: { ...body().pppoeReference, deviceId: 'other' } },
    { pppoeReference: { ...body().pppoeReference, username: 'other' } },
    { pppoeReference: { ...body().pppoeReference, profile: 'other' } },
    { mikrotik: { deviceId: 'router', secretMode: 'create', newSecretName: 'new', profile: 'Profile_Balanceador' } },
    { mikrotik: { deviceId: 'other', secretMode: 'existing', existingSecretId: '*1', existingSecretName: 'prueba', profile: 'Profile_Balanceador' } },
    { wan: { username: 'other', vlanProfile: '120' } },
  ];
  for (const changed of invalid) {
    const f = fixture(); await assert.rejects(validateProvisioningContract(f.repository, { ...body(), ...changed }));
    assert.ok(!f.calls.some(c => c.startsWith('GET:')));
  }
});
test('contract: unlinked, duplicated, stale ID, absent secret and real-profile mismatch fail without modifications', async () => {
  for (const kind of ['unlinked', 'duplicated', 'id', 'absent', 'profile', 'read-failure']) {
    const f = fixture();
    if (kind === 'unlinked') f.repository.getContract = async () => ({ ...contract, pppoe_username: null });
    if (kind === 'duplicated') f.repository.hasOtherContract = async () => true;
    if (kind === 'absent') f.secrets.length = 0;
    if (kind === 'profile') f.secrets[0]!.profile = 'actual-different-profile';
    if (kind === 'read-failure') f.repository.readSecrets = async () => { throw new Error('unavailable'); };
    const before = structuredClone(f.secrets);
    await assert.rejects(validateProvisioningContract(f.repository, { ...body(), pppoeReference: { ...body().pppoeReference, ...(kind === 'id' ? { secretId: '*wrong' } : {}) } }));
    assert.deepEqual(f.secrets, before);
  }
});
