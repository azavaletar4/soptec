// Caracterización de riesgos de publicación en 8086fba. Los PASS de las
// pruebas «brecha» reproducen fallos vigentes, no autorizan su publicación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
function api(source, name, context) {
  const tree = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  let code;
  function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) code = n.getText(tree); ts.forEachChild(n, visit); }
  visit(tree); assert.ok(code, name); context.exports = {};
  vm.runInNewContext(ts.transpileModule(code+'\nexports.fn='+name, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports.fn;
}
const view = read('../../src/views/campo/CampoTrabajoDetailView.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
test('brecha vigente: un borrador con solo modalidad IPTV se considera vacío y se elimina', async () => {
  const calls = [];
  const draft = { closureForm: { iptvInstallationMode: 'smart_tv_app' }, closurePhotos: {}, equipmentEntries: [], signatureBlob: null };
  const hasContent = api(view, 'draftHasContent', {});
  assert.equal(hasContent(draft), false);
  await api(view, 'persistDraft', {
    restoringDraft: false, isLockedForTecnico: { value: false }, ticketFrozen: { value: false },
    buildDraftSnapshot: () => draft, draftHasContent: hasContent, draftKey: 'publication-synthetic',
    clearDraft: async key => { calls.push(['clear', key]); }, saveDraft: async () => { calls.push(['save']); },
  })();
  assert.deepEqual(calls, [['clear', 'publication-synthetic']]);
});
test('restauración de borrador anterior conserva datos, fotos y ausencia explícita de modalidad', async () => {
  const data = { closureForm: { closureNotes: 'Nota sintética', clientCode: 'SYNTHETIC', napElementoId: 'nap', latitude: -1 }, closurePhotos: {}, equipmentEntries: [], signatureBlob: null };
  const form = { value: { closureNotes: '', clientCode: '', napElementoId: '', latitude: null, iptvInstallationMode: null } };
  await api(view, 'restoreDraft', {
    isLockedForTecnico: { value: false }, ticketFrozen: { value: false }, loadDraft: async () => data,
    draftKey: 'publication-synthetic', restoringDraft: false, closureForm: form, closurePhotos: { value: {} },
    equipmentEntries: { value: [] }, signatureBlob: { value: null }, photoPreviewUrls: { value: {} }, toast: { info() {} },
  })();
  assert.equal(form.value.closureNotes, 'Nota sintética'); assert.equal(form.value.clientCode, 'SYNTHETIC');
  assert.equal(form.value.iptvInstallationMode, null);
});
test('brecha operativa: un cierre antiguo sin modalidad bloquea los elementos siguientes de la cola', async () => {
  const items = [{ localId: 'old', jobId: 'i1' }, { localId: 'new', jobId: 'i2', iptvInstallationMode: 'customer_device' }];
  const visited = [], removed = [], errors = [];
  const flush = api(read('../../src/lib/offlineQueue.ts'), 'flushQueue', {
    isOnline: () => true, listQueuedClosures: async () => items,
    removeQueuedClosure: async id => { removed.push(id); }, markQueuedError: async (item, message) => { errors.push([item.localId, message]); },
  });
  const result = await flush(async item => { visited.push(item.localId); if (!item.iptvInstallationMode) throw new Error('Falta modalidad IPTV'); });
  assert.equal(result.synced, 0); assert.equal(result.remaining, 2);
  assert.deepEqual(visited, ['old']); assert.deepEqual(removed, []); assert.equal(errors[0][0], 'old');
});
test('brecha operativa: código anterior escribe evidencia antes del rechazo tardío de PostgreSQL', async () => {
  const old = execFileSync('git', ['show', '8086fba^:src/stores/campo.ts'], { encoding: 'utf8', windowsHide: true });
  const calls = [];
  const query = table => {
    const b = {
      select() { return b; }, eq() { return b; }, async maybeSingle() { return { data: null, error: null }; },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      async upsert() { calls.push(table); return { error: null }; },
    }; return b;
  };
  const close = api(old, 'performClosureSubmitInner', {
    assertWorkOrderMutable: async () => {}, checkMaterialClosure: async fn => fn(),
    supabase: { from: query, rpc: async () => ({ error: null }) },
    contractsStore: { async updateContract() { calls.push('contract-code'); } },
    photosAlreadyUploaded: () => new Map(), equipmentTypesAlreadyUploaded: () => new Set(),
    resolveClosureTargetZoneId: () => null, describeOntZoneSyncOutcome: () => null,
    installationsStore: { async updateStatus() { calls.push('status'); throw new Error('Selecciona cómo se instaló IPTV'); } },
  });
  await assert.rejects(close({ jobType: 'installation', jobId: 'synthetic', clientId: 'c', contractId: 'k', clientCode: 'SYNTHETIC', photos: [], equipmentPhotos: [], signatureBlob: null, napElementoId: null, zoneId: null }), /Selecciona cómo/);
  assert.deepEqual(calls, ['contract-code', 'work_order_closures', 'status']);
});
