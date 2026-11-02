// Ejecuta la función real validateWifiTrialContract() extraída del archivo
// real (mismo patrón de extracción por AST que contractAdministrativeCancellation.ui.test.mjs
// / contractCancelUnfulfilled.ui.test.mjs) con un supabaseAdmin falso en un
// contexto aislado — nunca toca Supabase real, nunca enciende/consulta la
// ONT retirada (serial HWTC1D3691B7), que ya no debe usarse para nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/tr069WifiTrial.ts', import.meta.url), 'utf8');

function extract(src, names) {
  const tree = ts.createSourceFile('isolated.ts', src, ts.ScriptTarget.Latest, true);
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node.getText(tree));
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && names.includes(d.name.text)) found.set(d.name.text, node.getText(tree));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const name of names) assert.ok(found.has(name), 'Elemento real ausente en tr069WifiTrial.ts: ' + name);
  return [...found.values()].map((t) => t.replace(/^export\s+/, '')).join('\n');
}

const CONTRACT_ID = 'bf6b0f88-3c55-4c9b-aca2-5dfa739e738c';
const ONT_ID = '00095d26-298e-42e0-a3aa-a6adde3ef2f5';
const WIFI_TRIAL_CONTRACT = 'CTR-2026-00214';
const WIFI_TEST_SERIAL = 'HWTC1D3691B7';
const WIFI_TEST_DEVICE = '00259E-HG8145X6%2D13-485754431D3691B7';

// Verifica que las constantes reales del archivo coincidan con las de esta
// prueba -- si alguien las cambia sin actualizar este test, falla aquí en
// vez de dar un falso PASS.
test('las constantes reales del archivo coinciden con las usadas en esta prueba', () => {
  assert.match(source, new RegExp("CONTRACT_ID = '" + CONTRACT_ID + "'"));
  assert.match(source, new RegExp("WIFI_TRIAL_CONTRACT = '" + WIFI_TRIAL_CONTRACT + "'"));
  assert.match(source, new RegExp("ONT_ID = '" + ONT_ID + "'"));
});

function harness({ ontRows, ontError = null, contract, contractError = null, tr069Rows, tr069Error = null }) {
  const calls = [];
  function queryFor(table) {
    const api = {
      select(cols) { calls.push([table, 'select', cols]); return api; },
      eq(col, val) { calls.push([table, 'eq', col, val]); return api; },
      is(col, val) { calls.push([table, 'is', col, val]); return Promise.resolve(table === 'olt_onts' ? { data: ontRows, error: ontError } : { data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: contract, error: contractError }); },
      then(resolve) { // tr069_devices nunca usa is()/maybeSingle(), resuelve directo tras eq()
        resolve({ data: tr069Rows, error: tr069Error });
      },
    };
    return api;
  }
  const context = {
    exports: {},
    supabaseAdmin: { from(table) { return queryFor(table); } },
    normalizeGponSerial: (s) => (s ?? '').trim().toUpperCase(),
    WIFI_TEST_SERIAL,
    WIFI_TEST_DEVICE,
  };
  const body = extract(source, ['CONTRACT_ID', 'ONT_ID', 'WIFI_TRIAL_CONTRACT', 'validateWifiTrialContract']);
  vm.runInNewContext(body + '\nexports.validateWifiTrialContract=validateWifiTrialContract;', context);
  return { api: context.exports, calls };
}

test('ONT retirada (0 filas) + contrato/tr069 correctos: pasa — ya no bloquea por una constante obsoleta', async () => {
  const h = harness({
    ontRows: [],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'cliente-real', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: null }],
  });
  await assert.doesNotReject(h.api.validateWifiTrialContract());
  // La excepción de "retirada" solo puede aplicar al contrato de prueba
  // documentado: la consulta real siempre filtra por ESE contract_id exacto
  // (nunca por serial ni de forma global), así que nunca podría confundirse
  // con la ausencia de una ONT de otro contrato cualquiera.
  assert.deepEqual(h.calls[0], ['olt_onts', 'select', 'id,serial,contract_id,client_id,retired_at']);
  assert.ok(h.calls.some(c => c[0] === 'olt_onts' && c[1] === 'eq' && c[2] === 'contract_id' && c[3] === CONTRACT_ID));
  // La excepción no omite las demás comprobaciones: contrato y asociación
  // GenieACS/TR-069 se siguen consultando y exigiendo igual.
  assert.ok(h.calls.some(c => c[0] === 'service_contracts' && c[1] === 'eq' && c[2] === 'id' && c[3] === CONTRACT_ID));
  assert.ok(h.calls.some(c => c[0] === 'tr069_devices' && c[1] === 'eq' && c[2] === 'genieacs_id' && c[3] === WIFI_TEST_DEVICE));
});

test('ONT retirada para NUESTRO contrato, pero otro contrato cualquiera sí tiene una fila activa: sigue tratándose como retirado solo por su propio contract_id, nunca cruza identidades', async () => {
  // Simula lo que devolvería Supabase real: la consulta de olt_onts ya
  // filtra por contract_id=CONTRACT_ID en el servidor, así que una fila de
  // OTRO contrato (aunque comparta el mismo serial de prueba) nunca llega
  // a esta función -- por eso el mock sigue devolviendo [] para CONTRACT_ID
  // mientras se prueba que la consulta jamás se relaja a "cualquier serial"
  // o "cualquier contrato".
  const h = harness({
    ontRows: [],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'cliente-real', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: null }],
  });
  await assert.doesNotReject(h.api.validateWifiTrialContract());
  const ontEq = h.calls.filter(c => c[0] === 'olt_onts' && c[1] === 'eq');
  assert.deepEqual(ontEq, [['olt_onts', 'eq', 'contract_id', CONTRACT_ID]]);
  assert.ok(!ontEq.some(c => c[2] === 'serial'), 'la consulta real nunca filtra por serial, solo por contract_id');
});

test('caso feliz original (1 fila, id y serial correctos) sigue pasando sin cambios', async () => {
  const h = harness({
    ontRows: [{ id: ONT_ID, serial: WIFI_TEST_SERIAL, contract_id: CONTRACT_ID, client_id: 'cliente-real', retired_at: null }],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'cliente-real', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: CONTRACT_ID }],
  });
  await assert.doesNotReject(h.api.validateWifiTrialContract());
});

test('ONT PRESENTE pero con otro id (caso peligroso real, diagnosticado 30/10): sigue bloqueando', async () => {
  const h = harness({
    ontRows: [{ id: 'id-distinto-00000000-0000-0000-0000-000000000000', serial: WIFI_TEST_SERIAL, contract_id: CONTRACT_ID, client_id: 'x', retired_at: null }],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'x', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: null }],
  });
  await assert.rejects(h.api.validateWifiTrialContract(), /La ONT o el contrato exacto no coinciden/);
});

test('ONT presente con id correcto pero OTRO serial: sigue bloqueando', async () => {
  const h = harness({
    ontRows: [{ id: ONT_ID, serial: 'HWTC00000000', contract_id: CONTRACT_ID, client_id: 'x', retired_at: null }],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'x', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: null }],
  });
  await assert.rejects(h.api.validateWifiTrialContract(), /La ONT o el contrato exacto no coinciden/);
});

test('dos filas para el mismo contrato (ambiguo): sigue bloqueando, ni retirado ni válido', async () => {
  const h = harness({
    ontRows: [
      { id: ONT_ID, serial: WIFI_TEST_SERIAL, contract_id: CONTRACT_ID, client_id: 'x', retired_at: null },
      { id: 'otra-fila', serial: WIFI_TEST_SERIAL, contract_id: CONTRACT_ID, client_id: 'x', retired_at: null },
    ],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'x', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: null }],
  });
  await assert.rejects(h.api.validateWifiTrialContract(), /La ONT o el contrato exacto no coinciden/);
});

test('error de consulta en olt_onts: falla cerrado, nunca se confunde con "retirada"', async () => {
  const h = harness({ ontRows: null, ontError: { message: 'conexión perdida' }, contract: null, tr069Rows: null });
  await assert.rejects(h.api.validateWifiTrialContract(), /La ONT o el contrato exacto no coinciden/);
});

test('retirada pero el contrato ya no es el esperado (número/estado): sigue bloqueando', async () => {
  const h = harness({
    ontRows: [],
    contract: { id: CONTRACT_ID, contract_number: 'CTR-OTRO', client_id: 'x', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: null }],
  });
  await assert.rejects(h.api.validateWifiTrialContract(), /Contrato\/cliente sin concordancia verificada/);
});

test('retirada pero tr069_devices apunta a OTRO contrato real: sigue bloqueando (nunca se relaja)', async () => {
  const h = harness({
    ontRows: [],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'x', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: WIFI_TEST_SERIAL, service_contract_id: 'otro-contrato-real' }],
  });
  await assert.rejects(h.api.validateWifiTrialContract(), /Asociación TR-069 distinta o ambigua/);
});

test('caso feliz original: tr069_devices con otro serial sigue bloqueando', async () => {
  const h = harness({
    ontRows: [{ id: ONT_ID, serial: WIFI_TEST_SERIAL, contract_id: CONTRACT_ID, client_id: 'x', retired_at: null }],
    contract: { id: CONTRACT_ID, contract_number: WIFI_TRIAL_CONTRACT, client_id: 'x', status: 'active' },
    tr069Rows: [{ genieacs_id: WIFI_TEST_DEVICE, cpe_serial: 'HWTC00000000', service_contract_id: null }],
  });
  await assert.rejects(h.api.validateWifiTrialContract(), /Asociación TR-069 distinta o ambigua/);
});
