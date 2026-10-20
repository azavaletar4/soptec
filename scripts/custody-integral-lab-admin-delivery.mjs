// Prueba real por CLIC del formulario administrativo de entrega de
// materiales (InventarioCustodiaView.vue > pestaña Entregas ->
// technicianCustody.ts -> deliver_material_to_technician). Pendiente
// señalado en el informe anterior: el RPC ya se probó con éxito muchas
// veces via supabase-js directo, pero nunca por clic real sobre ESTA
// pantalla. Extiende el harness compartido (custody-integral-lab.html)
// agregando la ruta real '/inventario/custodia' -- cambio puramente
// aditivo, no toca las rutas que ya usan clicks.mjs/kit.mjs.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { config, root, sql, localFetch, wait } from './custody-integral-lab-common.mjs';

const c = config();
const fixture = JSON.parse(fs.readFileSync(path.join(c.directory, 'fixture.json'), 'utf8'));
const leaderId = fixture.users.leader;
const job = fixture.jobs.find(j => j.kind === 'installation' && !j.materials); // mismo trabajo sintetico ya certificado (indice 1)
const DROP100 = '72328f6a-d3f0-4e2b-8337-dc7704816db5'; // producto real del catalogo, activo, no serializado
const results = [];
const pass = (name) => { results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
function custodyOf() { return Number(sql(`select coalesce((select quantity from technician_material_custody where technician_id='${leaderId}' and product_id='${DROP100}'),0);`)); }
function eventsCount() { return Number(sql(`select count(*) from technician_material_custody_events where technician_id='${leaderId}' and product_id='${DROP100}' and event_type='delivery';`)); }
const stock = Number(sql(`select current_stock from inventory_products where id='${DROP100}';`));

sql(`update installations set status='scheduled' where id='${job.id}';`);

const procs = [];
function startNode(args) { const p = spawn('node', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); procs.push(p); return p; }
try {
  const vite = startNode([path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(root, 'scripts/tests/custody-integral-lab-vite.config.mjs')]);
  let viteLog = ''; vite.stdout.on('data', b => { viteLog += b; }); vite.stderr.on('data', b => { viteLog += b; });
  startNode(['--import', 'tsx', path.join(root, 'scripts/custody-integral-lab-backend.ts')]);
  await wait(async () => (await localFetch(c.api + '/lab/config')).ok);
  await wait(async () => { try { return (await localFetch(c.gateway.replace('54421', '54422') + '/scripts/tests/custody-integral-lab.html')).ok; } catch { return false; } }).catch(() => { throw Error('Vite no respondio: ' + viteLog.slice(-2000)); });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'custody-integral-lab-admindelivery-'));
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
    await evaluate("window.__login('admin')");
    pass('login real (GoTrue) como admin dentro del navegador');

    await evaluate("window.__openInventarioCustodia()");
    await until("window.__router.currentRoute.value.path==='/inventario/custodia'", 'navegación real a Custodia de técnicos');
    await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Entregas')`, 'pestaña real "Entregas" visible (pantalla terminó de cargar)');
    await clickByText('button', 'Entregas'); // pantalla real con pestañas -- el formulario vive en la pestaña "Entregas"
    const sectionExpr = `[...document.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Entregar material a un técnico')?.closest('.surface')`;
    await until(`${sectionExpr}?.querySelectorAll('select')[0]?.options.length>1`, 'opciones reales de material cargadas en la pantalla real de administración');
    await until(`${sectionExpr}?.querySelectorAll('select')[1]?.options.length>1`, 'opciones reales de técnicos cargadas en la pantalla real de administración');
    pass('navegación real a /inventario/custodia (InventarioCustodiaView, nueva ruta agregada al laboratorio): pantalla y catálogo real cargados');

    const fill = async (productId, technicianId, qtyRaw) => {
      await evaluate(`(()=>{const sel=${sectionExpr}.querySelectorAll('select')[0];sel.value=${JSON.stringify(productId)};sel.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await evaluate(`(()=>{const sel=${sectionExpr}.querySelectorAll('select')[1];sel.value=${JSON.stringify(technicianId)};sel.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await evaluate(`(()=>{const qty=${sectionExpr}.querySelector('input[type=number]');qty.value=${JSON.stringify(String(qtyRaw))};qty.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    };
    const deliverAndConfirm = async () => {
      await clickByText('button', 'Entregar material');
      await until(`document.body.innerText.includes('Confirmar entrega de material')`, 'modal real de confirmación visible');
      await clickWhenReady('button', 'Confirmar');
    };

    // ===================== Escenario A: entrega válida =====================
    const before0 = custodyOf(); const events0 = eventsCount();
    await fill(DROP100, leaderId, '5');
    await deliverAndConfirm();
    await until(`${sectionExpr}?.querySelector('input[type=number]')?.value===''`, 'el formulario real se limpia tras confirmar la entrega (recibo real confirmado)');
    assert.equal(custodyOf(), before0 + 5, 'la custodia real del técnico debe reflejar exactamente la entrega real por clic');
    assert.equal(eventsCount(), events0 + 1);
    pass('clic real "Entregar material" + modal real "Confirmar" (InventarioCustodiaView): entrega válida registrada, custodia del técnico incrementada exactamente en 5');

    // ===================== Escenario B: cantidad superior al stock central =====================
    // deliver_material_to_technician() NO valida contra inventory_products.current_stock
    // (confirmado leyendo la migracion 20261017030000) -- por diseño, el
    // almacen central y la custodia del tecnico se llevan por separado (el
    // propio mensaje real de confirmacion ya lo advierte: "Esto no descuenta
    // el almacen central"). Se prueba el comportamiento REAL, no uno asumido.
    const overStock = stock + 50;
    const before1 = custodyOf(); const events1 = eventsCount();
    await fill(DROP100, leaderId, String(overStock));
    await deliverAndConfirm();
    await until(`${sectionExpr}?.querySelector('input[type=number]')?.value===''`, 'el formulario real se limpia tras confirmar una entrega mayor al stock central');
    assert.equal(custodyOf(), before1 + overStock, 'una cantidad mayor al stock central se entrega igual -- sin tope, por diseño (no descuenta almacen central)');
    assert.equal(eventsCount(), events1 + 1);
    pass(`clic real con cantidad (${overStock}) mayor al stock central real (${stock}) de Drop 100m: SIN bloqueo -- comportamiento real confirmado por diseño (la entrega a custodia es independiente del stock central), no es un error`);

    // ===================== Escenario C: intento duplicado (misma entrega repetida) =====================
    // handleDeliverMaterial recien marca savingDeliverMaterial=true DESPUES
    // de confirmar el modal real (el primer clic solo abre el modal) -- el
    // boton se deshabilita de inmediato tras clickear "Confirmar", mientras
    // el RPC real todavia esta en curso.
    const before2 = custodyOf(); const events2 = eventsCount();
    await fill(DROP100, leaderId, '5');
    await clickByText('button', 'Entregar material');
    await until(`document.body.innerText.includes('Confirmar entrega de material')`, 'modal real de confirmación visible (1er intento)');
    await clickByText('button', 'Confirmar');
    const disabledRightAfterConfirm = await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Entregando...')?.disabled===true`);
    assert.ok(disabledRightAfterConfirm, 'el botón real debe deshabilitarse de inmediato tras confirmar (protección real contra doble clic accidental mientras la entrega real está en curso)');
    await until(`${sectionExpr}?.querySelector('input[type=number]')?.value===''`, 'primer intento real confirmado');
    await fill(DROP100, leaderId, '5'); // repetir EXACTAMENTE la misma entrega real por clic
    await deliverAndConfirm();
    await until(`${sectionExpr}?.querySelector('input[type=number]')?.value===''`, 'segundo intento real (duplicado) confirmado');
    assert.equal(custodyOf(), before2 + 10, 'un intento duplicado real (misma entrega repetida dos veces) NO se bloquea -- por diseño, es una reposicion administrativa legitima, no una operacion con clave de idempotencia como el consumo de campo');
    assert.equal(eventsCount(), events2 + 2, 'deben quedar 2 eventos reales de entrega en el Kardex, uno por cada clic -- nunca se fusionan ni se descartan silenciosamente');
    pass('clic real del botón deshabilitado mientras la entrega está en curso (protección anti doble-clic accidental) + repetir la MISMA entrega real dos veces de forma secuencial: ambas se registran íntegras (reposición administrativa, no requiere clave de idempotencia)');

    // ===================== Escenario D: material entregado disponible en App de Campo =====================
    // La disponibilidad real (availableOf/custodyLabel) se calcula sobre la
    // custodia PROPIA de quien mira la pantalla (materialCustodyState solo
    // es 'ready' para TECNICO_RED) -- hay que ver esto como el propio
    // técnico (leader), igual que el resto de pruebas ya certificadas.
    await evaluate("window.__login('leader')");
    await evaluate('window.__openJob(' + fixture.jobs.indexOf(job) + ')');
    await until("window.__router.currentRoute.value.path==='/campo/installation/" + job.id + "'");
    await clickWhenReady('button', '3. Materiales');
    const kitSectionExpr = `[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.trim()==='📦 Kit base de instalación')`;
    const dropSelectExpr = `${kitSectionExpr}.querySelector('select')`;
    await until(`${dropSelectExpr}?.options.length>1`, 'opciones reales de Drop prefabricado visibles en App de Campo tras la entrega administrativa');
    const dropOptionLabel = await evaluate(`(()=>{const el=${dropSelectExpr};const opt=[...el.options].find(o=>o.value===${JSON.stringify(DROP100)});return opt?opt.textContent:null;})()`);
    assert.ok(dropOptionLabel, 'el producto entregado por administración debe aparecer como opción real en el Kit base de Alta');
    const expectedAvailable = custodyOf();
    assert.ok(dropOptionLabel.includes(String(expectedAvailable)), 'la disponibilidad real mostrada en App de Campo (' + dropOptionLabel + ') debe reflejar la custodia real tras las entregas administrativas (' + expectedAvailable + ')');
    pass('el material entregado por administración (clic real) queda disponible para consumir en App de Campo con la cantidad real correcta, sin recargar manualmente ni intervención adicional');

    // ===================== Escenario E: error de entrega real -> sin movimiento parcial =====================
    await evaluate("window.__login('admin')"); // deliver_material_to_technician exige rol ADMIN/SUPERADMIN real
    await evaluate("window.__openInventarioCustodia()");
    await clickWhenReady('button', 'Entregas');
    await until(`${sectionExpr}?.querySelectorAll('select')[0]?.options.length>1`, 'pantalla real de administración recargada');
    const before3 = custodyOf(); const events3 = eventsCount();
    await fill(DROP100, leaderId, '2.345'); // 3 decimales: el RPC real exige hasta 2 (round(p_quantity,2)), el input no lo impide al no ser un submit de <form>
    await clickByText('button', 'Entregar material');
    await until(`document.body.innerText.includes('Confirmar entrega de material')`, 'modal real de confirmación visible (cantidad inválida)');
    await clickWhenReady('button', 'Confirmar');
    await until(`!document.body.innerText.includes('Confirmar entrega de material')`, 'el modal real se cierra tras el intento');
    await new Promise(r => setTimeout(r, 1500)); // deja tiempo real al viaje redondo fallido antes de verificar
    assert.equal(custodyOf(), before3, 'un intento de entrega con error real (cantidad con más de 2 decimales, rechazada por el RPC real) no debe modificar la custodia');
    assert.equal(eventsCount(), events3, 'un intento de entrega con error real no debe dejar ningún evento parcial en el Kardex');
    pass('clic real con cantidad inválida (2.345, más de 2 decimales): el RPC real la rechaza, sin movimiento ni custodia parcial');

    assert.equal(external.length, 0, 'ninguna peticion debio salir del laboratorio aislado: ' + JSON.stringify(external));
    const unexpected = exceptions.filter(e => !/formDrafts\.ts|idb-keyval/.test(e));
    assert.equal(unexpected.length, 0, JSON.stringify(unexpected));
    if (exceptions.length) console.log('(ignoradas, ajenas al circuito real: ' + exceptions.length + ' fallas de borrador local IndexedDB)');
    pass('sin peticiones externas ni excepciones no controladas durante toda la sesión de navegador (entrega administrativa)');

    await send('Browser.close');
  } finally {
    ws?.close();
  }
} finally {
  for (const p of procs) p.kill();
}

sql(`update installations set status='scheduled' where id='${job.id}';`);
await writeFile(path.join(root, 'docs/CUSTODIA-ETAPA2-LABORATORIO-INTEGRAL-ENTREGA-ADMIN.json'), JSON.stringify({
  at: new Date().toISOString(), scope: 'REAL_BROWSER_REAL_CLICKS_REAL_DB_REST_AUTH_NO_SIMULATION_ENTREGA_ADMINISTRATIVA', lab: c.project, results,
}, null, 2) + '\n');
console.log('CUSTODY_ADMIN_DELIVERY_REAL: ' + results.length + ' escenarios PASS');
