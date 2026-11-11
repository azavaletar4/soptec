// Ejecuta funciones reales de Vue/store extraídas por AST, con transporte
// sintético. No hay red, credenciales, órdenes reales ni escrituras externas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = p => readFileSync(new URL(p, import.meta.url), 'utf8');
function api(source, name, context) {
  const tree = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  let code;
  function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) code = n.getText(tree); ts.forEachChild(n, visit); }
  visit(tree); assert.ok(code, name);
  context.exports = {};
  vm.runInNewContext(ts.transpileModule(code + '\nexports.fn=' + name, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports.fn;
}
const campo = source('../../src/stores/campo.ts');
const admin = source('../../src/views/instalaciones/InstalacionDetailView.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
for (const mode of ['smart_tv_app', 'customer_device', 'rayco_tv_box']) {
  test(`cola offline conserva ${mode} y el reintento la entrega al cierre real`, async () => {
    let queued, submitted;
    const input = { jobType: 'installation', jobId: 'i', clientId: 'c', contractId: 'k', targetStatus: 'completed', iptvInstallationMode: mode, photos: [], equipmentPhotos: [] };
    const enqueue = api(campo, 'submitClosure', {
      auth: { user: { id: 'actor' } }, crypto: { randomUUID: () => 'operation' },
      isOnline: () => false, enqueueClosure: async data => { queued = data; }, refreshQueuedCount: async () => {},
    });
    assert.equal((await enqueue(input)).queued, true);
    assert.equal(queued.iptvInstallationMode, mode);
    const replay = api(campo, 'submitFromQueued', { performClosureSubmit: async data => { submitted = data; return { ontZoneWarning: null }; } });
    await replay(queued);
    assert.equal(submitted.iptvInstallationMode, mode);
    assert.equal(submitted.contractId, 'k'); assert.equal(submitted.jobId, 'i');
  });
  test(`cierre administrativo ${mode} guarda modalidad y estado juntos`, async () => {
    const calls = [];
    const installation = { value: { id: 'i', client_id: 'c', contract_id: 'k', status: 'in_progress' } };
    const close = api(admin, 'applyStatusChange', {
      installation, iptvMode: { value: mode },
      prepareIptvSubmission: async () => { calls.push(['preflight','i','c','k',mode]); return { patch: { iptv_installation_mode: mode }, alreadyCompleted: false }; },
      installationsStore: {
        async prepareIptvClosure(...args) { calls.push(['preflight', ...args]); return { patch: { iptv_installation_mode: mode }, alreadyCompleted: false }; },
        async updateInstallation(id, patch) { calls.push(['update', id, patch]); return { ...installation.value, ...patch }; },
      }, alert: e => { throw new Error(e); }, getErrorMessage: e => e.message,
    });
    await close('completed');
    assert.deepEqual(calls[0], ['preflight', 'i', 'c', 'k', mode]);
    assert.equal(calls[1][2].status, 'completed'); assert.equal(calls[1][2].iptv_installation_mode, mode);
  });
}
test('rechazo IPTV aborta Campo antes de contratos, evidencias y cierre', async () => {
  const calls = [];
  const close = api(campo, 'performClosureSubmitInner', {
    closurePayloadHash: async () => 'hash',
    installationsStore: { async prepareIptvClosure() { calls.push('preflight'); throw new Error('Falta modalidad'); } },
    assertWorkOrderMutable: async () => { calls.push('otra operación'); },
  });
  await assert.rejects(close({ jobType: 'installation', jobId: 'i', clientId: 'c', contractId: 'k' }), /Falta modalidad/);
  assert.deepEqual(calls, ['preflight']);
});
test('respuesta perdida: Campo no vuelve a subir evidencia ni modifica una orden cerrada', async () => {
  const close = api(campo, 'performClosureSubmitInner', {
    closurePayloadHash: async () => 'hash',
    installationsStore: { async prepareIptvClosure() { return { patch: {}, alreadyCompleted: true }; } },
    assertWorkOrderMutable: () => { throw new Error('No debe mutar ni consultar otros módulos'); },
  });
  assert.equal((await close({ jobType: 'installation', jobId: 'i' })).ontZoneWarning, null);
});
test('preflight aprobado no omite la validación existente de materiales', async () => {
  const calls = [];
  const close = api(campo, 'performClosureSubmitInner', {
    closurePayloadHash: async () => 'hash',
    installationsStore: { async prepareIptvClosure() { calls.push('iptv'); return { patch: {}, alreadyCompleted: false }; } },
    assertWorkOrderMutable: async () => { calls.push('finality'); },
    checkMaterialClosure: async check => { await check(); throw new Error('Material pendiente'); },
    supabase: { async rpc(name) { calls.push(name); return {}; } },
  });
  await assert.rejects(close({ jobType: 'installation', jobId: 'i' }), /Material pendiente/);
  assert.deepEqual(calls, ['iptv', 'finality', 'assert_material_closure_ready']);
});
test('fallo de red al enviar también conserva modalidad en la cola', async () => {
  let queued;
  const close = api(campo, 'submitClosure', {
    auth: { user: { id: 'actor' } }, crypto: { randomUUID: () => 'operation' },
    isOnline: () => true, performClosureSubmit: async () => { throw new Error('sin red'); }, isNetworkError: () => true,
    enqueueClosure: async value => { queued = value; }, refreshQueuedCount: async () => {},
  });
  await close({ iptvInstallationMode: 'customer_device', photos: [], equipmentPhotos: [] });
  assert.equal(queued.iptvInstallationMode, 'customer_device');
});
