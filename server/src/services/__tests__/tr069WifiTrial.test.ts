import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWifiTrial, WIFI_TRIAL_PATH, WIFI_TRIAL_PARAMETER } from '../tr069WifiTrial';
import { WIFI_TEST_DEVICE, WIFI_TEST_SERIAL } from '../tr069WifiPreparation';
import type { WifiInventory } from '../../../../src/lib/tr069WifiPlan';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifi-trial-'));
  const file = path.join(dir, 'trial.json');
  const timestamp = '2026-10-27T20:37:30.393Z';
  const state = { enabled: true, mismatch: false, pending: [] as { _id: string }[], faults: [] as object[], timeout: false, posts: [] as Record<string, unknown>[] };
  const inv: WifiInventory = { found: true, serial: WIFI_TEST_SERIAL, deviceId: WIFI_TEST_DEVICE, lastInform: timestamp,
    networks: [{ path: WIFI_TRIAL_PATH, ssid: 'Original', timestamp, enabled: null, band: 'Banda desconocida', writable: true }] };
  const dependencies = { file, enabled: () => state.enabled, contract: async () => { if (state.mismatch) throw Error('Contrato equivocado'); }, inventory: async () => inv,
    request: (async (url: string | URL | Request, init?: RequestInit) => {
      assert.ok(String(url).startsWith('http://nbi.invalid/')); assert.ok(!String(url).includes('connection_request'));
      if (init?.method === 'POST') {
        assert.ok(fs.existsSync(file), 'Respaldo persistido antes de cualquier POST');
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).operations.at(-1).state, 'sending');
        const task = JSON.parse(String(init.body)); state.posts.push(task);
        if (state.timeout) throw Error('synthetic timeout');
        const id = 'task-' + state.posts.length; state.pending.push({ _id: id }); return Response.json({ _id: id }, { status: 202 });
      }
      assert.equal(init?.method, 'GET');
      return Response.json(String(url).includes('/faults/') ? state.faults : state.pending);
    }) as typeof fetch };
  // Una lectura puntual guarda readSentAt, mientras el estado del cambio sigue queued.
  const req = dependencies.request;
  dependencies.request = (async (url, init) => {
    if (init?.method === 'POST' && String(init.body).includes('getParameterValues')) {
      state.posts.push(JSON.parse(String(init.body))); const id = 'task-' + state.posts.length; state.pending.push({ _id: id }); return Response.json({ _id: id }, { status: 202 });
    }
    return req(url, init);
  }) as typeof fetch;
  const service = createWifiTrial(dependencies);
  const body = { requestId: '00000000-0000-4000-8000-000000000001', confirmed: true, deviceId: WIFI_TEST_DEVICE, path: WIFI_TRIAL_PATH,
    ssid: 'Nuevo', expectedSsid: 'Original', expectedTimestamp: timestamp };
  return { service, dependencies, state, inv, file, body, cleanup: () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'wifi-trial-'));
    fs.rmSync(dir, { recursive: true, force: true });
  } };
}
const nbi = 'http://nbi.invalid';
test('cambio y restauración: un parámetro fijo, respaldo duradero, aceptación no es verificación, lectura posterior e Inform necesarios', async () => {
  const f = fixture(); try {
    const initial = await f.service.status(nbi, WIFI_TEST_SERIAL); assert.equal(initial.record, null); assert.equal(f.state.posts.length, 0);
    const queued = await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    assert.equal(queued.record!.originalSsid, 'Original'); assert.equal(queued.record!.operations[0].state, 'queued');
    assert.deepEqual(f.state.posts[0], { name: 'setParameterValues', parameterValues: [[WIFI_TRIAL_PARAMETER, 'Nuevo', 'xsd:string']] });
    await f.service.verify(nbi, WIFI_TEST_SERIAL); assert.equal(f.state.posts.length, 1, 'No leer mientras escritura pendiente');
    f.state.pending = [];
    await f.service.verify(nbi, WIFI_TEST_SERIAL);
    assert.deepEqual(f.state.posts[1], { name: 'getParameterValues', parameterNames: [WIFI_TRIAL_PARAMETER] });
    f.state.pending = [];
    let status = await f.service.status(nbi, WIFI_TEST_SERIAL); assert.equal(status.record!.operations[0].state, 'queued');
    const fresh = new Date(Date.now() + 2000).toISOString(); f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh;
    status = await f.service.status(nbi, WIFI_TEST_SERIAL); assert.equal(status.record!.operations[0].state, 'queued', 'Sin Inform no se verifica');
    f.inv.lastInform = fresh;
    status = await f.service.status(nbi, WIFI_TEST_SERIAL); assert.equal(status.record!.operations[0].state, 'verified');
    const restarted = createWifiTrial(f.dependencies);
    const restored = await restarted.restore(nbi, WIFI_TEST_SERIAL, { requestId: '00000000-0000-4000-8000-000000000002', confirmed: true }, 'superadmin');
    assert.equal(restored.record!.operations[1].kind, 'restore');
    assert.deepEqual(f.state.posts[2], { name: 'setParameterValues', parameterValues: [[WIFI_TRIAL_PARAMETER, 'Original', 'xsd:string']] });
  } finally { f.cleanup(); }
});
test('serial, deviceId, instancia, contrato, campos extra y confirmación: rechaza antes de enviar', async () => {
  const f = fixture(); try {
    await assert.rejects(f.service.change(nbi, 'HWTC00000000', f.body, 'admin'));
    for (const override of [{ path: WIFI_TRIAL_PATH.replace('.5', '.1') }, { deviceId: 'otro' }, { confirmed: false }, { password: 'SYNTHETIC' }, { pppoeUsername: 'SYNTHETIC' }, { ssid: '😀'.repeat(9) }, { expectedSsid: 'Cambió' }, { expectedTimestamp: 'otra' }]) {
      await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, ...override }, 'admin'));
    }
    f.state.mismatch = true; await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'));
    f.state.mismatch = false; f.state.enabled = false; await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'));
    assert.equal(f.state.posts.length, 0);
  } finally { f.cleanup(); }
});
test('tareas o faults previos bloquean; capacidad anunciada ausente también', async () => {
  const f = fixture(); try {
    f.state.pending = [{ _id: 'existing' }]; await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'));
    f.state.pending = []; f.state.faults = [{ _id: 'fault' }]; await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'));
    f.state.faults = []; f.inv.networks[0].writable = null; await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'));
    assert.equal(f.state.posts.length, 0);
  } finally { f.cleanup(); }
});
test('reintento idempotente y error de red no reenvían; restauración bloqueada mientras resultado incierto', async () => {
  const f = fixture(); try {
    f.state.timeout = true; const result = await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    assert.equal(result.record!.operations[0].state, 'uncertain');
    await createWifiTrial(f.dependencies).change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    assert.equal(f.state.posts.length, 1);
    await assert.rejects(f.service.restore(nbi, WIFI_TEST_SERIAL, { requestId: '00000000-0000-4000-8000-000000000002', confirmed: true }, 'admin'));
    assert.equal(f.state.posts.length, 1);
  } finally { f.cleanup(); }
});
test('GET de estado no envía tareas; faults no se convierten en éxito y no filtran cuerpos', async () => {
  const f = fixture(); try {
    await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'); const count = f.state.posts.length;
    f.state.faults = [{ _id: 'fault', detail: 'SYNTHETIC_SECRET' }];
    const status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'failed'); assert.equal(f.state.posts.length, count);
    assert.ok(!JSON.stringify(status).includes('SYNTHETIC_SECRET'));
  } finally { f.cleanup(); }
});
