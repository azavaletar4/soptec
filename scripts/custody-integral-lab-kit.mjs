// Prueba real de "Kit base de Alta" (Fase 123) contra el control obligatorio
// de custodia (Fase 165 etapa 2), usando CLICS REALES en la App de Campo
// (CampoTrabajoDetailView.vue) + productos REALES del catalogo (snapshot
// restaurado de produccion, mismos IDs). Reusa el laboratorio ya certificado
// por custody-integral-lab-api.mjs/-browser.mjs/-clicks.mjs; usa el mismo
// trabajo sintetico "installation materials:false" (indice 1) que clicks.mjs
// ya certifico para consumo simple -- aqui se prueba la accion 'kit'
// (multi-item, todo-o-nada) que NUNCA se probo por separado (riesgo #4 del
// procedimiento de activacion), mas el candado de cierre (riesgo #3).
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
const job = fixture.jobs.find(j => j.kind === 'installation' && !j.materials); // indice 1, id ...-15
const results = [];
const pass = (name) => { results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };

// Productos REALES del catalogo (confirmados contra produccion y contra este
// mismo snapshot restaurado -- mismos IDs, mismo stock -- antes de escribir
// este guion). "Patchcord" tiene un duplicado en el catalogo real
// (b82659da..., is_active=false) que no afecta esta prueba: la UI de Kit
// solo lista productos activos, asi que nunca aparece el selector de
// ambiguedad para Patchcord (ver hallazgo de catalogo reportado aparte).
const PATCHCORD = 'cb764467-ab6a-4f26-b4b9-5a38d07282b5'; // activo, stock real 66
const ROSETA = '61ffcff0-17a1-49cc-af4c-12265b06a0e7';
const CONECTOR = '38113e7e-1063-4db3-b883-ef329392428d';
const DROP100 = '72328f6a-d3f0-4e2b-8337-dc7704816db5';
const KIT_PRODUCTS = [PATCHCORD, ROSETA, CONECTOR, DROP100];
const idsList = KIT_PRODUCTS.map(id => `'${id}'`).join(',');

function custodyOf(productId) { return Number(sql(`select coalesce((select quantity from technician_material_custody where technician_id='${leaderId}' and product_id='${productId}'),0);`)); }
function movementsFor(productId) { return Number(sql(`select count(*) from inventory_movements where product_id='${productId}' and installation_id='${job.id}';`)); }
function clientFor(jwt) {
  return createClient(c.gateway, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch, headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} } });
}
async function login(role) {
  const account = c.accounts.find(a => a.role === role);
  const anon = createClient(c.gateway, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch } });
  const { data, error } = await anon.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw Error('LOGIN_FAILED_' + role + '_' + error.message);
  return data.session.access_token;
}

// Reinicio real (nunca DELETE del Kardex-- insert-only): saldo/rechazos de
// SOLO estos 4 productos para este tecnico, y cualquier egreso activo de una
// corrida anterior de este mismo guion sobre el mismo trabajo se revierte con
// la operacion real (reverse), no con UPDATE/DELETE directo.
sql(`update installations set status='scheduled' where id='${job.id}';`);
sql(`delete from material_inventory_rejections where job_id='${job.id}' and action='kit';`);

const adminJwt = await login('admin');
const admin = clientFor(adminJwt);
const leaderJwtNode = await login('leader');
const leaderNode = clientFor(leaderJwtNode);

for (const productId of KIT_PRODUCTS) {
  const activeIds = sql(`select id from inventory_movements where product_id='${productId}' and installation_id='${job.id}' and movement_type='egreso' and not exists(select 1 from inventory_movements r where r.reverses_movement_id=inventory_movements.id);`).split('\n').filter(Boolean);
  for (const id of activeIds) {
    const r = await leaderNode.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: 'installation', p_job_id: job.id, p_action: 'reverse', p_payload: { movementId: id, reason: 'Limpieza real previa a la prueba de Kit' } });
    if (r.error) throw Error('No se pudo revertir el residuo real de una corrida anterior del Kit (' + productId + ' ' + id + '): ' + JSON.stringify(r.error));
  }
}
sql(`delete from technician_material_custody_events where technician_id='${leaderId}' and product_id in (${idsList});`);
sql(`delete from technician_material_custody where technician_id='${leaderId}' and product_id in (${idsList});`);

const procs = [];
function startNode(args) { const p = spawn('node', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); procs.push(p); return p; }
try {
  const vite = startNode([path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(root, 'scripts/tests/custody-integral-lab-vite.config.mjs')]);
  let viteLog = ''; vite.stdout.on('data', b => { viteLog += b; }); vite.stderr.on('data', b => { viteLog += b; });
  startNode(['--import', 'tsx', path.join(root, 'scripts/custody-integral-lab-backend.ts')]);
  await wait(async () => (await localFetch(c.api + '/lab/config')).ok);
  await wait(async () => { try { return (await localFetch(c.gateway.replace('54421', '54422') + '/scripts/tests/custody-integral-lab.html')).ok; } catch { return false; } }).catch(() => { throw Error('Vite no respondio: ' + viteLog.slice(-2000)); });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'custody-integral-lab-kit-'));
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

    await cdp('Page.navigate', { url: 'http://127.0.0.1:54422/scripts/tests/custody-integral-lab.html' });
    await until('window.__ready === true', 'carga del harness real');
    await evaluate("window.__login('leader')");
    pass('login real (GoTrue) como leader dentro del navegador');

    const kitSectionExpr = `[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.trim()==='📦 Kit base de instalación')`;
    const dropSelectExpr = `${kitSectionExpr}.querySelector('select')`; // unico select: Patchcord no genera selector de ambiguedad (producto duplicado inactivo no aparece)
    const selectDrop100 = async () => {
      await until(`${dropSelectExpr}?.options.length>1`, 'opciones reales de Drop prefabricado cargadas');
      const val = await evaluate(`(()=>{const el=${dropSelectExpr};el.value=${JSON.stringify(DROP100)};el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;})()`);
      assert.equal(val, DROP100, 'no se pudo elegir el Drop de 100 metros real en el selector');
      await until(`${kitSectionExpr}.querySelector('input[min="1"][type=number]')!==null`, 'input real de tramos usados visible tras elegir el Drop');
    };

    await evaluate('window.__openJob(' + fixture.jobs.indexOf(job) + ')');
    await until("window.__router.currentRoute.value.path==='/campo/installation/" + job.id + "'");
    await clickWhenReady('button', '3. Materiales');
    await until(`${kitSectionExpr}!==undefined`, 'sección real "Kit base de instalación" visible');

    // ===================== Escenario A: custodia suficiente para los 4 items =====================
    // Base real previa (nunca 0 garantizado: la limpieza revierte egresos
    // activos con un movimiento de reversion real, insert-only, nunca borra).
    const m0 = { p: movementsFor(PATCHCORD), r: movementsFor(ROSETA), c: movementsFor(CONECTOR), d: movementsFor(DROP100) };
    await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: PATCHCORD, p_quantity: 5, p_reason: 'Entrega real para prueba de Kit base (custodia suficiente)' });
    await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: ROSETA, p_quantity: 5, p_reason: 'Entrega real para prueba de Kit base (custodia suficiente)' });
    await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: CONECTOR, p_quantity: 10, p_reason: 'Entrega real para prueba de Kit base (custodia suficiente)' });
    await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: DROP100, p_quantity: 5, p_reason: 'Entrega real para prueba de Kit base (custodia suficiente)' });
    await until(`${kitSectionExpr}.querySelectorAll('input[type=number]').length>=3`, 'las 3 cantidades reales de fila (Patchcord/Roseta/Conector) ya cargadas con sus valores por defecto');
    await selectDrop100();
    await clickByText('button', 'Registrar kit base');
    // "Registrando..." deshabilita el boton mientras handleRegisterKit sigue
    // en curso (loadMaterials() tras el recibo real) -- esperar solo a que el
    // select de Drop se reinicie no basta, hay que esperar tambien a que el
    // boton real vuelva a su texto/estado normal antes de seguir.
    await until(`${dropSelectExpr}.value===''&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Registrar kit base'&&!b.disabled)`, 'el Kit se registró con éxito (el formulario real se reinicia solo tras confirmar el recibo)');
    assert.equal(custodyOf(PATCHCORD), 4); assert.equal(custodyOf(ROSETA), 4); assert.equal(custodyOf(CONECTOR), 8); assert.equal(custodyOf(DROP100), 4);
    assert.equal(movementsFor(PATCHCORD), m0.p + 1); assert.equal(movementsFor(ROSETA), m0.r + 1); assert.equal(movementsFor(CONECTOR), m0.c + 1); assert.equal(movementsFor(DROP100), m0.d + 1);
    pass('clic real "Registrar kit base" con custodia suficiente en los 4 productos reales: éxito, custodia descontada exacta en los 4, 4 movimientos reales (Patchcord/Roseta/Conector/Drop)');

    // ===================== Escenario B: custodia insuficiente en UN item -> todo-o-nada =====================
    const returnReq = await leaderNode.rpc('request_material_return', { p_product_id: CONECTOR, p_quantity: 7, p_reason: 'Corrección real previa a la prueba de Kit con custodia insuficiente' });
    assert.equal(returnReq.error, null, JSON.stringify(returnReq.error));
    const confirmReturn = await admin.rpc('confirm_material_return', { p_request_id: returnReq.data, p_approved: true, p_note: 'Confirmación real' });
    assert.equal(confirmReturn.error, null, JSON.stringify(confirmReturn.error));
    assert.equal(custodyOf(CONECTOR), 1); // 8-7=1, por debajo de los 2 que exige el Kit (defaultQty de Conector)
    await selectDrop100();
    await clickWhenReady('button', 'Registrar kit base');
    await until(`document.body.innerText.toLowerCase().includes('custodia')&&document.body.innerText.toLowerCase().includes('administrador')`, 'error real de custodia insuficiente tras clic en "Registrar kit base"');
    await until(`document.body.innerText.includes('Hay una operación de inventario pendiente de confirmar.')`, 'aviso real de operación pendiente (Kit)');
    assert.equal(custodyOf(PATCHCORD), 4); assert.equal(custodyOf(ROSETA), 4); assert.equal(custodyOf(CONECTOR), 1); assert.equal(custodyOf(DROP100), 4);
    assert.equal(movementsFor(PATCHCORD), m0.p + 1); assert.equal(movementsFor(ROSETA), m0.r + 1); assert.equal(movementsFor(CONECTOR), m0.c + 1); assert.equal(movementsFor(DROP100), m0.d + 1);
    pass('clic real "Registrar kit base" con custodia insuficiente SOLO en Conector: rechazo todo-o-nada real -- Patchcord/Roseta/Drop (con custodia suficiente) NO se descontaron, ningún movimiento parcial');

    const rejectedOperationId = sql(`select operation_id from material_inventory_rejections where job_id='${job.id}' and action='kit' and status='pending' order by created_at desc limit 1;`);
    assert.ok(rejectedOperationId, 'debe existir el rechazo real de Kit recién registrado');

    // ===================== Escenario C: cierre bloqueado real mientras el rechazo de Kit sigue pendiente =====================
    const statusBeforeClosureAttempt = sql(`select status from installations where id='${job.id}';`); // __openJob real ya la pasa a 'in_progress'
    let closureBlocked = false;
    try { sql(`update installations set status='completed' where id='${job.id}';`); } catch (e) { closureBlocked = /no se puede cerrar la orden/i.test(e.privateError || ''); if (!closureBlocked) throw e; }
    assert.ok(closureBlocked, 'el candado real de cierre (guard_material_installation, P1651) debió bloquear el cierre mientras el rechazo de Kit está pendiente');
    assert.equal(sql(`select status from installations where id='${job.id}';`), statusBeforeClosureAttempt);
    pass('candado real de cierre (P1651): bloquea completar la orden real mientras el rechazo de Kit sigue pendiente (riesgo #3 del procedimiento de activación, antes nunca probado)');

    // ===================== Escenario D: reintento real resuelve el rechazo, y el cierre real ya no está bloqueado =====================
    await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: CONECTOR, p_quantity: 10, p_reason: 'Entrega adicional real tras rechazo de Kit por clic' });
    await clickWhenReady('button', 'Confirmar operación de inventario pendiente');
    await until(`!document.body.innerText.includes('Hay una operación de inventario pendiente de confirmar.')`, 'el reintento real del Kit resuelve la operación pendiente');
    assert.equal(custodyOf(PATCHCORD), 3); assert.equal(custodyOf(ROSETA), 3); assert.equal(custodyOf(CONECTOR), 9); assert.equal(custodyOf(DROP100), 3);
    assert.equal(movementsFor(PATCHCORD), m0.p + 2); assert.equal(movementsFor(ROSETA), m0.r + 2); assert.equal(movementsFor(CONECTOR), m0.c + 2); assert.equal(movementsFor(DROP100), m0.d + 2);
    assert.equal(sql(`select status from material_inventory_rejections where operation_id='${rejectedOperationId}';`), 'resolved');
    pass('clic real "Confirmar operación de inventario pendiente" (Kit): reintento real con la MISMA clave resuelve el rechazo, descuenta los 4 productos correctamente');

    // Con el rechazo ya resuelto, el candado P1651 (material) ya no debe
    // bloquear el cierre -- este trabajo sintetico "materials:false" nunca
    // tuvo equipo serializado asignado, asi que puede seguir topando con la
    // OTRA validacion real y preexistente de cierre (equipo Serie/MAC para
    // instalaciones de internet/combo, validate_installation_completion(),
    // ajena por completo a Fase 165/custodia) -- lo que importa aqui es que
    // el motivo del bloqueo, si lo hay, YA NO sea el material pendiente.
    let closureStillBlockedByMaterial = false;
    try { sql(`update installations set status='completed' where id='${job.id}';`); }
    catch (e) { closureStillBlockedByMaterial = /no se puede cerrar la orden/i.test(e.privateError || ''); if (closureStillBlockedByMaterial) throw e; }
    assert.equal(closureStillBlockedByMaterial, false, 'el candado P1651 (material) no debe seguir bloqueando el cierre una vez resuelto el rechazo del Kit');
    pass('con el rechazo de Kit ya resuelto, el candado real de cierre por material (P1651) ya no bloquea -- cualquier otro bloqueo de cierre que persista (equipo serializado, ajeno a Fase 165) no es parte de este control');
    sql(`update installations set status='scheduled' where id='${job.id}';`); // deja el trabajo reutilizable, como el resto del laboratorio

    assert.equal(external.length, 0, 'ninguna peticion debio salir del laboratorio aislado: ' + JSON.stringify(external));
    const unexpected = exceptions.filter(e => !/formDrafts\.ts|idb-keyval/.test(e));
    assert.equal(unexpected.length, 0, JSON.stringify(unexpected));
    if (exceptions.length) console.log('(ignoradas, ajenas al circuito real: ' + exceptions.length + ' fallas de borrador local IndexedDB)');
    pass('sin peticiones externas ni excepciones no controladas durante toda la sesión de navegador (Kit)');

    await send('Browser.close');
  } finally {
    ws?.close();
  }
} finally {
  for (const p of procs) p.kill();
}

await writeFile(path.join(root, 'docs/CUSTODIA-ETAPA2-LABORATORIO-INTEGRAL-KIT.json'), JSON.stringify({
  at: new Date().toISOString(), scope: 'REAL_BROWSER_REAL_CLICKS_REAL_DB_REST_AUTH_NO_SIMULATION_KIT_ALTA', lab: c.project, results,
}, null, 2) + '\n');
console.log('CUSTODY_INTEGRAL_KIT_CIRCUIT_REAL: ' + results.length + ' escenarios PASS');
