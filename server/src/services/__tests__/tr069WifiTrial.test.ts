import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWifiTrial, WIFI_TRIAL_PATH, WIFI_TRIAL_PARAMETER, WIFI_TRIAL_PASSWORD_PARAMETER } from '../tr069WifiTrial';
import { WIFI_TEST_DEVICE, WIFI_TEST_SERIAL } from '../tr069WifiPreparation';
import type { WifiInventory } from '../../../../src/lib/tr069WifiPlan';

function sha256Hex(value: string) { return 'sha256:' + crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifi-trial-'));
  const file = path.join(dir, 'trial.json');
  const timestamp = '2026-10-27T20:37:30.393Z';
  const state = { enabled: true, mismatch: false, pending: [] as { _id: string }[], faults: [] as object[], timeout: false,
    posts: [] as Record<string, unknown>[], password: { value: null as string | null, timestamp: null as string | null } };
  const inv: WifiInventory = { found: true, serial: WIFI_TEST_SERIAL, deviceId: WIFI_TEST_DEVICE, lastInform: timestamp,
    networks: [{ path: WIFI_TRIAL_PATH, ssid: 'Original', timestamp, enabled: null, band: 'Banda desconocida', writable: true,
      passwordWritable: true, passwordTimestamp: null }] };
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
      if (String(url).includes('/devices/')) {
        // Nunca debe aparecer el valor real en una query/URL ni en ningún campo salvo _value
        // dentro del cuerpo simulado de GenieACS (equivalente al NBI real).
        assert.ok(!String(url).includes(state.password.value ?? 'SMARTRAYCO_NO_LEAK_SENTINEL'));
        const row = { _id: WIFI_TEST_DEVICE, InternetGatewayDevice: { LANDevice: { 1: { WLANConfiguration: { 5: {
          KeyPassphrase: state.password.value === null ? {} : { _value: state.password.value, _timestamp: state.password.timestamp },
        } } } } } };
        return Response.json([row]);
      }
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
    for (const override of [{ path: WIFI_TRIAL_PATH.replace('.5', '.1') }, { deviceId: 'otro' }, { confirmed: false }, { pppoeUsername: 'SYNTHETIC' }, { ssid: '😀'.repeat(9) }, { expectedSsid: 'Cambió' }]) {
      await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, ...override }, 'admin'));
    }
    f.state.mismatch = true; await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'));
    f.state.mismatch = false; f.state.enabled = false; await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'));
    assert.equal(f.state.posts.length, 0);
  } finally { f.cleanup(); }
});
test('un Inform periódico que solo refresca el timestamp (mismo SSID) no bloquea el envío real', async () => {
  const f = fixture(); try {
    // Simula el falso bloqueo reportado en la prueba manual: el SSID vigente sigue siendo
    // el mismo que vio el panel, pero GenieACS ya refrescó _timestamp con un Inform periódico.
    const stale = { ...f.body, expectedTimestamp: new Date(Date.now() - 300_000).toISOString() };
    const queued = await f.service.change(nbi, WIFI_TEST_SERIAL, stale, 'admin');
    assert.equal(queued.record!.operations[0].state, 'queued');
    assert.equal(f.state.posts.length, 1);
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

// ---- Contraseña WiFi (opcional, mismo formulario que el SSID) ----
const SYNTHETIC_PW = 'Synthetic#Pass1';
test('contraseña inválida (corta, larga, controles o multibyte) rechaza antes de enviar; nunca aparece en el error', async () => {
  const f = fixture(); try {
    for (const password of ['short1', 'a'.repeat(64), 'with\tcontrol1', '😀'.repeat(10), 'ñññññññ1']) {
      await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, password }, 'admin'), (e: Error) => {
        assert.ok(!e.message.includes(password)); return true;
      });
    }
    assert.equal(f.state.posts.length, 0);
  } finally { f.cleanup(); }
});
test('mismo SSID sin contraseña nueva no envía nada; mismo SSID con contraseña nueva sí', async () => {
  const f = fixture(); try {
    await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, ssid: 'Original' }, 'admin'), /no se indicó una contraseña/);
    assert.equal(f.state.posts.length, 0);
    const result = await f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, ssid: 'Original', password: SYNTHETIC_PW }, 'admin');
    assert.equal(result.record!.operations[0].after, 'Original', 'SSID no cambia si no se pidió');
    assert.equal(result.record!.operations[0].passwordChanged, true);
    assert.deepEqual(f.state.posts[0], { name: 'setParameterValues', parameterValues: [[WIFI_TRIAL_PASSWORD_PARAMETER, SYNTHETIC_PW, 'xsd:string']] });
    assert.ok(!JSON.stringify(result).includes(SYNTHETIC_PW), 'Nunca la contraseña real en la respuesta');
    assert.ok(!fs.readFileSync(f.file, 'utf8').includes(SYNTHETIC_PW), 'Nunca la contraseña real en el respaldo persistente');
  } finally { f.cleanup(); }
});
test('SSID + contraseña en una sola tarea atómica; se verifica solo cuando ambas huellas/timestamps confirman', async () => {
  const f = fixture(); try {
    const queued = await f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, password: SYNTHETIC_PW }, 'admin');
    assert.deepEqual(f.state.posts[0], { name: 'setParameterValues',
      parameterValues: [[WIFI_TRIAL_PARAMETER, 'Nuevo', 'xsd:string'], [WIFI_TRIAL_PASSWORD_PARAMETER, SYNTHETIC_PW, 'xsd:string']] });
    assert.equal(queued.record!.operations[0].afterPasswordHash, sha256Hex(SYNTHETIC_PW));
    f.state.pending = [];
    await f.service.verify(nbi, WIFI_TEST_SERIAL);
    assert.deepEqual(f.state.posts[1], { name: 'getParameterValues', parameterNames: [WIFI_TRIAL_PARAMETER, WIFI_TRIAL_PASSWORD_PARAMETER] });
    f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    let status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'queued', 'SSID confirmado pero contraseña sin leerse aún no verifica');
    f.state.password = { value: SYNTHETIC_PW, timestamp: fresh };
    status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'verified');
  } finally { f.cleanup(); }
});
test('contraseña leída no coincide (huella distinta): no verifica aunque el SSID sí confirmó', async () => {
  const f = fixture(); try {
    await f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, password: SYNTHETIC_PW }, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    f.state.password = { value: 'otra-cosa-distinta', timestamp: fresh };
    const status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'queued');
  } finally { f.cleanup(); }
});
test('sin capacidad de escritura confirmada para la contraseña, no se envía nada', async () => {
  const f = fixture(); try {
    f.inv.networks[0].passwordWritable = false;
    await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, password: SYNTHETIC_PW }, 'admin'), /capacidad de escritura/);
    f.inv.networks[0].passwordWritable = null;
    await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, password: SYNTHETIC_PW }, 'admin'), /capacidad de escritura/);
    assert.equal(f.state.posts.length, 0);
  } finally { f.cleanup(); }
});
test('restaurar nunca acepta contraseña: solo repite el SSID anterior', async () => {
  const f = fixture(); try {
    await assert.rejects(f.service.restore(nbi, WIFI_TEST_SERIAL, { requestId: '00000000-0000-4000-8000-000000000002', confirmed: true, password: SYNTHETIC_PW }, 'admin'));
  } finally { f.cleanup(); }
});

// ---- Un cambio ya confirmado no bloquea el siguiente para siempre (corrección del boton
// deshabilitado reportado en produccion): solo una tarea EN CURSO bloquea un envio nuevo. ----
test('tras un cambio verificado, un segundo cambio (solo nombre, solo contraseña o ambos) SI se permite', async () => {
  const f = fixture(); try {
    await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    let status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'verified', 'primer cambio ya confirmado');
    const second = await f.service.change(nbi, WIFI_TEST_SERIAL,
      { requestId: '00000000-0000-4000-8000-0000000000a2', confirmed: true, deviceId: WIFI_TEST_DEVICE, path: WIFI_TRIAL_PATH,
        ssid: 'Nuevo', expectedSsid: 'Nuevo', expectedTimestamp: fresh, password: SYNTHETIC_PW }, 'admin');
    assert.equal(second.record!.operations.length, 2, 'se agrega una segunda operacion, no se reemplaza la primera');
    assert.equal(second.record!.operations[1].state, 'queued');
    assert.equal(second.record!.operations[1].passwordChanged, true);
  } finally { f.cleanup(); }
});
test('mientras el cambio anterior sigue sin confirmar (queued/uncertain), un cambio nuevo SI bloquea', async () => {
  const f = fixture(); try {
    const queued = await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    assert.equal(queued.record!.operations[0].state, 'queued');
    await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL,
      { ...f.body, requestId: '00000000-0000-4000-8000-0000000000a3', expectedSsid: 'Original' }, 'admin'), /sin confirmar/);
    assert.equal(f.state.posts.length, 1, 'no se envio una segunda tarea');
  } finally { f.cleanup(); }
});
test('mensaje de exito describe exactamente lo confirmado: nombre, contraseña, ambos o restauracion — nunca "SSID" para una contraseña', async () => {
  const f = fixture(); try {
    // Solo contraseña.
    await f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, ssid: 'Original', password: SYNTHETIC_PW }, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh1 = new Date(Date.now() + 2000).toISOString();
    f.state.password = { value: SYNTHETIC_PW, timestamp: fresh1 };
    let status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.message, 'Nueva contraseña verificada en GenieACS. Comprueba también la red y navegación.');
    assert.ok(!status.message.includes('SSID'), 'una contraseña confirmada nunca se anuncia como SSID');
  } finally { f.cleanup(); }
});
test('mensaje de exito: solo nombre y nombre+contraseña juntos', async () => {
  const f = fixture(); try {
    // Solo nombre.
    await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    const onlyName = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(onlyName.message, 'Nuevo nombre verificado en GenieACS. Comprueba también la red y navegación.');
  } finally { f.cleanup(); }
});
test('mensaje de exito: nombre y contraseña juntos', async () => {
  const f = fixture(); try {
    await f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, password: SYNTHETIC_PW }, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    f.state.password = { value: SYNTHETIC_PW, timestamp: fresh };
    const both = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(both.message, 'Nuevo nombre y nueva contraseña verificados en GenieACS. Comprueba también la red y navegación.');
  } finally { f.cleanup(); }
});
test('mensaje de exito de una restauracion sigue hablando de nombre, nunca de contraseña', async () => {
  const f = fixture(); try {
    await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    await f.service.status(nbi, WIFI_TEST_SERIAL);
    const restored = await f.service.restore(nbi, WIFI_TEST_SERIAL, { requestId: '00000000-0000-4000-8000-0000000000a4', confirmed: true }, 'admin');
    assert.equal(restored.record!.operations[1].state, 'queued');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh2 = new Date(Date.now() + 4000).toISOString();
    f.inv.networks[0].ssid = 'Original'; f.inv.networks[0].timestamp = fresh2; f.inv.lastInform = fresh2;
    const status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.message, 'Nombre anterior verificado en GenieACS. Comprueba también la red y navegación.');
  } finally { f.cleanup(); }
});
test('dispositivo no verificable (identidad GenieACS distinta) rechaza sin enviar nada', async () => {
  const f = fixture(); try {
    f.inv.deviceId = 'otro-dispositivo';
    await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin'), /[Ii]dentidad/);
    assert.equal(f.state.posts.length, 0);
  } finally { f.cleanup(); }
});
