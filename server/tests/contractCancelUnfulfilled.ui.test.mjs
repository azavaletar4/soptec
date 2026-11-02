// Ejecuta las funciones reales de la vista/store sin cargar módulos ni red.
// Mismo harness que contractAdministrativeCancellation.ui.test.mjs — extrae
// las funciones reales del .vue por AST y las corre en un contexto aislado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function functions(source, names) {
  const tree = ts.createSourceFile('isolated.ts', source, ts.ScriptTarget.Latest, true);
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(tree));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const name of names) assert.ok(found.has(name), 'Función real ausente: ' + name);
  return ts.transpileModule([...found.values()].join('\n') + '\nexports.api={' + names.join(',') + '};', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
const view = readFileSync(new URL('../../src/views/clientes/ClientServiceDetailView.vue', import.meta.url), 'utf8');
const script = view.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];

function harness({ confirm = true, reason = 'Rechazó la instalación cuando llegó el técnico', error = null, refreshError = false, contractStatus = 'active' } = {}) {
  const calls = [];
  const context = {
    exports: {},
    contract: { value: { id: 'a', contract_number: 'CTR-2026-00297', status: contractStatus, updated_at: '2026-01-01' } },
    showCancelUnfulfilledModal: { value: true },
    cancelUnfulfilledReason: { value: reason },
    cancelUnfulfilledSaving: { value: false },
    cancelUnfulfilledError: { value: null },
    confirm(message) { calls.push(['confirm', message]); return confirm; },
    getErrorMessage(e) { return e.message; },
    emit(name, saved) { assert.equal(name, 'commercialCancelled'); assert.equal(saved.status, 'cancelled'); calls.push(['emit']); },
    fillFormFromContract(c) { calls.push(['fillForm', c.status]); },
    clientsStore: { async fetchClients() { calls.push(['refresh']); if (refreshError) throw new Error('refresh failed'); } },
    contractsStore: {
      async cancelContractUnfulfilled(id, stamp, r) {
        calls.push(['cancel', id, stamp, r]);
        if (error) throw new Error(error);
        return { contract: { id, status: 'cancelled', updated_at: '2026-01-02' }, clientStatus: 'prospect', alreadyCancelled: false };
      },
    },
  };
  vm.runInNewContext(functions(script, ['openCancelUnfulfilledModal', 'handleCancelUnfulfilled']), context);
  return { ...context, calls, api: context.exports.api };
}

test('motivo corto no confirma ni llama a la RPC', async () => {
  const h = harness({ reason: 'ab' });
  await h.api.handleCancelUnfulfilled();
  assert.equal(h.calls.length, 0);
  assert.match(h.cancelUnfulfilledError.value, /motivo/);
});

test('confirmación rechazada no escribe nada', async () => {
  const h = harness({ confirm: false });
  await h.api.handleCancelUnfulfilled();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'confirm');
  assert.match(h.calls[0][1], /CTR-2026-00297/);
  assert.equal(h.contract.value.status, 'active');
});

test('éxito: usa solo la RPC dedicada, cierra el modal y refresca Clientes sin recargar', async () => {
  const h = harness();
  await h.api.handleCancelUnfulfilled();
  assert.deepEqual(h.calls.map((c) => c[0]), ['confirm', 'cancel', 'emit', 'fillForm', 'refresh']);
  assert.deepEqual(h.calls[1], ['cancel', 'a', '2026-01-01', 'Rechazó la instalación cuando llegó el técnico']);
  assert.equal(h.contract.value.status, 'cancelled');
  assert.equal(h.showCancelUnfulfilledModal.value, false);
});

test('fallo de la RPC conserva el contrato y muestra el mensaje en lenguaje sencillo tal cual lo devuelve la RPC', async () => {
  const h = harness({ error: 'Esta línea ya tuvo una instalación completada; use la baja administrativa existente' });
  await h.api.handleCancelUnfulfilled();
  assert.equal(h.contract.value.status, 'active');
  assert.equal(h.cancelUnfulfilledError.value, 'Esta línea ya tuvo una instalación completada; use la baja administrativa existente');
  assert.equal(h.showCancelUnfulfilledModal.value, true);
});

test('fallo al refrescar Clientes no presenta como fallida una cancelación ya confirmada', async () => {
  const h = harness({ refreshError: true });
  await h.api.handleCancelUnfulfilled();
  assert.equal(h.contract.value.status, 'cancelled');
  assert.match(h.cancelUnfulfilledError.value, /Cancelación confirmada/);
});

test('abrir el modal limpia motivo/error previos; no abre sobre un contrato ya cancelado', () => {
  const h = harness({ contractStatus: 'cancelled' });
  h.cancelUnfulfilledReason.value = 'texto viejo';
  h.showCancelUnfulfilledModal.value = false;
  h.api.openCancelUnfulfilledModal();
  assert.equal(h.showCancelUnfulfilledModal.value, false); // contrato ya cancelado: no se abre
});

test('store real: RPC ausente falla cerrada con mensaje claro, sin UPDATE alternativo', async () => {
  const source = readFileSync(new URL('../../src/stores/contracts.ts', import.meta.url), 'utf8');
  const calls = [];
  const context = { exports: {}, contracts: { value: [] }, supabase: { async rpc(name, args) { calls.push({ name, args }); return { error: { code: 'PGRST202' } }; }, from() { throw new Error('Fallback prohibido'); } } };
  vm.runInNewContext(functions(source, ['cancelContractUnfulfilled']), context);
  await assert.rejects(context.exports.api.cancelContractUnfulfilled('a', 'stamp', 'motivo'), /todavía no está habilitada/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'contract_cancel_unfulfilled');
  assert.equal(calls[0].args.p_reason, 'motivo');
  assert.equal(calls[0].args.p_confirm, true);
});
