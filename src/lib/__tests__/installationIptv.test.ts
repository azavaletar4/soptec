import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareInstallationIptv, requiresIptvMode, iptvModeLabel, IPTV_INSTALLATION_OPTIONS } from '../installationIptv';

const installation = { id: 'i', client_id: 'c', contract_id: 'k', status: 'in_progress' as const, iptv_policy_version: 1 as const };
const contract = { id: 'k', client_id: 'c', service_type: 'internet_combo' as const, xui_line_id: 10 };
const forbidden = async () => { throw new Error('No se debe llamar al servidor'); };
test('modalidad se aplica solo a nuevas Altas Dúo del cliente y contrato exactos', () => {
  assert.equal(requiresIptvMode(installation, contract), true);
  for (const c of [{ ...contract, id: 'otro' }, { ...contract, client_id: 'otro' }, { ...contract, xui_line_id: null }, { ...contract, service_type: 'solo_iptv' as const }, null]) {
    assert.equal(requiresIptvMode(installation, c), false);
  }
  assert.equal(requiresIptvMode({ ...installation, iptv_policy_version: null }, contract), false);
  assert.equal(requiresIptvMode(null, contract), false);
});
test('tres opciones explícitas, sin asumir TV Box por defecto', () => {
  assert.deepEqual(IPTV_INSTALLATION_OPTIONS.map(o => o.value), ['smart_tv_app', 'customer_device', 'rayco_tv_box']);
  assert.equal(iptvModeLabel(null), 'Sin registrar');
  assert.equal(iptvModeLabel('customer_device'), 'Dispositivo propio del cliente');
});
test('frontend previo a migración y órdenes legacy no llaman RPC nueva ni escriben campos', async () => {
  const { iptv_policy_version: unused, ...beforeMigration } = installation;
  assert.deepEqual(await prepareInstallationIptv(forbidden, beforeMigration, 'c', 'k', null), { patch: {}, alreadyCompleted: false });
  assert.deepEqual(await prepareInstallationIptv(forbidden, { ...installation, iptv_policy_version: null }, 'c', 'k', 'smart_tv_app'), { patch: {}, alreadyCompleted: false });
});
for (const mode of ['smart_tv_app', 'customer_device', 'rayco_tv_box', null]) {
  test(`preflight ${mode}: consulta validador del trigger y prepara el UPDATE final`, async () => {
    const calls: unknown[] = [];
    const result = await prepareInstallationIptv(async (name, args) => {
      calls.push([name, args]);
      return { data: { valid: true, installationId: 'i', clientId: 'c', contractId: 'k', mode }, error: null };
    }, installation, 'c', 'k', mode);
    assert.deepEqual(calls, [['installation_iptv_preflight', { p_installation_id: 'i', p_contract_id: 'k', p_mode: mode }]]);
    assert.deepEqual(result, { patch: { iptv_installation_mode: mode }, alreadyCompleted: false });
  });
}
test('error del trigger llega intacto; RPC ausente no tiene fallback', async () => {
  const error = { message: 'Asigna un TV Box desde custodia', code: 'PIP07' };
  await assert.rejects(prepareInstallationIptv(async () => ({ data: null, error }), installation, 'c', 'k', 'rayco_tv_box'), e => e === error);
});
test('errores/datos incompletos o de otro contrato nunca autorizan cierre', async () => {
  for (const data of [null, {}, { valid: true, installationId: 'i', clientId: 'c', contractId: 'otro', mode: 'smart_tv_app' }]) {
    await assert.rejects(prepareInstallationIptv(async () => ({ data, error: null }), installation, 'c', 'k', 'smart_tv_app'), /No se pudo verificar/);
  }
  await assert.rejects(prepareInstallationIptv(forbidden, installation, 'otro', 'k', null), /cliente o contrato/);
  await assert.rejects(prepareInstallationIptv(forbidden, installation, 'c', 'otro', null), /cliente o contrato/);
  await assert.rejects(prepareInstallationIptv(forbidden, installation, 'c', 'k', 'inventada'), /modalidad IPTV válida/);
});
test('respuesta perdida: cierre nuevo con misma modalidad se reconoce solo leyendo', async () => {
  assert.deepEqual(await prepareInstallationIptv(forbidden, { ...installation, status: 'completed', iptv_installation_mode: 'smart_tv_app' }, 'c', 'k', 'smart_tv_app'), { patch: {}, alreadyCompleted: true });
});
test('nunca reintenta escrituras sobre históricos, canceladas o modalidad cerrada distinta', async () => {
  for (const i of [
    { ...installation, status: 'cancelled' as const },
    { ...installation, status: 'completed' as const, iptv_policy_version: null },
    { ...installation, status: 'completed' as const, iptv_installation_mode: 'rayco_tv_box' as const },
  ]) await assert.rejects(prepareInstallationIptv(forbidden, i, 'c', 'k', 'smart_tv_app'), /orden ya está cerrada/);
});
