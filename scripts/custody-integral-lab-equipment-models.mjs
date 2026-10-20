// App de Campo (Altas): el selector de "Equipos asignados" debe mostrar
// SOLO los modelos serializados que el tecnico autenticado tiene
// realmente disponibles en su propia custodia (antes mostraba el
// catalogo completo). Prueba real por clic sobre CampoTrabajoDetailView.vue,
// reusando el laboratorio aislado ya certificado (mismo snapshot restaurado
// de produccion). Cubre: cero modelos, uno, varios, un modelo sin
// disponibilidad real (pendiente de devolucion) y cambio de tecnico.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { config, root, sql, localFetch, wait } from './custody-integral-lab-common.mjs';

const c = config();
const fixture = JSON.parse(fs.readFileSync(path.join(c.directory, 'fixture.json'), 'utf8'));
const leaderId = fixture.users.leader;
const supportId = fixture.users.support;
const job = fixture.jobs.find(j => j.kind === 'installation' && !j.materials); // indice 1, id ...-15, ya certificado
const results = [];
const pass = (name) => { results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };

// Productos reales del catalogo (confirmados en este mismo snapshot) +
// un producto sintetico de laboratorio (LAB ONU) ya usado en otras pruebas.
const LAB_ONU = 'd1650000-0000-4000-8000-000000000002';
const HUAWEI = '0f1e0bd0-a53f-4433-95fb-c4821fa1e389';
const ZTE = 'e2599455-190f-4029-85c2-914c4ad9808f';

sql(`update installations set status='scheduled' where id='${job.id}';`);

function inStockUnit(productId) {
  return sql(`select id from inventory_units where product_id='${productId}' and status='in_stock' order by id limit 1;`);
}
function resetUnitToStock(unitId) {
  sql(`update inventory_units set status='in_stock', custody_technician_id=null, client_id=null, contract_id=null, installation_id=null, ticket_id=null, routine_id=null where id='${unitId}';`);
}

const adminJwt = await (async () => {
  const account = c.accounts.find(a => a.role === 'admin');
  const anon = createClient(c.gateway, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } });
  const { data, error } = await anon.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw Error('LOGIN_FAILED_admin_' + error.message);
  return data.session.access_token;
})();
const admin = createClient(c.gateway, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch, headers: { Authorization: 'Bearer ' + adminJwt } } });
async function loginNode(role) {
  const account = c.accounts.find(a => a.role === role);
  const anon = createClient(c.gateway, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } });
  const { data, error } = await anon.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw Error('LOGIN_FAILED_' + role + '_' + error.message);
  const jwt = data.session.access_token;
  return createClient(c.gateway, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch, headers: { Authorization: 'Bearer ' + jwt } } });
}
const leaderNode = await loginNode('leader');

// Reinicio real: deja a leader y support sin equipos en custodia (vuelve
// a stock) antes de armar cada escenario -- nunca borra el Kardex de
// inventory_unit_events (insert-only), solo revierte el ESTADO actual de
// la unidad al punto de partida real "in_stock".
for (const productId of [LAB_ONU, HUAWEI, ZTE]) {
  const unitsInCustody = sql(`select id from inventory_units where product_id='${productId}' and custody_technician_id in ('${leaderId}','${supportId}');`).split('\n').filter(Boolean);
  for (const id of unitsInCustody) resetUnitToStock(id);
}

const procs = [];
function startNode(args) { const p = spawn('node', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); procs.push(p); return p; }
try {
  const vite = startNode([path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(root, 'scripts/tests/custody-integral-lab-vite.config.mjs')]);
  let viteLog = ''; vite.stdout.on('data', b => { viteLog += b; }); vite.stderr.on('data', b => { viteLog += b; });
  startNode(['--import', 'tsx', path.join(root, 'scripts/custody-integral-lab-backend.ts')]);
  await wait(async () => (await localFetch(c.api + '/lab/config')).ok);
  await wait(async () => { try { return (await localFetch(c.gateway.replace('54421', '54422') + '/scripts/tests/custody-integral-lab.html')).ok; } catch { return false; } }).catch(() => { throw Error('Vite no respondio: ' + viteLog.slice(-2000)); });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'custody-integral-lab-equipmodels-'));
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  procs.push(chrome);
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = ''; const timeout = setTimeout(() => reject(Error('Chrome timeout: ' + log)), 20000);
      chrome.on('error', reject);
      chrome.stderr.on('data', b => { log += b; const m = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
    });
    ws = new WebSocket(endpoint); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let seq = 0; const pending = new Map(); const exceptions = []; const external = [];
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails?.text ?? '') + ' ' + (m.params.exceptionDetails?.exception?.description ?? JSON.stringify(m.params.exceptionDetails?.exception?.preview ?? {})));
      if (m.method === 'Fetch.requestPaused') {
        const u = new URL(m.params.request.url);
        const allowed = u.hostname === '127.0.0.1' && ['54421', '54422', '54423'].includes(u.port);
        if (!allowed) external.push(u.origin);
        void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }, m.sessionId);
      }
    };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params = {}) => send(method, params, sessionId);
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const evaluate = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + '\n' + JSON.stringify(r.exceptionDetails.exception)); return r.result.value; };
    const until = async (expression, label) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timeout esperando: ' + (label ?? expression)); };
    const clickByText = async (tag, text) => {
      const ok = await evaluate(`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(tag)})];const el=els.find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!el)return false;el.click();return true;})()`);
      if (!ok) throw Error('No se pudo clickear ' + tag + ' "' + text + '"');
    };
    const clickWhenReady = async (tag, text) => { await until(`[...document.querySelectorAll(${JSON.stringify(tag)})].some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`, text); await clickByText(tag, text); };

    const sectionExpr = `[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.trim()==='🔧 Equipos asignados (serie/MAC)')`;
    const modelSelectExpr = `${sectionExpr}.querySelector('form select')`;
    const serialSelectExpr = `${sectionExpr}.querySelectorAll('form select')[1]`;
    const modelOptionNames = async () => evaluate(`[...(${modelSelectExpr}?.options??[])].map(o=>o.textContent.trim()).filter(t=>t&&!t.includes('...'))`);
    const reopenJob = async () => {
      await evaluate("window.__router.push('/campo/custodia')"); await new Promise(r => setTimeout(r, 300));
      await evaluate('window.__openJob(' + fixture.jobs.indexOf(job) + ')');
      await until("window.__router.currentRoute.value.path==='/campo/installation/" + job.id + "'");
      await clickWhenReady('button', '2. Instalación y red');
      await until(`document.body.innerText.includes('Equipos asignados')`, 'sección real de equipos visible tras reabrir (paso 2)');
    };

    await cdp('Page.navigate', { url: 'http://127.0.0.1:54422/scripts/tests/custody-integral-lab.html' });
    await until('window.__ready === true', 'carga del harness real');

    // ===================== Escenario A: cero modelos (sin equipos en custodia) =====================
    await evaluate("window.__login('leader')");
    await evaluate('window.__openJob(' + fixture.jobs.indexOf(job) + ')');
    await until("window.__router.currentRoute.value.path==='/campo/installation/" + job.id + "'");
    await clickWhenReady('button', '2. Instalación y red');
    await until(`document.body.innerText.includes('Equipos asignados')`, 'sección real de equipos visible (paso 2)');
    await until(`${sectionExpr}?.querySelector('p')!==null`, 'mensaje real de custodia visible');
    await until(`document.body.innerText.includes('No tienes equipos en tu custodia. Solicita la entrega a un administrador en Inventario.')`, 'mensaje real de cero equipos (sin selector de modelos)');
    assert.equal(await evaluate(`${modelSelectExpr}===null||${modelSelectExpr}===undefined`), true, 'sin custodia, el selector de modelos real no debe existir en el DOM');
    pass('técnico con CERO modelos en custodia: mensaje real "Solicita la entrega a un administrador" visible, sin selector de modelos');

    // ===================== Escenario B: un modelo =====================
    const labOnuUnit = inStockUnit(LAB_ONU);
    assert.ok(labOnuUnit, 'debe existir una unidad real in_stock de LAB ONU en el snapshot');
    const d1 = await admin.rpc('deliver_unit_to_technician', { p_unit_id: labOnuUnit, p_technician_id: leaderId, p_reason: 'Entrega real para prueba de un modelo' });
    assert.equal(d1.error, null, JSON.stringify(d1.error));
    await reopenJob();
    await until(`${modelSelectExpr}?.options.length>1`, 'selector real de modelos visible con al menos un modelo');
    const namesB = await modelOptionNames();
    assert.deepEqual(namesB, ['LAB ONU'], 'con un solo modelo en custodia, el selector real debe mostrar EXACTAMENTE ese modelo');
    pass('técnico con UN modelo en custodia (LAB ONU): el selector real de modelos muestra exactamente ese modelo, ninguno más');

    // Requisito 2: al elegir el modelo, solo sus series/MAC disponibles (mecanismo ya certificado, confirmado aquí por clic real junto al filtro nuevo).
    await evaluate(`(()=>{const sel=${modelSelectExpr};sel.value=${JSON.stringify(LAB_ONU)};sel.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`${serialSelectExpr}?.options.length>1`, 'selector real de serie/MAC cargado tras elegir el modelo');
    const serialTextB = await evaluate(`[...${serialSelectExpr}.options].map(o=>o.textContent.trim()).filter(t=>t&&!t.includes('...'))`);
    assert.deepEqual(serialTextB, [sql(`select serial_number from inventory_units where id='${labOnuUnit}';`)], 'el selector real de serie/MAC debe ofrecer unicamente la unidad real disponible de ese modelo');
    pass('al elegir el modelo real (LAB ONU), el selector real de serie/MAC ofrece únicamente su única unidad disponible');

    // ===================== Escenario C: varios modelos =====================
    const huaweiUnit = inStockUnit(HUAWEI);
    assert.ok(huaweiUnit, 'debe existir una unidad real in_stock de HUAWEI EG8145V5 en el snapshot');
    const d2 = await admin.rpc('deliver_unit_to_technician', { p_unit_id: huaweiUnit, p_technician_id: leaderId, p_reason: 'Entrega real para prueba de varios modelos' });
    assert.equal(d2.error, null, JSON.stringify(d2.error));
    await reopenJob();
    await until(`${modelSelectExpr}?.options.length>2`, 'selector real de modelos actualizado con el segundo modelo');
    const namesC = (await modelOptionNames()).sort();
    assert.deepEqual(namesC, ['HUAWEI EG8145V5', 'LAB ONU'], 'con dos modelos en custodia, el selector real debe mostrar EXACTAMENTE esos dos, ninguno más del catálogo');
    pass('técnico con VARIOS modelos en custodia (LAB ONU + HUAWEI EG8145V5): el selector real muestra exactamente esos dos modelos');

    // ===================== Escenario D: un modelo sin disponibilidad real (pendiente de devolución) =====================
    const zteUnit = inStockUnit(ZTE);
    assert.ok(zteUnit, 'debe existir una unidad real in_stock de ZTE F670L en el snapshot');
    const d3 = await admin.rpc('deliver_unit_to_technician', { p_unit_id: zteUnit, p_technician_id: leaderId, p_reason: 'Entrega real para prueba de equipo sin disponibilidad' });
    assert.equal(d3.error, null, JSON.stringify(d3.error));
    const r1 = await leaderNode.rpc('request_unit_return', { p_unit_id: zteUnit, p_reason: 'Prueba real: equipo pendiente de devolución, no debe ofrecerse para instalar' });
    assert.equal(r1.error, null, JSON.stringify(r1.error));
    assert.equal(sql(`select status from inventory_units where id='${zteUnit}';`), 'pending_return');
    await reopenJob();
    await until(`${modelSelectExpr}?.options.length>2`, 'selector real de modelos recargado');
    const namesD = (await modelOptionNames()).sort();
    assert.deepEqual(namesD, ['HUAWEI EG8145V5', 'LAB ONU'], 'un modelo cuya única unidad está pendiente de devolución NO debe aparecer en el selector real de modelos');
    pass('equipo real sin disponibilidad (único ejemplar pendiente de devolución): su modelo NO aparece en el selector real, los otros dos siguen intactos');

    // ===================== Escenario E: cambio de técnico =====================
    await evaluate("window.__login('support')");
    await reopenJob();
    await until(`document.body.innerText.includes('No tienes equipos en tu custodia. Solicita la entrega a un administrador en Inventario.')`, 'al cambiar de técnico (support, sin custodia propia) el mensaje real de cero equipos reaparece, sin arrastrar los modelos de leader');
    assert.equal(await evaluate(`${modelSelectExpr}===null||${modelSelectExpr}===undefined`), true, 'el técnico nuevo (support) no debe ver ningún modelo ajeno');
    pass('cambio de técnico real (leader → support): la lista se recalcula para el nuevo técnico, sin residuos del anterior (support, sin custodia, ve el mensaje de cero equipos)');

    await evaluate("window.__login('leader')");
    await reopenJob();
    await until(`${modelSelectExpr}?.options.length>2`, 'al volver a leader, sus modelos reales reaparecen');
    const namesE = (await modelOptionNames()).sort();
    assert.deepEqual(namesE, ['HUAWEI EG8145V5', 'LAB ONU'], 'al volver al técnico original, su lista real de modelos vuelve a ser exactamente la correcta');
    pass('cambio de técnico real (support → leader): al volver, la lista real de leader se recalcula correctamente, sin residuos de support');

    assert.equal(external.length, 0, 'ninguna peticion debio salir del laboratorio aislado: ' + JSON.stringify(external));
    const unexpected = exceptions.filter(e => !/formDrafts\.ts|idb-keyval/.test(e));
    assert.equal(unexpected.length, 0, JSON.stringify(unexpected));
    if (exceptions.length) console.log('(ignoradas, ajenas al circuito real: ' + exceptions.length + ' fallas de borrador local IndexedDB)');
    pass('sin peticiones externas ni excepciones no controladas durante toda la sesión de navegador (selector de modelos de equipos)');

    await send('Browser.close');
  } finally {
    ws?.close();
  }
} finally {
  for (const p of procs) p.kill();
}

// Limpieza real: deja las unidades usadas de vuelta en stock (nunca borra
// el Kardex de inventory_unit_events, insert-only) y el trabajo reutilizable.
for (const productId of [LAB_ONU, HUAWEI, ZTE]) {
  const unitsInCustody = sql(`select id from inventory_units where product_id='${productId}' and custody_technician_id in ('${leaderId}','${supportId}');`).split('\n').filter(Boolean);
  for (const id of unitsInCustody) resetUnitToStock(id);
}
sql(`update installations set status='scheduled' where id='${job.id}';`);

await writeFile(path.join(root, 'docs/CAMPO-EQUIPOS-SELECTOR-MODELOS-CUSTODIA.json'), JSON.stringify({
  at: new Date().toISOString(), scope: 'REAL_BROWSER_REAL_CLICKS_REAL_DB_REST_AUTH_NO_SIMULATION_EQUIPOS_ALTAS', lab: c.project, results,
}, null, 2) + '\n');
console.log('CAMPO_EQUIPOS_SELECTOR_MODELOS_REAL: ' + results.length + ' escenarios PASS');
