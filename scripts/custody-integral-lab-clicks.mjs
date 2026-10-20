// Reintentos, correcciones y reversiones de materiales mediante CLICS
// REALES en la App de Campo (Alta/Averia via CampoTrabajoDetailView.vue,
// Rutina via RoutineInventory.vue) + devolucion real de un equipo
// serializado desde CampoCustodiaView.vue (su circuito independiente,
// sin tocar su codigo). Reusa el laboratorio ya certificado por
// custody-integral-lab-api.mjs/-browser.mjs; usa SOLO los 3 trabajos
// sinteticos "materials:false" (indices 1,3,5) para no repetir ni afectar
// los cierres ya certificados en los otros 3 (indices 0,2,4).
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
const material = fixture.material;
const leaderId = fixture.users.leader;
const results = [];
const pass = (name) => { results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };

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
function custodyOf() { return Number(sql(`select coalesce((select quantity from technician_material_custody where technician_id='${leaderId}' and product_id='${material}'),0);`)); }

// Reinicio de custodia: nunca borra el Kardex (insert-only), solo saldo,
// rechazos y los 3 trabajos "materials:false" que usa este guion.
const noMaterialJobs = {
  installation: fixture.jobs.find(j => j.kind === 'installation' && !j.materials),
  ticket: fixture.jobs.find(j => j.kind === 'ticket' && !j.materials),
  routine: fixture.jobs.find(j => j.kind === 'routine' && !j.materials),
};
sql(`delete from technician_material_custody_events where technician_id='${leaderId}';`);
sql(`delete from technician_material_custody where technician_id='${leaderId}';`);
sql(`delete from technician_material_return_requests where technician_id='${leaderId}';`);
sql(`delete from material_inventory_rejections where job_id in ('${noMaterialJobs.installation.id}','${noMaterialJobs.ticket.id}','${noMaterialJobs.routine.id}');`);
sql(`update inventory_units set status='in_stock',client_id=null,contract_id=null,installation_id=null,ticket_id=null,routine_id=null,custody_technician_id=null,pending_pickup_by=null where id='${noMaterialJobs.installation.unitId}';`);

const adminJwt = await login('admin');
const admin = clientFor(adminJwt);
const leaderJwtNode = await login('leader'); // sesion Node auxiliar (ajena al navegador) para drenar custodia y simular una correccion concurrente real
const leaderNode = clientFor(leaderJwtNode);
const indexOf = (job) => fixture.jobs.indexOf(job);

// Limpieza REAL (nunca DELETE): corridas anteriores de este mismo guion sobre
// los mismos 3 trabajos sinteticos pueden haber dejado egresos activos (sin
// revertir) en el Kardex -- insert-only, se acumulan entre corridas. Antes de
// empezar, se revierten con la misma operacion real que usaria un tecnico
// (reverse/remove), nunca con un UPDATE/DELETE directo al Kardex.
sql(`update installations set status='scheduled' where id='${noMaterialJobs.installation.id}';`);
sql(`update tickets set status='open' where id='${noMaterialJobs.ticket.id}';`);
sql(`update routines set status='in_progress' where id='${noMaterialJobs.routine.id}';`);
for (const [kind, job] of [['installation', noMaterialJobs.installation], ['ticket', noMaterialJobs.ticket]]) {
  const activeIds = sql(`select id from inventory_movements m where product_id='${material}' and (m.installation_id='${job.id}' or m.ticket_id='${job.id}') and m.movement_type='egreso' and not exists(select 1 from inventory_movements r where r.reverses_movement_id=m.id);`).split('\n').filter(Boolean);
  for (const id of activeIds) {
    const r = await leaderNode.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: kind, p_job_id: job.id, p_action: 'reverse', p_payload: { movementId: id, reason: 'Limpieza real previa a la prueba de clics' } });
    if (r.error) throw Error('No se pudo revertir el residuo real de una corrida anterior (' + kind + ' ' + id + '): ' + JSON.stringify(r.error));
  }
}
{
  const activeIdsRoutine = sql(`select id from inventory_movements m where product_id='${material}' and m.routine_id='${noMaterialJobs.routine.id}' and m.movement_type='egreso' and not exists(select 1 from inventory_movements r where r.reverses_movement_id=m.id);`).split('\n').filter(Boolean);
  for (const id of activeIdsRoutine) {
    const r = await leaderNode.rpc('routine_inventory_operation', { p_routine_id: noMaterialJobs.routine.id, p_operation_id: crypto.randomUUID(), p_action: 'remove', p_payload: { movement_id: id } });
    if (r.error) throw Error('No se pudo revertir el residuo real de una corrida anterior (routine ' + id + '): ' + JSON.stringify(r.error));
  }
}
sql(`update routines set status='scheduled' where id='${noMaterialJobs.routine.id}';`); // __openJob lo vuelve a pasar a in_progress

const procs = [];
function startNode(args) { const p = spawn('node', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); procs.push(p); return p; }
try {
  const vite = startNode([path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(root, 'scripts/tests/custody-integral-lab-vite.config.mjs')]);
  let viteLog = ''; vite.stdout.on('data', b => { viteLog += b; }); vite.stderr.on('data', b => { viteLog += b; });
  startNode(['--import', 'tsx', path.join(root, 'scripts/custody-integral-lab-backend.ts')]);
  await wait(async () => (await localFetch(c.api + '/lab/config')).ok);
  await wait(async () => { try { return (await localFetch(c.gateway.replace('54421', '54422') + '/scripts/tests/custody-integral-lab.html')).ok; } catch { return false; } }).catch(() => { throw Error('Vite no respondio: ' + viteLog.slice(-2000)); });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'custody-integral-lab-clicks-'));
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
    // RoutineInventory.vue tiene :key="jobId" -- __openJob hacia el MISMO
    // trabajo nunca lo desmonta/remonta (la navegacion a la misma ruta es
    // un no-op de Vue Router), asi que su watcher "immediate" nunca se
    // repite y 'materials'/'products' quedan con la lectura del primer
    // montaje. Navegar a otra ruta y volver SI fuerza un desmontaje real.
    const reopenJob = async (index) => { await evaluate("window.__router.push('/campo/custodia')"); await new Promise(r => setTimeout(r, 300)); await evaluate('window.__openJob(' + index + ')'); };
    const setBySelector = async (selector, value) => {
      const ok = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;})()`);
      if (!ok) throw Error('No se encontro el input/select: ' + selector);
    };

    await cdp('Page.navigate', { url: 'http://127.0.0.1:54422/scripts/tests/custody-integral-lab.html' });
    await until('window.__ready === true', 'carga del harness real');
    await evaluate("window.__login('leader')");
    pass('login real (GoTrue) como leader dentro del navegador');

    // ===================== Alta/Averia: reintento+correccion+reversion por CLIC real =====================
    for (const kind of ['installation', 'ticket']) {
      const job = noMaterialJobs[kind];
      // El input de cantidad tiene :max=custodia cargada (proteccion real de
      // UX) -- un valor por encima del max queda bloqueado por el propio
      // navegador (checkValidity()), nunca llega a Vue/al RPC. El escenario
      // real que SI alcanza el servidor es el mas realista: la pantalla ya
      // cargo un max alto, y la custodia real cambia DESPUES (otra correccion
      // concurrente) sin que la pantalla se haya vuelto a consultar todavia.
      const movementsBefore = Number(sql(`select count(*) from inventory_movements where product_id='${material}' and (installation_id='${job.id}' or ticket_id='${job.id}');`));
      const custodyBeforeDeliver = custodyOf(); // puede ser >0 si ya se entrego custodia en una iteracion anterior de este mismo guion (Alta ya probada)
      const uiMax = custodyBeforeDeliver + 30;
      await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 30, p_reason: 'Entrega inicial para prueba de clics reales (' + kind + ')' });
      await evaluate('window.__openJob(' + indexOf(job) + ')');
      await until("window.__router.currentRoute.value.path==='/campo/" + kind + "/" + job.id + "'");
      // Alta usa un wizard de 5 pasos (Fase 142) -- un tecnico real entra al
      // paso "3. Materiales" con un clic antes de ver esa seccion (v-show).
      if (kind === 'installation') await clickWhenReady('button', '3. Materiales');
      await until("[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Materiales usados')?.querySelector('form select')?.options.length>1", 'opciones reales de materiales cargadas (max=30 ya en el DOM)');

      // Mientras la pantalla sigue con max=30, otra correccion REAL (otra
      // sesion/dispositivo del mismo tecnico, o una devolucion administrativa)
      // reduce la custodia real a 3 -- el navegador no lo sabe todavia.
      const returnReqId = await leaderNode.rpc('request_material_return', { p_product_id: material, p_quantity: 27, p_reason: 'Correccion concurrente real durante la prueba de clics' });
      assert.equal(returnReqId.error, null, JSON.stringify(returnReqId.error));
      const confirmReturn = await admin.rpc('confirm_material_return', { p_request_id: returnReqId.data, p_approved: true, p_note: 'Confirmacion real concurrente' });
      assert.equal(confirmReturn.error, null, JSON.stringify(confirmReturn.error));
      const realCustodyNow = custodyOf();
      assert.equal(realCustodyNow, uiMax - 27);

      const excessQty = realCustodyNow + 20; // dentro del max todavia en el DOM, pero por encima de la custodia real
      const setAdd = await evaluate(`(async()=>{
        const section=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Materiales usados');
        if(!section)return 'no-section';
        const select=section.querySelector('form select');const qty=section.querySelector('form input[type=number]');
        if(!select||!qty)return 'no-fields';
        select.value=${JSON.stringify(material)};select.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(r=>setTimeout(r,200)); // deja que Vue reactualice :max del input tras el cambio de producto
        qty.value='${excessQty}';qty.dispatchEvent(new Event('input',{bubbles:true}));
        return (qty.checkValidity()?'valid':'invalid')+' max='+qty.max;
      })()`);
      assert.equal(setAdd, 'valid max=' + uiMax, setAdd); // confirma que la pantalla real sigue con el max desactualizado
      await clickByText('button[type=submit]', '+');
      await until(`document.body.innerText.toLowerCase().includes('custodia')&&document.body.innerText.toLowerCase().includes('administrador')`, 'error real de custodia insuficiente tras clic en +');
      await until(`document.body.innerText.includes('Hay una operación de inventario pendiente de confirmar.')`, 'aviso real de operación pendiente');
      pass('clic real "+" con una cantidad dentro del máximo desactualizado en pantalla pero por encima de la custodia real (' + kind + '): error real en pantalla y operación pendiente real');

      const movementsAfterReject = Number(sql(`select count(*) from inventory_movements where product_id='${material}' and (installation_id='${job.id}' or ticket_id='${job.id}');`));
      assert.equal(movementsAfterReject, movementsBefore, 'el intento rechazado no debe dejar ningun movimiento real nuevo');
      assert.equal(custodyOf(), realCustodyNow, 'la custodia real no debe cambiar por un intento rechazado');
      // Identifica el intento EXACTO rechazado por su operation_id real (nunca
      // "el ultimo movimiento" -- este job puede acumular Kardex de corridas
      // anteriores del mismo guion, insert-only, nunca se borra).
      const rejectedOperationId = sql(`select operation_id from material_inventory_rejections where job_id='${job.id}' and status='pending' order by created_at desc limit 1;`);
      assert.ok(rejectedOperationId, 'debe existir el rechazo real recien registrado');

      // 2) Entrega adicional + clic real en "Confirmar operación de inventario pendiente" -> reintento real, mismo UUID.
      await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 25, p_reason: 'Entrega adicional tras rechazo real por clic (' + kind + ')' });
      await clickWhenReady('button', 'Confirmar operación de inventario pendiente');
      await until(`!document.body.innerText.includes('Hay una operación de inventario pendiente de confirmar.')`, 'la operación pendiente real se resuelve tras el clic de reintento');
      const before = realCustodyNow + 25;
      assert.equal(custodyOf(), before - excessQty);
      const resolvedStatus = sql(`select status from material_inventory_rejections where operation_id='${rejectedOperationId}';`);
      assert.equal(resolvedStatus, 'resolved');
      const movementId = sql(`select result->'ids'->>0 from campo_inventory_operations where id='${rejectedOperationId}';`);
      assert.ok(movementId, 'el reintento real por clic debio dejar el movimiento real en el Kardex');
      pass('clic real en "Confirmar operación de inventario pendiente" (' + kind + '): reintento real con la MISMA clave resuelve el rechazo');

      // 3) Correccion real por clic: lapiz -> cambiar cantidad -> Guardar.
      const materialsSectionExpr = `[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Materiales usados')`;
      await until(`${materialsSectionExpr}?.querySelector('button[title="Corregir cantidad"]')?.disabled===false`, 'boton real de corregir cantidad habilitado (sin otra operacion real en curso)');
      const activeRowCount = await evaluate(`${materialsSectionExpr}.querySelectorAll('li').length`);
      assert.equal(activeRowCount, 1, 'debe haber exactamente un consumo real activo antes de corregirlo (la limpieza previa debio dejar el Kardex sin residuos activos)');
      await evaluate(`(()=>{const btn=${materialsSectionExpr}.querySelector('button[title="Corregir cantidad"]');btn.click();return true;})()`);
      await until(`${materialsSectionExpr}?.querySelector('li input[type=number]')!==null`, 'input real de corrección visible');
      const correctedQty = 3;
      const editResult = await evaluate(`(()=>{const input=${materialsSectionExpr}.querySelector('li input[type=number]');input.value='${correctedQty}';input.dispatchEvent(new Event('input',{bubbles:true}));return 'value='+input.value;})()`);
      assert.equal(editResult, 'value=' + correctedQty, editResult);
      await evaluate(`(()=>{const btns=[...${materialsSectionExpr}.querySelectorAll('button')];const btn=btns.find(b=>b.textContent.trim()==='Guardar');btn.click();return true;})()`);
      await until(`${materialsSectionExpr}?.querySelector('li')?.textContent.includes('${correctedQty} unidad')`, 'la lista real refleja la cantidad corregida tras el viaje redondo real al servidor');
      const custodyAfterCorrect = custodyOf();
      assert.equal(custodyAfterCorrect, before - correctedQty);
      pass('clic real ✏️ "Corregir cantidad" + "Guardar" (' + kind + '): corrección real, custodia repuesta y re-descontada');

      // 4) Reversion real por clic: papelera (Quitar material).
      await until(`${materialsSectionExpr}?.querySelector('button[title="Quitar material"]')?.disabled===false`, 'boton real de quitar material habilitado (sin otra operacion real en curso)');
      await evaluate(`(()=>{${materialsSectionExpr}.querySelector('button[title="Quitar material"]').click();return true;})()`);
      await until(`!${materialsSectionExpr}?.querySelector('li')`, 'la lista real queda sin consumos activos tras quitar');
      assert.equal(custodyOf(), before);
      const stillActive = Number(sql(`select count(*) from inventory_movements m where product_id='${material}' and (m.installation_id='${job.id}' or m.ticket_id='${job.id}') and m.movement_type='egreso' and not exists(select 1 from inventory_movements r where r.reverses_movement_id=m.id);`));
      assert.equal(stillActive, 0, 'no debe quedar ningun egreso real activo (sin revertir) tras quitar el material');
      pass('clic real 🗑️ "Quitar material" (' + kind + '): reversión real completa, custodia de vuelta a ' + before);

      // El candado real de "un solo trabajo activo" (Fase 137) bloquearia al
      // mismo tecnico abriendo el siguiente trabajo de esta prueba mientras
      // este siga in_progress -- se libera aqui (no es parte de lo que se
      // esta probando en este bloque).
      if (kind === 'installation') sql(`update installations set status='scheduled' where id='${job.id}';`);
      else sql(`update tickets set status='open' where id='${job.id}';`);
    }

    // ===================== Rutina: reintento+correccion+reversion por CLIC real (RoutineInventory.vue) =====================
    // Corregido el hallazgo anterior (ver src/lib/inventoryRefresh.ts): el
    // aviso inicial de visibilidad (startInventorySignals, real en un
    // WebView/pestaña que todavia no se marca visible) ya no borra los
    // datos recien publicados. Mismo patron real de "max desactualizado"
    // que en Alta/Averia, ahora tambien por CLIC real de punta a punta.
    {
      const job = noMaterialJobs.routine;
      const custodyBeforeDeliverRoutine = custodyOf(); // puede ser >0 (Alta/Averia ya probadas con el mismo tecnico)
      const uiMaxRoutine = custodyBeforeDeliverRoutine + 30;
      await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 30, p_reason: 'Entrega inicial para prueba de clics reales (routine)' });
      await evaluate('window.__openJob(' + indexOf(job) + ')');
      await until("window.__router.currentRoute.value.path==='/campo/routine/" + job.id + "'");
      await until(`document.querySelector('[aria-label="Material de bodega"]')?.options.length>1`, 'opciones reales de materiales de la rutina cargadas');
      const returnReqIdRoutine = await leaderNode.rpc('request_material_return', { p_product_id: material, p_quantity: 27, p_reason: 'Correccion concurrente real durante la prueba de clics (routine)' });
      assert.equal(returnReqIdRoutine.error, null, JSON.stringify(returnReqIdRoutine.error));
      const confirmReturnRoutine = await admin.rpc('confirm_material_return', { p_request_id: returnReqIdRoutine.data, p_approved: true, p_note: 'Confirmacion real concurrente (routine)' });
      assert.equal(confirmReturnRoutine.error, null, JSON.stringify(confirmReturnRoutine.error));
      const realCustodyNowRoutine = custodyOf();
      assert.equal(realCustodyNowRoutine, uiMaxRoutine - 27);

      const excessQty = realCustodyNowRoutine + 20; // dentro del max todavia en el DOM, por encima de la custodia real
      await setBySelector('[aria-label="Material de bodega"]', material);
      await until(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Registrar material utilizado')?.disabled===false`, 'boton real habilitado tras elegir material (Rutina)');
      const qtyCheckRoutine = await evaluate(`(()=>{const qty=document.querySelector('[aria-label="Cantidad utilizada"]');qty.value='${excessQty}';qty.dispatchEvent(new Event('input',{bubbles:true}));return 'max='+qty.max;})()`);
      assert.equal(qtyCheckRoutine, 'max=' + uiMaxRoutine, qtyCheckRoutine); // confirma que la pantalla real sigue con el max desactualizado
      const movementsBeforeRejectRoutine = Number(sql(`select count(*) from inventory_movements where product_id='${material}' and routine_id='${job.id}';`));
      await clickByText('button', 'Registrar material utilizado');
      await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Reintentar operación pendiente')`, 'botón real de reintento visible (Rutina)');
      pass('clic real "Registrar material utilizado" con una cantidad dentro del máximo desactualizado pero por encima de la custodia real (Rutina): rechazo real, botón de reintento real visible');

      const movementsAfterRejectRoutine = Number(sql(`select count(*) from inventory_movements where product_id='${material}' and routine_id='${job.id}';`));
      assert.equal(movementsAfterRejectRoutine, movementsBeforeRejectRoutine, 'el intento rechazado no debe dejar ningun movimiento real nuevo en la rutina');

      await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 25, p_reason: 'Entrega adicional tras rechazo real por clic (routine)' });
      await clickByText('button', 'Reintentar operación pendiente');
      await until(`![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Reintentar operación pendiente')`, 'el reintento real (Rutina) resuelve la operación pendiente');
      const beforeRoutine = realCustodyNowRoutine + 25;
      assert.equal(custodyOf(), beforeRoutine - excessQty);
      pass('clic real "Reintentar operación pendiente" (Rutina): reintento real con la MISMA clave resuelve el rechazo');

      // Lista real "Materiales utilizados" -- ahora SI debe mostrar el
      // consumo real sin necesidad de recargar la pantalla (hallazgo corregido).
      await until(`[...document.querySelectorAll('h3')].find(h=>h.textContent.includes('Materiales utilizados'))?.nextElementSibling?.querySelector('li')!==null`, 'lista real de materiales de la rutina poblada tras el reintento (sin recargar)');
      pass('la lista real "Materiales utilizados" refleja el consumo real sin recargar la pantalla (hallazgo corregido)');

      await clickWhenReady('button', 'Corregir');
      await until(`document.querySelector('[aria-label="Cantidad corregida"]')!==null`, 'input real de corrección visible (Rutina)');
      const correctedQtyRoutine = 3;
      await setBySelector('[aria-label="Cantidad corregida"]', correctedQtyRoutine);
      await clickByText('button', 'Guardar corrección');
      await until(`[...document.querySelectorAll('h3')].find(h=>h.textContent.includes('Materiales utilizados'))?.nextElementSibling?.querySelector('li')?.textContent.includes('${correctedQtyRoutine} unidad')`, 'la lista real refleja la cantidad corregida (Rutina)');
      assert.equal(custodyOf(), beforeRoutine - correctedQtyRoutine);
      pass('clic real "Corregir" + "Guardar corrección" (Rutina): corrección real aplicada y reflejada en pantalla sin recargar');

      await clickWhenReady('button', 'Quitar registro');
      await until(`document.body.innerText.includes('Sin consumos registrados.')`, 'la lista real de la rutina queda sin consumos tras quitar (Rutina)');
      assert.equal(custodyOf(), beforeRoutine);
      pass('clic real "Quitar registro" (Rutina): reversión real completa y reflejada en pantalla, custodia de vuelta a ' + beforeRoutine);
    }

    // ===================== Equipo serializado: devolucion real por clic (circuito independiente, sin tocar su codigo) =====================
    {
      await admin.rpc('deliver_unit_to_technician', { p_unit_id: noMaterialJobs.installation.unitId, p_technician_id: leaderId, p_reason: 'Entrega de equipo para probar devolucion real por clic' });
      const statusBefore = sql(`select status from inventory_units where id='${noMaterialJobs.installation.unitId}';`);
      assert.equal(statusBefore, 'with_technician');
      await evaluate('window.__openMyCustody()');
      await until("window.__router.currentRoute.value.path==='/campo/custodia'", 'navegación real a Mis equipos y materiales');
      await until(`document.body.innerText.includes('LAB ONU')`, 'el equipo real entregado aparece en la pantalla propia del técnico');
      await clickWhenReady('button', 'Devolver');
      await until(`document.querySelector('textarea')!==null`, 'formulario real de motivo de devolución visible');
      await evaluate(`(()=>{const t=document.querySelector('textarea');t.value='Equipo no utilizado en la rutina de prueba';t.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
      await clickByText('button', 'Confirmar solicitud de devolución');
      await until(`document.body.innerText.includes('Devolución en espera de recepción')`, 'el estado real de devolución en espera aparece tras el clic');
      const statusAfterRequest = sql(`select status from inventory_units where id='${noMaterialJobs.installation.unitId}';`);
      assert.equal(statusAfterRequest, 'pending_return');
      pass('clic real "Devolver" + motivo + "Confirmar solicitud de devolución" (CampoCustodiaView): request_unit_return real, equipo en pending_return');

      // Recepcion administrativa (circuito independiente intacto, mismo RPC
      // real que ya usa InventarioCustodiaView.vue -- no se modifica su UI).
      const receive = await admin.rpc('receive_unit_return', { p_unit_id: noMaterialJobs.installation.unitId, p_condition: 'in_stock', p_reason: 'Recepción real de prueba' });
      assert.equal(receive.error, null, JSON.stringify(receive.error));
      const statusAfterReceive = sql(`select status,custody_technician_id from inventory_units where id='${noMaterialJobs.installation.unitId}';`);
      const [finalStatus, finalCustody] = statusAfterReceive.split('|');
      assert.equal(finalStatus, 'in_stock');
      assert.equal(finalCustody, '');
      pass('recepción administrativa real (receive_unit_return, circuito independiente sin modificar): equipo de vuelta a in_stock, sin custodia de ningún técnico');
    }

    assert.equal(external.length, 0, 'ninguna peticion debio salir del laboratorio aislado: ' + JSON.stringify(external));
    const unexpected = exceptions.filter(e => !/formDrafts\.ts|idb-keyval/.test(e));
    assert.equal(unexpected.length, 0, JSON.stringify(unexpected));
    if (exceptions.length) console.log('(ignoradas, ajenas al circuito real: ' + exceptions.length + ' fallas de borrador local IndexedDB)');
    pass('sin peticiones externas ni excepciones no controladas durante toda la sesion de navegador');

    await send('Browser.close');
  } finally {
    ws?.close();
  }
} finally {
  for (const p of procs) p.kill();
}

await writeFile(path.join(root, 'docs/CUSTODIA-ETAPA2-LABORATORIO-INTEGRAL-CLICKS.json'), JSON.stringify({
  at: new Date().toISOString(), scope: 'REAL_BROWSER_REAL_CLICKS_REAL_DB_REST_AUTH_NO_SIMULATION', lab: c.project, results,
}, null, 2) + '\n');
console.log('CUSTODY_INTEGRAL_CLICKS_CIRCUIT_REAL: ' + results.length + ' escenarios PASS');
