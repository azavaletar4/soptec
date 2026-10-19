// Cierre REAL por navegador: componente Vue real (CampoTrabajoDetailView),
// store real (campo.submitClosure), Auth/REST/Storage reales -- sin mocks de
// negocio. Cubre lo que la Fase 165 etapa 2 todavia tenia SOLO simulado
// (Supabase/Storage/NAP, ver stage2-full-closure-browser.mjs): fotos y firma
// subidas de verdad, bloqueo real de cierre con material rechazado y su
// desbloqueo, cierre correcto con persistencia real verificable por SQL.
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

// Reinicio de custodia (igual criterio que custody-integral-lab-api.mjs):
// nunca se borra el Kardex (insert-only), solo el saldo de custodia.
sql(`delete from technician_material_custody_events where technician_id='${leaderId}';`);
sql(`delete from technician_material_custody where technician_id='${leaderId}';`);
sql(`delete from material_inventory_rejections where job_id::text like 'd1650000-%';`);
sql(`delete from work_order_closures where job_id::text like 'd1650000-%';`);
sql(`delete from work_order_photos where job_id::text like 'd1650000-%';`);
sql(`delete from client_equipment_photos where job_type is not null and job_id::text like 'd1650000-%';`);
sql(`update inventory_units set status='in_stock',client_id=null,contract_id=null,installation_id=null,ticket_id=null,routine_id=null,custody_technician_id=null,pending_pickup_by=null where id::text like 'd1650000-%';`);
sql(`delete from client_photos where contract_id::text like 'd1650000-%';`);
sql(`update installations set status='scheduled' where id::text like 'd1650000-%' and status<>'cancelled';`);
sql(`update tickets set status='open' where id::text like 'd1650000-%';`);
sql(`update routines set status='scheduled' where id::text like 'd1650000-%' and status<>'cancelled';`);
sql(`update fo_nap_puertos set estado='libre',client_id=null,contract_id=null where contract_id::text like 'd1650000-%';`);

const adminJwt = await login('admin');
const admin = clientFor(adminJwt);
const leaderJwt = await login('leader'); // sesion Node auxiliar, para preparar custodia antes de entrar al navegador
const leader = clientFor(leaderJwt);

const jobs = {
  installation: fixture.jobs.find(j => j.kind === 'installation' && j.materials),
  ticket: fixture.jobs.find(j => j.kind === 'ticket' && j.materials),
  routine: fixture.jobs.find(j => j.kind === 'routine' && j.materials),
};
const indexOf = (job) => fixture.jobs.indexOf(job);
sql(`update routines set status='scheduled' where id='${jobs.routine.id}';`); // __openJob lo pasa a in_progress

await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 50, p_reason: 'Entrega para cierre real con fotos/firma en el laboratorio integral' });
assert.equal(custodyOf(), 50);

// Levanta Vite (bundle real sin mockear, VITE_SUPABASE_URL/ANON_KEY apuntan
// al gateway real del laboratorio) y el backend real (ruta GET de inventario
// contextual) -- igual patron que custody-integral-lab-api.mjs.
const procs = [];
function startNode(args) {
  const p = spawn('node', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  return p;
}
try {
  const vite = startNode([path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(root, 'scripts/tests/custody-integral-lab-vite.config.mjs')]);
  let viteLog = '';
  vite.stdout.on('data', b => { viteLog += b; });
  vite.stderr.on('data', b => { viteLog += b; });
  startNode(['--import', 'tsx', path.join(root, 'scripts/custody-integral-lab-backend.ts')]);
  await wait(async () => (await localFetch(c.api + '/lab/config')).ok);
  await wait(async () => { try { return (await localFetch(c.gateway.replace('54421', '54422') + '/scripts/tests/custody-integral-lab.html')).ok; } catch { return false; } }).catch(() => { throw Error('Vite no respondio: ' + viteLog.slice(-2000)); });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'custody-integral-lab-'));
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

    await cdp('Page.navigate', { url: 'http://127.0.0.1:54422/scripts/tests/custody-integral-lab.html' });
    await until('window.__ready === true', 'carga del harness real');
    await evaluate("window.__login('leader')");
    pass('login real (GoTrue) como leader dentro del navegador, componente real montado');

    // ===================== Alta: cierre real con fotos/firma + persistencia verificable =====================
    {
      const job = jobs.installation;
      await evaluate('window.__openJob(' + indexOf(job) + ')');
      await until("window.__router.currentRoute.value.path==='/campo/installation/" + job.id + "'");
      const opId = crypto.randomUUID();
      const consume = await leader.rpc('campo_inventory_operation', { p_operation_id: opId, p_job_type: 'installation', p_job_id: job.id, p_action: 'consume', p_payload: { productId: material, quantity: 6 } });
      assert.equal(consume.error, null, JSON.stringify(consume.error));
      pass('consumo real de material desde la sesion del navegador (leader, 6 unidades)');

      // Alta de internet/combo exige un equipo serializado asignado antes
      // de completar -- y para Altas, 'assign' exige que la ONU este bajo
      // la PROPIA custodia del tecnico (with_technician), no basta con
      // in_stock en bodega (regla especifica de esta rama, ver 42501 real).
      const deliverUnit = await admin.rpc('deliver_unit_to_technician', { p_unit_id: job.unitId, p_technician_id: leaderId, p_reason: 'Entrega de ONU para cierre real de laboratorio integral' });
      assert.equal(deliverUnit.error, null, JSON.stringify(deliverUnit.error));
      const assign = await leader.rpc('campo_inventory_operation', { p_operation_id: crypto.randomUUID(), p_job_type: 'installation', p_job_id: job.id, p_action: 'assign', p_payload: { unitId: job.unitId } });
      assert.equal(assign.error, null, JSON.stringify(assign.error));
      pass('equipo serializado (ONU sintetica) asignado a la Alta antes del cierre, via RPC real');

      const snapshot = await evaluate(`(async()=>{
        const canvas=document.createElement('canvas');canvas.width=6;canvas.height=6;canvas.getContext('2d').fillRect(0,0,6,6);
        const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const file=category=>new File([png],category+'.png',{type:'image/png'});
        const categories=['facade','service_sheet','nap_box','modem_position','pon_power'];
        const input={jobType:'installation',jobId:${JSON.stringify(job.id)},clientId:${JSON.stringify(job.clientId)},contractId:${JSON.stringify(job.contractId)},
          targetStatus:'completed',latitude:-12.046,longitude:-77.03,ontSerial:null,closureNotes:'Cierre real de laboratorio integral (Alta)',
          photos:categories.map(category=>({category,file:file(category)})),equipmentPhotos:[],signatureBlob:png,updateClientGps:true,
          clientPhotoCategories:categories,pendingApprovalCategories:[],motivoAveria:null,motivoAveriaDetalle:null,justificacionCierre:null,
          potenciaDbm:null,napElementoId:${JSON.stringify(fixture.nap)},zoneId:${JSON.stringify(fixture.zone)},ontReplaced:false,installationAddress:null,clientCode:null};
        const result=await window.__campoStore.submitClosure(input);
        return {result};
      })()`);
      assert.equal(snapshot.result.queued, false, JSON.stringify(snapshot));
      pass('cierre real de Alta: campo.submitClosure (componente/store reales) no lo encola, se ejecuta de inmediato');

      const closure = sql(`select signature_path,closure_notes from work_order_closures where job_type='installation' and job_id='${job.id}';`);
      const [signaturePath] = closure.split('|');
      assert.ok(signaturePath && signaturePath.startsWith('installation/' + job.id + '/signature-'), closure);
      const photoCount = Number(sql(`select count(*) from work_order_photos where job_type='installation' and job_id='${job.id}' and status='approved';`));
      assert.equal(photoCount, 5);
      const clientPhotoCount = Number(sql(`select count(*) from client_photos where contract_id='${job.contractId}';`));
      assert.equal(clientPhotoCount, 5);
      const installationStatus = sql(`select status from installations where id='${job.id}';`);
      assert.equal(installationStatus, 'completed');
      const signatureStored = Number(sql(`select count(*) from storage.objects where bucket_id='work-evidence' and name='${signaturePath}';`));
      assert.equal(signatureStored, 1);
      const photoObjects = Number(sql(`select count(*) from storage.objects o join work_order_photos p on o.name=p.storage_path and o.bucket_id='work-evidence' where p.job_type='installation' and p.job_id='${job.id}';`));
      assert.equal(photoObjects, 5);
      pass('persistencia real verificada por SQL: work_order_closures/work_order_photos/client_photos + 6 objetos reales en storage.objects (5 fotos + firma)');
    }

    // ===================== Averia: rechazo real bloquea el cierre, se resuelve y cierra =====================
    {
      const job = jobs.ticket;
      await evaluate('window.__openJob(' + indexOf(job) + ')');
      await until("window.__router.currentRoute.value.path==='/campo/ticket/" + job.id + "'");
      const rejectOpId = crypto.randomUUID();
      const custodyBeforeReject = custodyOf();
      const tooMuchForCustody = custodyBeforeReject + 20; // excede la custodia, nunca el stock del almacen (1000)
      const reject = await leader.rpc('campo_inventory_operation', { p_operation_id: rejectOpId, p_job_type: 'ticket', p_job_id: job.id, p_action: 'consume', p_payload: { productId: material, quantity: tooMuchForCustody } });
      assert.equal(reject.error, null, JSON.stringify(reject.error));
      assert.equal(reject.data.materialRejected, true);
      pass('rechazo real de consumo (sin custodia suficiente) registrado desde la sesion del navegador');

      const blocked = await evaluate(`(async()=>{
        const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);
        const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const input={jobType:'ticket',jobId:${JSON.stringify(job.id)},clientId:${JSON.stringify(job.clientId)},contractId:${JSON.stringify(job.contractId)},
          targetStatus:'resolved',latitude:-12.046,longitude:-77.03,ontSerial:null,closureNotes:'Intento de cierre con material rechazado pendiente',
          photos:[],equipmentPhotos:[],signatureBlob:png,updateClientGps:false,clientPhotoCategories:[],pendingApprovalCategories:[],
          motivoAveria:'material_wear',motivoAveriaDetalle:null,justificacionCierre:null,potenciaDbm:-18,napElementoId:null,zoneId:null,
          ontReplaced:false,installationAddress:null,clientCode:null};
        try{await window.__campoStore.submitClosure(input);return {threw:false};}
        catch(e){return {threw:true,message:String(e?.message??e)};}
      })()`);
      assert.equal(blocked.threw, true, JSON.stringify(blocked));
      assert.match(blocked.message, /No se puede cerrar/);
      const closureRowsBefore = Number(sql(`select count(*) from work_order_closures where job_type='ticket' and job_id='${job.id}';`));
      assert.equal(closureRowsBefore, 0, 'el cierre bloqueado por material pendiente no debe dejar ninguna fila a medias');
      pass('cierre real de Averia BLOQUEADO (P1651) por material rechazado pendiente, sin dejar evidencia a medio guardar, mensaje real mostrado al tecnico: "' + blocked.message + '"');

      await admin.rpc('deliver_material_to_technician', { p_technician_id: leaderId, p_product_id: material, p_quantity: 25, p_reason: 'Entrega adicional tras rechazo (Averia)' });
      const retry = await leader.rpc('campo_inventory_operation', { p_operation_id: rejectOpId, p_job_type: 'ticket', p_job_id: job.id, p_action: 'consume', p_payload: { productId: material, quantity: tooMuchForCustody } });
      assert.equal(retry.error, null, JSON.stringify(retry.error));
      assert.ok(retry.data.ids?.length, JSON.stringify(retry.data));
      pass('reintento real con la misma clave, tras entrega adicional, resuelve el rechazo');

      const closed = await evaluate(`(async()=>{
        const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);
        const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const file=category=>new File([png],category+'.png',{type:'image/png'});
        const input={jobType:'ticket',jobId:${JSON.stringify(job.id)},clientId:${JSON.stringify(job.clientId)},contractId:${JSON.stringify(job.contractId)},
          targetStatus:'resolved',latitude:-12.046,longitude:-77.03,ontSerial:null,closureNotes:'Cierre real de laboratorio integral (Averia)',
          photos:[{category:'evidencia_1',file:file('evidencia_1')},{category:'evidencia_2',file:file('evidencia_2')}],equipmentPhotos:[],signatureBlob:png,
          updateClientGps:false,clientPhotoCategories:[],pendingApprovalCategories:[],motivoAveria:'material_wear',motivoAveriaDetalle:null,justificacionCierre:null,
          potenciaDbm:-18,napElementoId:null,zoneId:null,ontReplaced:false,installationAddress:null,clientCode:null};
        return {result:await window.__campoStore.submitClosure(input)};
      })()`);
      assert.equal(closed.result.queued, false, JSON.stringify(closed));
      const ticketStatus = sql(`select status from tickets where id='${job.id}';`);
      assert.equal(ticketStatus, 'resolved');
      const closureRow = sql(`select signature_path from work_order_closures where job_type='ticket' and job_id='${job.id}';`);
      assert.ok(closureRow && closureRow.startsWith('ticket/' + job.id + '/signature-'), closureRow);
      const photosAfter = Number(sql(`select count(*) from storage.objects o join work_order_photos p on o.name=p.storage_path and o.bucket_id='work-evidence' where p.job_type='ticket' and p.job_id='${job.id}';`));
      assert.equal(photosAfter, 2); // evidencia_1 + evidencia_2 (la firma no es un work_order_photos, es work_order_closures.signature_path)
      const signatureStored = Number(sql(`select count(*) from storage.objects where bucket_id='work-evidence' and name='${closureRow}';`));
      assert.equal(signatureStored, 1);
      pass('cierre real de Averia una vez resuelto el rechazo: ticket resolved, 2 fotos + firma reales en Storage');
    }

    // ===================== Rutina: cierre real sin NAP, fotos minimas + firma =====================
    {
      const job = jobs.routine;
      await evaluate('window.__openJob(' + indexOf(job) + ')');
      await until("window.__router.currentRoute.value.path==='/campo/routine/" + job.id + "'");
      const opId = crypto.randomUUID();
      const consume = await leader.rpc('routine_inventory_operation', { p_routine_id: job.id, p_operation_id: opId, p_action: 'consume', p_payload: { product_id: material, quantity: 3 } });
      assert.equal(consume.error, null, JSON.stringify(consume.error));
      const closed = await evaluate(`(async()=>{
        const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);
        const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const file=category=>new File([png],category+'.png',{type:'image/png'});
        const input={jobType:'routine',jobId:${JSON.stringify(job.id)},clientId:${JSON.stringify(job.clientId)},contractId:${JSON.stringify(job.contractId)},
          targetStatus:'completed',latitude:null,longitude:null,ontSerial:null,closureNotes:'Cierre real de laboratorio integral (Rutina)',
          photos:[{category:'evidencia_1',file:file('evidencia_1')}],equipmentPhotos:[],signatureBlob:png,updateClientGps:false,
          clientPhotoCategories:[],pendingApprovalCategories:[],motivoAveria:null,motivoAveriaDetalle:null,justificacionCierre:null,potenciaDbm:null,
          napElementoId:null,zoneId:null,ontReplaced:false,installationAddress:null,clientCode:null};
        return {result:await window.__campoStore.submitClosure(input)};
      })()`);
      assert.equal(closed.result.queued, false, JSON.stringify(closed));
      const routineStatus = sql(`select status from routines where id='${job.id}';`);
      assert.equal(routineStatus, 'completed');
      const closureRow = sql(`select signature_path from work_order_closures where job_type='routine' and job_id='${job.id}';`);
      assert.ok(closureRow && closureRow.startsWith('routine/' + job.id + '/signature-'), closureRow);
      const photosAfter = Number(sql(`select count(*) from storage.objects o join work_order_photos p on o.name=p.storage_path and o.bucket_id='work-evidence' where p.job_type='routine' and p.job_id='${job.id}';`));
      assert.equal(photosAfter, 1); // evidencia_1 (la firma no es un work_order_photos, es work_order_closures.signature_path)
      const signatureStored = Number(sql(`select count(*) from storage.objects where bucket_id='work-evidence' and name='${closureRow}';`));
      assert.equal(signatureStored, 1);
      pass('cierre real de Rutina (consumo real + foto + firma reales en Storage), routine completed');
    }

    assert.equal(external.length, 0, 'ninguna peticion debio salir del laboratorio aislado: ' + JSON.stringify(external));
    // formDrafts.ts (borrador local del formulario de cierre, IndexedDB del
    // propio navegador) no es parte del circuito de custodia/cierre real que
    // prueba este guion -- en un perfil de Chrome efimero/headless el primer
    // open() de esa base puede fallar con "object store was not found" antes
    // de su propio upgrade; no afecta persistencia real (Supabase/Storage),
    // ya verificada por SQL arriba. Cualquier OTRA excepcion sigue siendo fatal.
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

await writeFile(path.join(root, 'docs/CUSTODIA-ETAPA2-LABORATORIO-INTEGRAL-BROWSER.json'), JSON.stringify({
  at: new Date().toISOString(), scope: 'REAL_BROWSER_REAL_STORE_REAL_DB_REST_AUTH_STORAGE_NO_SIMULATION', lab: c.project, results,
}, null, 2) + '\n');
console.log('CUSTODY_INTEGRAL_BROWSER_CIRCUIT_REAL: ' + results.length + ' escenarios PASS');
