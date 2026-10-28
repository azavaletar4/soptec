import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWifiTrial, WIFI_TRIAL_PATH, WIFI_TRIAL_PARAMETER, WIFI_TRIAL_PASSWORD_PARAMETER, WIFI_TRIAL_CONTRACT } from '../tr069WifiTrial';
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
        // dentro del cuerpo simulado de GenieACS (equivalente al NBI real). Cadena vacía no es
        // un secreto que buscar (toda cadena la "incluye"); solo se revisa un valor real.
        if (state.password.value) assert.ok(!String(url).includes(state.password.value));
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

// ---- Contraseña WiFi: BLOQUEADA (28/10/2026) tras el incidente real ----
// Hallazgo real con la Huawei de prueba: KeyPassphrase se reporta vacío al leerlo de vuelta,
// así que nunca se puede confirmar si una contraseña nueva se aplicó. Mientras no se resuelva
// cómo verificarlo con este firmware, change() rechaza cualquier intento de envío.
const SYNTHETIC_PW = 'Synthetic#Pass1';
test('cambio de contraseña bloqueado: cualquier valor (válido o no) se rechaza sin enviar nada', async () => {
  const f = fixture(); try {
    for (const password of [SYNTHETIC_PW, 'short1', 'a'.repeat(64), 'with\tcontrol1', '😀'.repeat(10)]) {
      await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, password }, 'admin'), (e: Error) => {
        assert.match(e.message, /bloqueado temporalmente/); assert.ok(!e.message.includes(password)); return true;
      });
    }
    assert.equal(f.state.posts.length, 0, 'ningun intento de contraseña llega a encolar una tarea');
  } finally { f.cleanup(); }
});
test('mismo SSID sin contraseña nueva no envía nada (sin cambiar nada, no hay nada que bloquear)', async () => {
  const f = fixture(); try {
    await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL, { ...f.body, ssid: 'Original' }, 'admin'), /no se indicó una contraseña/);
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
test('tras un cambio verificado, un segundo cambio de solo nombre SI se permite', async () => {
  const f = fixture(); try {
    await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    let status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'verified', 'primer cambio ya confirmado');
    const second = await f.service.change(nbi, WIFI_TEST_SERIAL,
      { requestId: '00000000-0000-4000-8000-0000000000a2', confirmed: true, deviceId: WIFI_TEST_DEVICE, path: WIFI_TRIAL_PATH,
        ssid: 'wifi 5 rayco', expectedSsid: 'Nuevo', expectedTimestamp: fresh }, 'admin');
    assert.equal(second.record!.operations.length, 2, 'se agrega una segunda operacion, no se reemplaza la primera');
    assert.equal(second.record!.operations[1].state, 'queued');
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
test('mensaje de exito: solo nombre', async () => {
  const f = fixture(); try {
    await f.service.change(nbi, WIFI_TEST_SERIAL, f.body, 'admin');
    f.state.pending = []; await f.service.verify(nbi, WIFI_TEST_SERIAL); f.state.pending = [];
    const fresh = new Date(Date.now() + 2000).toISOString();
    f.inv.networks[0].ssid = 'Nuevo'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    const onlyName = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(onlyName.message, 'Nuevo nombre verificado en GenieACS. Comprueba también la red y navegación.');
  } finally { f.cleanup(); }
});

// ---- Incidente real del 28/10/2026: SSID cambia, contraseña "falla" y el panel queda
// "Guardando cambios" para siempre. Los registros con passwordChanged:true son anteriores al
// bloqueo de arriba (ya existían antes de esta corrección) — se fabrican directo en el archivo,
// igual que la operación real encontrada en producción, para probar cómo se resuelven ahora. ----
function recordWithOperation(op: object) {
  return { version: 1, serial: WIFI_TEST_SERIAL, deviceId: WIFI_TEST_DEVICE, contractNumber: WIFI_TRIAL_CONTRACT,
    path: WIFI_TRIAL_PATH, originalSsid: 'wifi 5 ray', originalTimestamp: '2026-10-27T22:37:31.591Z', operations: [op] };
}
test('contraseña reportada vacía al leerla: pasa a "unconfirmed", nunca a "verified" ni "failed"', async () => {
  const f = fixture(); try {
    const sentAt = new Date(Date.now() - 60_000).toISOString();
    const readSentAt = new Date(Date.now() - 30_000).toISOString();
    fs.writeFileSync(f.file, JSON.stringify(recordWithOperation({
      requestId: '00000000-0000-4000-8000-0000000000b1', kind: 'change', actorId: 'admin',
      before: 'wifi 5 ray', after: 'wifi 5 rayco', sentAt, state: 'queued',
      passwordChanged: true, afterPasswordHash: sha256Hex(SYNTHETIC_PW),
      taskId: 'task-write', readSentAt, readTaskId: 'task-read',
    })));
    const fresh = new Date().toISOString();
    f.inv.networks[0].ssid = 'wifi 5 rayco'; f.inv.networks[0].timestamp = fresh; f.inv.lastInform = fresh;
    f.state.password = { value: '', timestamp: fresh }; // Exactamente lo que reportó el equipo real.
    const status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'unconfirmed');
    assert.match(status.message, /no se puede confirmar por esta vía/);
    assert.match(status.message, /Nuevo nombre verificado/, 'el nombre sí se confirma de forma independiente');
    assert.ok(!status.message.includes(SYNTHETIC_PW));
  } finally { f.cleanup(); }
});
test('"unconfirmed" es terminal: un cambio nuevo (solo nombre) SI se permite después', async () => {
  const f = fixture(); try {
    const sentAt = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(f.file, JSON.stringify(recordWithOperation({
      requestId: '00000000-0000-4000-8000-0000000000b2', kind: 'change', actorId: 'admin',
      before: 'wifi 5 ray', after: 'wifi 5 rayco', sentAt, state: 'unconfirmed',
      passwordChanged: true, afterPasswordHash: sha256Hex(SYNTHETIC_PW),
      taskId: 'task-write', readSentAt: sentAt, readTaskId: 'task-read',
    })));
    f.inv.networks[0].ssid = 'wifi 5 rayco';
    const result = await f.service.change(nbi, WIFI_TEST_SERIAL,
      { requestId: '00000000-0000-4000-8000-0000000000b3', confirmed: true, deviceId: WIFI_TEST_DEVICE, path: WIFI_TRIAL_PATH,
        ssid: 'wifi 5 final', expectedSsid: 'wifi 5 rayco', expectedTimestamp: f.inv.networks[0].timestamp! }, 'admin');
    assert.equal(result.record!.operations.length, 2);
  } finally { f.cleanup(); }
});
test('tarea sin respuesta por mucho tiempo pasa a "stuck" en vez de seguir "Guardando cambios" sin explicación', async () => {
  const f = fixture(); try {
    const old = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    fs.writeFileSync(f.file, JSON.stringify(recordWithOperation({
      requestId: '00000000-0000-4000-8000-0000000000b4', kind: 'change', actorId: 'admin',
      before: 'wifi 5 ray', after: 'wifi 5 rayco', sentAt: old, state: 'queued',
      passwordChanged: true, afterPasswordHash: sha256Hex(SYNTHETIC_PW),
      taskId: 'task-write', readSentAt: old, readTaskId: 'task-read-stuck',
    })));
    f.state.pending = [{ _id: 'task-read-stuck' }]; // Sigue sin completarse en GenieACS.
    const status = await f.service.status(nbi, WIFI_TEST_SERIAL);
    assert.equal(status.record!.operations[0].state, 'stuck');
    assert.match(status.message, /no respondió a tiempo/);
    assert.equal(f.state.posts.length, 0, 'nunca se reenvía sola');
  } finally { f.cleanup(); }
});
test('"stuck" sigue bloqueando un cambio nuevo (la tarea anterior técnicamente sigue sin resolver)', async () => {
  const f = fixture(); try {
    const old = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    fs.writeFileSync(f.file, JSON.stringify(recordWithOperation({
      requestId: '00000000-0000-4000-8000-0000000000b5', kind: 'change', actorId: 'admin',
      before: 'wifi 5 ray', after: 'wifi 5 rayco', sentAt: old, state: 'stuck',
      taskId: 'task-write', readSentAt: old, readTaskId: 'task-read-stuck',
    })));
    await assert.rejects(f.service.change(nbi, WIFI_TEST_SERIAL,
      { ...f.body, requestId: '00000000-0000-4000-8000-0000000000b6' }, 'admin'), /sin confirmar/);
    assert.equal(f.state.posts.length, 0);
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
