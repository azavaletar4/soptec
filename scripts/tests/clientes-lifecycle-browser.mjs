// UI real con datos sintéticos. Todo acceso externo se intercepta; ninguna escritura se permite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = 'https://clients.invalid';
process.env.VITE_SUPABASE_ANON_KEY = 'synthetic';
const sourceArg = process.argv.find(a => a.startsWith('--source='))?.slice('--source='.length);
const staticMode = process.argv.includes('--static');
const staticServer = () => {
  const root = path.resolve('dist');
  const app = http.createServer(async (req,res) => {
    try {
      if (!['GET','HEAD'].includes(req.method) || req.url.startsWith('/api/')) { res.writeHead(403);res.end();return; }
      const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      const target=path.resolve(root,'.'+pathname);
      if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
      const file=path.extname(pathname)?target:path.join(root,'index.html');
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
      const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);
    }catch{res.writeHead(404);res.end();}
  });
  return {listen:()=>new Promise((r,j)=>{app.on('error',j);app.listen(4187,'127.0.0.1',r);}),close:()=>{app.closeAllConnections();return new Promise(r=>app.close(r));}};
};
const server = staticMode ? staticServer() : await createServer({ ...(sourceArg ? { root: sourceArg, configFile: join(sourceArg, 'vite.config.ts') } : {}), server: { host: '127.0.0.1', port: 4187, strictPort: true } });
await server.listen();
console.log('Local synthetic server ready');
const profile = await mkdtemp(join(tmpdir(), 'clientes-lifecycle-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = ''; const timeout = setTimeout(() => reject(Error('Chrome timeout')), 20000);
    chrome.on('error', reject);
    chrome.stderr.on('data', b => { log += b; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  ws = new WebSocket(endpoint); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; setTimeout(() => j(Error('WebSocket timeout')), 15000).unref(); });
  let seq = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 45000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: err => { clearTimeout(timer); reject(err); } }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const c = (method, params = {}) => send(method, params, sessionId);
  await c('Page.enable'); await c('Runtime.enable'); await c('Network.enable');
  await c('Network.setBlockedURLs', { urls: ['*supabase.co/*', 'https://clients.invalid/*'] });
  if(staticMode){
    await c('Emulation.setTimezoneOverride',{timezoneId:'Asia/Tokyo'});
    const originalHandler=ws.onmessage;
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){
      const {request,requestId}=m.params;
      if(request.url.startsWith('https://fonts.googleapis.com/'))send('Fetch.fulfillRequest',{requestId,responseCode:200,body:''},m.sessionId);
      else if(!request.url.startsWith('http://127.0.0.1:4187/')||!['GET','HEAD'].includes(request.method))send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},m.sessionId);
      else send('Fetch.continueRequest',{requestId},m.sessionId);
    }else originalHandler(e);};
    await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  }
  const evaluate = async expression => { const r = await c('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timeout: ' + expression); }
  const prospectsMode = process.argv.includes('--prospects');
  const retirementMode = process.argv.includes('--retirement');
  const discardMode = process.argv.includes('--discard');
  function fixture(prospectsMode, retirementMode, discardMode) {
    const id = '00000000-0000-4000-8000-000000000001';
    const now = Math.floor(Date.now() / 1000), enc = o => btoa(JSON.stringify(o)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
    const user = { id, aud: 'authenticated', role: 'authenticated', email: 'clients@example.invalid', app_metadata: {}, user_metadata: {} };
    localStorage.setItem('sb-clients-auth-token', JSON.stringify({ access_token: enc({ alg: 'HS256' }) + '.' + enc({ sub: id, exp: now + 3600, role: 'authenticated' }) + '.synthetic', refresh_token: 'synthetic', expires_at: now + 3600, user }));
    localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token', localStorage.getItem('sb-clients-auth-token'));
    window.__role = new URLSearchParams(location.search).get('testRole') || 'ADMIN';
    const make = (id, first_name, status, statuses, installationStatus) => ({ id, first_name, last_name: 'Sintetico', document_number: 'DOC-' + id, document_type: 'cedula', status, created_at: '2026-10-01', phone: '555' + id, email: id + '@example.invalid',
      service_contracts: statuses.map((status, n) => ({ id: id + '-' + n, client_id: id, status, client_code: 'CODE-' + id, priority: 'medium' })),
      installations: installationStatus ? [{ id: 'inst-' + id, client_id: id, status: installationStatus, created_at: '2026-10-01' }] : [] });
    const clients = [make('retired', 'Retirado', 'retired', ['cancelled']), make('active', 'Activo', 'active', ['active']), make('suspended', 'Suspendido', 'suspended', ['suspended']), make('mixed', 'Mixto', 'retired', ['cancelled', 'active']), make('pending', 'Pendiente', 'retired', ['cancelled'], 'pending')];
    if (discardMode) {
      clients.push(make('unfulfilled', 'No instalado', 'prospect', ['cancelled'], 'cancelled'));
      for (const client of clients) client.updated_at = '2026-11-12T12:00:00Z';
      window.__discardPosts = []; window.__discardClients = clients;
    }
    if (retirementMode) {
      clients[1] = make('active', 'Activo', 'active', ['active', 'suspended']);
      for (const client of clients) { client.saldo_a_favor = 0; for (const [i, ct] of client.service_contracts.entries()) { ct.contract_number = 'TEST-' + client.id + '-' + i; ct.service_type = 'internet_combo'; ct.updated_at = '2026-10-01'; ct.monthly_fee = 50; } }
      window.__retirementState = clients; window.__retirementPosts = [];
    }
    if (prospectsMode) clients.push(make('no-service', 'Ficha prospecto', 'prospect', []));
    const prospect = { id: 'p-1', full_name: 'Prospecto Comercial', phone: '999111222', address: 'Dirección comercial', zone_id: 'zone-1', plan_interes_id: 'plan-1', canal_contacto: 'whatsapp', estado: 'interesado', created_at: '2026-10-01', proximo_seguimiento: null };
    const realFetch = window.fetch.bind(window); window.__calls = [];
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === location.origin && !url.pathname.startsWith('/api/')) return realFetch(input, init);
      const method = init.method ?? 'GET'; window.__calls.push({ path: url.pathname, search: url.search, method });
      if (discardMode && url.pathname.endsWith('/rpc/discard_unfulfilled_client_prospect') && method === 'POST') {
        const payload = JSON.parse(init.body); window.__discardPosts.push(payload);
        const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
        if (!['ADMIN','SUPERADMIN'].includes(window.__role)) return respond({ message: 'Sin permisos' }, 403);
        if (window.__discardConflict) return respond({ message: 'La ficha cambió. Actualice el listado.' }, 409);
        const client = clients.find(c => c.id === payload.p_client_id);
        client.status = 'retired'; client.prospect_discarded_at = '2026-11-12T18:00:00Z';
        client.prospect_discarded_by = id; client.prospect_discard_reason = payload.p_reason;
        return respond({ id: client.id, alreadyDiscarded: false, discardedAt: client.prospect_discarded_at });
      }
      if (retirementMode && /^\/api\/clients\/[^/]+\/retirement$/.test(url.pathname)) {
        const client = clients.find(c => c.id === url.pathname.split('/')[3]);
        const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
        if (!['ADMIN', 'SUPERADMIN'].includes(window.__role)) return respond({ error: 'Sin permisos' }, 403);
        if (method === 'GET') {
          if (window.__retirementDisabled) return respond({ error: 'La baja transaccional todavía no está habilitada en este entorno.' }, 503);
          return respond({ clientId: client.id, name: client.first_name + ' ' + client.last_name, status: client.status, token: 'a'.repeat(32),
            contracts: client.service_contracts.map(ct => ({ ...ct, number: ct.contract_number, code: ct.client_code, serviceType: ct.service_type, pppoeLinked: true, ontLinked: true, iptvLinked: false })),
            openInstallations: window.__retirementOrders ? [{ id: 'open-order', status: 'scheduled', contractId: client.service_contracts[0].id }] : [], linkedEquipmentCount: 1, networkReviewRequired: true });
        }
        if (method === 'POST') {
          const body = JSON.parse(init.body); window.__retirementPosts.push(body);
          if (window.__retirementStale) return respond({ error: 'La ficha cambió; actualiza la vista previa.' }, 409);
          if (window.__retirementOrders) return respond({ error: 'Hay Altas abiertas.' }, 409);
          if (body.confirmAllContracts !== true) return respond({ error: 'Falta confirmar.' }, 400);
          const affected = client.service_contracts.filter(ct => ct.status !== 'cancelled').map(ct => ct.id);
          for (const ct of client.service_contracts) ct.status = 'cancelled'; client.status = 'retired';
          return respond({ clientId: client.id, status: 'retired', cancelledContractIds: affected, cancelledCount: affected.length, networkReviewRequired: true, operationalNetworkActionsExecuted: false });
        }
      }
      if (!['GET', 'HEAD'].includes(method)) throw Error('Blocked write: ' + method);
      let data = []; const table = url.pathname.split('/').at(-1);
      if (table === 'user') data = user;
      if (table === 'company_settings') data = {id:1,lunes_hora_ingreso:'07:30:00',resto_hora_ingreso:'08:00:00',tolerancia_minutos:10};
      if (table === 'asistencia_registros') data = null;
      if (table === 'profiles') data = { id, role: window.__role, must_change_password: false };
      if (table === 'clients') data = window.__failClients ? null : clients;
      if (table === 'service_contracts') data = clients.flatMap(c => c.service_contracts);
      if (retirementMode && table === 'service_contracts' && url.searchParams.has('client_id')) data = data.filter(ct => ct.client_id === url.searchParams.get('client_id').replace(/^eq\./, ''));
      if (table === 'installations') data = clients.flatMap(c => c.installations);
      if (table === 'prospects') data = [prospect];
      if (table === 'prospect_followups') data = [{ id: 'f-1', prospect_id: 'p-1', notas: 'Historial conservado', fecha: '2026-10-01', profiles: { full_name: 'Operador simulado' } }];
      if (prospectsMode && table === 'plans') data = [{ id: 'plan-1', name: 'Plan comercial', price: 70 }];
      if (prospectsMode && table === 'zones') data = [{ id: 'zone-1', name: 'Zona comercial' }];
      // Simula un servidor que entrega sólo dos filas por página.
      if (Array.isArray(data)) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
        const from = Number(url.searchParams.get('offset') || headers.get('range')?.split('-')[0] || 0);
        data = data.slice(from, from + 2);
      }
      if (table === 'clients' && window.__failClients) return new Response(JSON.stringify({ message: 'Synthetic read failure' }), { status: 500 });
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '0-1/*' } });
    };
  }
  await c('Page.addScriptToEvaluateOnNewDocument', { source: '(' + fixture.toString() + ')(' + JSON.stringify(prospectsMode) + ',' + JSON.stringify(retirementMode) + ',' + JSON.stringify(discardMode) + ');' });
  const navigate = async (role = 'ADMIN') => { await c('Page.navigate', { url: 'http://127.0.0.1:4187/clientes?testRole=' + role }); await until(discardMode ? 'document.body?.textContent.includes("1 no instalados")' : 'document.body?.textContent.includes("4 abonados vigentes · 1 retirados")'); };
  const click = async label => {
    const button = `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))`;
    await until(button + '!==undefined');await evaluate(button + '.click()');
    await evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  };
  const names = () => evaluate('Array.from(document.querySelectorAll("tbody tr")).map(r => r.textContent)');
  await navigate();
  console.log('Synthetic client list loaded');
  if (discardMode) {
    const dialogClick = label => evaluate(`Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
    const inputReason = value => evaluate(`{const el=document.querySelector('[role=dialog] textarea');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    const disabled = () => evaluate('document.querySelector("[role=dialog] .btn-primary").disabled');
    await click('Pendientes de instalación');await until('document.querySelector("tbody")?.textContent.includes("Pendiente Sintetico")');assert.ok((await names()).some(n=>n.includes('Pendiente')));
    assert.equal(await evaluate('Array.from(document.querySelectorAll("tbody button")).some(b=>b.textContent.trim()==="Descartar")'),false);
    await click('No instalados');await click('Descartar');assert.equal(await disabled(),true);
    const output='docs/dashboard-support-prospects-local';await mkdir(output,{recursive:true});
    const capture=async(name,width,height)=>{await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});await new Promise(r=>setTimeout(r,300));const img=await c('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name+'.png'),Buffer.from(img.data,'base64'));};
    await inputReason('No se concretó');assert.equal(await disabled(),true);
    await capture('discard-desktop',1440,1000);await capture('discard-mobile',390,844);
    await dialogClick('Cancelar');assert.equal(await evaluate('window.__discardPosts.length'),0);
    await click('Descartar');await inputReason('No se concretó');await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").click()');
    assert.equal(await disabled(),false);
    await evaluate('window.__discardConflict=true');await dialogClick('Confirmar descarte');await until('document.querySelector("[role=alert]")?.textContent.includes("La ficha cambió")');assert.equal(await disabled(),true);
    await dialogClick('Cancelar');await evaluate('window.__discardConflict=false');await click('Descartar');await inputReason('No se concretó');await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").click()');
    const originalRelations=await evaluate('JSON.stringify(window.__discardClients.map(c=>({contracts:c.service_contracts,installations:c.installations})))');
    await evaluate('{const b=document.querySelector("[role=dialog] .btn-primary");b.click();b.click();}');await until('document.querySelector("[role=dialog]")?.textContent.includes("Descarte confirmado")');
    assert.equal(await evaluate('window.__discardPosts.length'),2,'Un conflicto y un éxito; doble clic no duplica');
    assert.deepEqual(await evaluate('window.__discardPosts[1]'),{p_client_id:'unfulfilled',p_expected_updated_at:'2026-11-12T12:00:00Z',p_reason:'No se concretó',p_confirm:true});
    assert.equal(await evaluate('JSON.stringify(window.__discardClients.map(c=>({contracts:c.service_contracts,installations:c.installations})))'),originalRelations);
    await dialogClick('Cerrar');await until('document.body.textContent.includes("Ver descarte")');
    assert.match((await names()).join(' '),/No concretado \/ Descartado/);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("tbody button")).some(b=>["Descartar","Eliminar"].includes(b.textContent.trim()))'),false);
    await click('Ver descarte');assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'),/No se concretó/);assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'),/12\/11\/2026, (13:00:00|1:00:00 p\. m\.)/);
    await dialogClick('Cerrar');
    for (const role of ['SOPORTE','FACTURACION']) { await navigate(role);await click('No instalados');assert.equal(await evaluate('Array.from(document.querySelectorAll("tbody button")).some(b=>b.textContent.trim()==="Descartar")'),false); }
    await c('Page.navigate',{url:'http://127.0.0.1:4187/clientes?testRole=TECNICO_RED'});await until('location.pathname.startsWith("/campo")');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Descartar")'),false);
    await navigate('SUPERADMIN');await click('No instalados');await click('Descartar');await dialogClick('Cancelar');
    assert.equal(await evaluate('window.__calls.filter(c=>!["GET","HEAD"].includes(c.method)&&!c.path.endsWith("/rpc/discard_unfulfilled_client_prospect")).length'),0);
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
    await writeFile(join(output,'discard-ui-verification.json'),JSON.stringify({status:'PASS',staticBuild:staticMode,productionAccess:false,realWrites:0,checks:['PENDING_INSTALLATION_CANNOT_BE_DISCARDED','REASON_AND_CONFIRMATION_REQUIRED','CANCEL_WITHOUT_RPC','CONFLICT_REQUIRES_REFRESH','DOUBLE_CLICK_ONE_SUCCESS','RELATIONS_UNCHANGED','HISTORY_PRESERVED_AND_VISIBLE','PERU_TIME','ADMIN_SUPERADMIN_ONLY','DESKTOP_MOBILE_DIALOG'],exceptions},null,2)+'\n');
    console.log('PASS: descarte UI real; confirmación y motivo; cancelar sin RPC; conflicto bloqueado; doble clic; ficha e historial conservados; contratos/órdenes intactos; ADMIN/SUPERADMIN; cero escrituras reales.');
  } else if (retirementMode) {
    const editActive = () => evaluate(`Array.from(document.querySelectorAll('tbody tr')).find(r => r.textContent.includes('Activo Sintetico')).querySelectorAll('button')[1].click()`);
    const selectRetired = () => evaluate(`{ const select = Array.from(document.querySelectorAll('select')).find(s => s.querySelector('option[value="retired"]')); select.value = 'retired'; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
    const dialogClick = label => evaluate(`Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
    const ready = () => until('document.querySelector("[role=dialog]")?.textContent.includes("TEST-active-1")');
    const posts = () => evaluate('window.__retirementPosts.length');
    await editActive(); await selectRetired(); await ready();
    assert.ok(await evaluate('document.querySelector("[role=dialog]").textContent.includes("2 contratos vigentes")'));
    assert.equal(await evaluate('Array.from(document.querySelector("[role=dialog]").querySelectorAll("button")).find(b=>b.textContent.includes("Confirmar baja")).disabled'), true);
    await dialogClick('Cancelar'); assert.equal(await posts(), 0);
    await evaluate('window.__retirementOrders = true'); await selectRetired(); await ready();
    assert.ok(await evaluate('document.querySelector("[role=dialog]").textContent.includes("Baja bloqueada")'));
    assert.equal(await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").disabled'), true);
    await dialogClick('Cancelar'); assert.equal(await posts(), 0);
    await evaluate('window.__retirementOrders = false; window.__retirementDisabled = true'); await selectRetired();
    await until('document.querySelector("[role=dialog]")?.textContent.includes("todavía no está habilitada")');
    await dialogClick('Cancelar'); assert.equal(await posts(), 0);
    await evaluate('window.__retirementDisabled = false; window.__retirementStale = true'); await selectRetired(); await ready();
    await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").click()'); await dialogClick('Confirmar baja definitiva');
    await until('document.querySelector("[role=dialog]")?.textContent.includes("La ficha cambió")'); assert.equal(await posts(), 1);
    await dialogClick('Cancelar');
    await evaluate('window.__retirementStale = false; Array.from(document.querySelectorAll(".modal-overlay form button")).find(b=>b.textContent.trim()==="Cancelar").click()');
    await evaluate(`Array.from(document.querySelectorAll('tbody tr')).find(r => r.textContent.includes('Activo Sintetico')).querySelector('button').click()`);
    await until('location.pathname === "/clientes/active" && !!document.querySelector("select")');
    await selectRetired(); await ready();
    await evaluate(`document.querySelector('[role=dialog] input[type=checkbox]').click()`);
    await evaluate(`{ const button = Array.from(document.querySelector('[role=dialog]').querySelectorAll('button')).find(b=>b.textContent.includes('Confirmar baja')); button.click(); button.click(); }`);
    await until('document.querySelector("[role=dialog]")?.textContent.includes("Baja comercial confirmada")');
    assert.equal(await posts(), 2, 'Doble clic no duplica la baja');
    assert.deepEqual(await evaluate('window.__retirementPosts[1].affectedContractIds'), ['active-0', 'active-1']);
    assert.ok(await evaluate('window.__retirementState.find(c=>c.id==="active").status === "retired" && window.__retirementState.find(c=>c.id==="active").service_contracts.every(s=>s.status==="cancelled")'));
    assert.equal(await evaluate('window.__calls.filter(c=>!["GET","HEAD"].includes(c.method) && !c.path.endsWith("/retirement")).length'), 0);
    await dialogClick('Cerrar');
    await navigate('SOPORTE'); await editActive();
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('select')).find(s=>s.querySelector('option[value="retired"]')).querySelector('option[value="retired"]').disabled`), true);
    await selectRetired(); assert.equal(await evaluate('!!document.querySelector("[role=dialog]")'), false);
    assert.equal(await posts(), 0);
    await navigate('SUPERADMIN'); await editActive(); await selectRetired(); await ready(); await dialogClick('Cancelar');
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    console.log('PASS: baja desde lista y ficha; cancelación sin POST; 2 contratos explícitos; Altas abiertas/SQL ausente bloquean; preview obsoleta; doble clic; roles; cero acciones de red o escrituras fuera del endpoint simulado.');
  } else if (prospectsMode) {
    const setInput = (selector, value) => evaluate(`{ const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); }`);
    const prospectLinks = () => evaluate(`Array.from(document.querySelectorAll('a[href="/clientes/prospectos"]')).filter(a => a.textContent.includes('Prospectos')).length`);
    assert.equal(await prospectLinks(), 1);
    assert.equal((await names()).length, 5);
    assert.ok(await evaluate('document.body.textContent.includes("1 fichas sin servicio vigente")'));
    await click('Clientes retirados'); assert.equal(await prospectLinks(), 1);
    await evaluate(`document.querySelector('a[href="/clientes/prospectos"]').click()`);
    await until('document.querySelector("h1")?.textContent === "Prospectos"');
    await until('document.body.textContent.includes("Prospecto Comercial")');
    // Espías en memoria: se ejercitan los formularios reales, sin persistencia
    // ni escrituras HTTP (incluso las simuladas permanecen bloqueadas).
    await evaluate(`(async () => {
      window.__actions = [];
      const { useProspectsStore } = await import('/src/stores/prospects.ts');
      const store = useProspectsStore();
      store.createProspect = async payload => { window.__actions.push({ action: 'prospect', payload }); const p = { ...payload, id: 'p-local', created_at: '2026-10-23' }; store.prospects.push(p); return p; };
      store.addFollowup = async (id, notas) => { window.__actions.push({ action: 'followup', id, notas }); return { id: 'f-local', prospect_id: id, notas, fecha: '2026-10-23' }; };
    })()`);
    await click('+ Nuevo prospecto');
    await setInput('input[placeholder="Nombre completo"]', 'Registro simulado');
    await setInput('input[placeholder="Celular / WhatsApp"]', '988777666');
    await click('Guardar');
    await until('!document.querySelector(".modal-overlay")');
    assert.equal(await evaluate('window.__actions[0].payload.full_name'), 'Registro simulado');
    await setInput('input[placeholder="Buscar por nombre o celular..."]', 'Prospecto Comercial');
    assert.equal((await names()).length, 1);
    await evaluate(`{ const select = document.querySelector('select'); select.value = 'convertido'; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
    assert.ok(!(await names()).some(s => s.includes('Prospecto Comercial')));
    await evaluate(`{ const select = document.querySelector('select'); select.value = 'interesado'; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
    await click('Seguimientos');
    await until('document.body.textContent.includes("Historial conservado")');
    await setInput('input[placeholder="Nueva nota de seguimiento..."]', 'Seguimiento simulado');
    await click('Agregar');
    await until('document.querySelector(".modal-overlay ul")?.textContent.includes("Seguimiento simulado")');
    await click('Cerrar');
    await click('Convertir en cliente');
    await until('document.querySelector(".modal-overlay")?.textContent.includes("Convirtiendo el prospecto")');
    assert.ok(await evaluate('document.querySelector(".modal-overlay").textContent.includes("Plan comercial") && document.querySelector(".modal-overlay").textContent.includes("Zona comercial")'));
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".modal-overlay input[required]")).map(i => i.value)'), ['', 'Prospecto', 'Comercial', 'Dirección comercial']);
    await click('Cancelar');
    assert.equal(await evaluate('window.__actions.length'), 2, 'Cancelar no convierte ni crea un cliente');
    assert.equal(await prospectLinks(), 1);
    await evaluate(`document.querySelector('a[href="/clientes/prospectos"]').click()`);
    await until('document.body.textContent.includes("Prospecto Comercial")');
    await click('Convertir en cliente');
    await until('document.querySelector(".modal-overlay")?.textContent.includes("Convirtiendo el prospecto")');
    await evaluate(`(async () => {
      const { useClientsStore } = await import('/src/stores/clients.ts');
      const { useContractsStore } = await import('/src/stores/contracts.ts');
      const { useInstallationsStore } = await import('/src/stores/installations.ts');
      const { useProspectsStore } = await import('/src/stores/prospects.ts');
      useClientsStore().createClient = async payload => { window.__actions.push({ action: 'client', payload }); return { ...payload, id: 'client-local' }; };
      useContractsStore().createContract = async payload => { window.__actions.push({ action: 'contract', payload }); return { ...payload, id: 'contract-local' }; };
      useInstallationsStore().createInstallation = async payload => { window.__actions.push({ action: 'installation', payload }); return { ...payload, id: 'installation-local' }; };
      useProspectsStore().markConverted = async (id, clientId) => { window.__actions.push({ action: 'converted', id, clientId }); };
      const { default: router } = await import('/src/router/index.ts');
      router.beforeEach(to => { if (to.path === '/clientes/client-local') { window.__conversionTarget = to.path; return false; } });
    })()`);
    await setInput('.modal-overlay input[required]', 'DOC-NUEVO');
    await click('Guardar');
    await until('window.__conversionTarget === "/clientes/client-local"');
    const actions = await evaluate('JSON.parse(JSON.stringify(window.__actions))');
    assert.deepEqual(actions.map(a => a.action), ['prospect', 'followup', 'client', 'contract', 'installation', 'converted']);
    assert.deepEqual(actions[3].payload, { client_id: 'client-local', plan_id: 'plan-1', monthly_fee: 70, installation_address: 'Dirección comercial', zone_id: 'zone-1' });
    assert.deepEqual(actions[4].payload, { client_id: 'client-local', contract_id: 'contract-local', points: 10 });
    assert.deepEqual(actions[5], { action: 'converted', id: 'p-1', clientId: 'client-local' });
    assert.equal(await evaluate('window.__calls.filter(c => !["GET", "HEAD"].includes(c.method)).length'), 0);
    for (const role of ['SUPERADMIN', 'SOPORTE', 'FACTURACION']) { await navigate(role); assert.equal(await prospectLinks(), 1); }
    assert.equal(await evaluate('window.__calls.filter(c => !["GET", "HEAD"].includes(c.method)).length'), 0);
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    console.log('PASS: Prospectos único y funcional en ambas secciones; registro, búsqueda, filtro, seguimiento, cancelación y conversión simulada ordenada; plan/zona/tarifa conservados; prospecto sin servicio excluido de abonados; permisos de staff preservados; cero escrituras HTTP.');
  } else {
  assert.equal((await names()).length, 4);
  assert.ok(!(await names()).some(s => s.includes('Retirado Sintetico')));
  await click('Con múltiples servicios'); assert.match((await names()).join(' '), /Mixto/);
  await click('Suspendidos'); assert.match((await names()).join(' '), /Suspendido/);
  await click('Pendientes de instalación'); assert.match((await names()).join(' '), /Pendiente/);
  await click('Todos'); await click('Clientes retirados');
  assert.match((await names()).join(' '), /Retirado/);
  await evaluate(`{ const input = document.querySelector('input[placeholder^="Buscar por nombre"]'); input.value = 'DOC-retired'; input.dispatchEvent(new Event('input', { bubbles: true })); }`);
  assert.equal((await names()).length, 1);
  await click('Reincorporar');
  assert.match(await evaluate('document.querySelector("[role=dialog]").textContent'), /DOC-retired/);
  assert.equal(await evaluate('document.querySelector("[role=dialog] a").getAttribute("href")'), '/clientes/retired');
  await click('Cerrar');
  await click('+ Nuevo cliente');
  await evaluate(`{ const input = document.querySelector('.modal-overlay input[required]'); input.value = 'DOC-retired'; input.dispatchEvent(new Event('input', { bubbles: true })); }`);
  await until('document.querySelector(".modal-overlay").textContent.includes("Ya existe un cliente")');
  await evaluate('document.querySelector(".modal-overlay form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))');
  await until('document.querySelector(".modal-overlay").textContent.includes("Ya existe un cliente con ese documento")');
  assert.equal(await evaluate('window.__calls.filter(c => !["GET", "HEAD"].includes(c.method)).length'), 0);
  assert.ok(await evaluate('window.__calls.some(c => c.path.endsWith("/clients") && c.search.includes("offset=4"))'));
  assert.deepEqual(await evaluate(`(async () => { const { useDashboardStore } = await import('/src/stores/dashboard.ts'); const store = useDashboardStore(); await store.fetchSummary(); return JSON.parse(JSON.stringify(store.summary?.clients)); })()`), { active: 2, suspended: 1, prospect: 1, retired: 1 });
  for (const role of ['SUPERADMIN', 'SOPORTE', 'FACTURACION']) {
    console.log('Checking role:', role);
    await navigate(role); await click('Clientes retirados');
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "Reincorporar")'), role === 'SUPERADMIN');
    assert.equal(await evaluate('window.__calls.filter(c => !["GET", "HEAD"].includes(c.method)).length'), 0);
  }
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('PASS: UI real; 4 vigentes/1 retirado; filtros; búsqueda; reincorporación sin escrituras; documento duplicado; roles ADMIN/SUPERADMIN; paginación con límite 2.');
  }
} finally {
  ws?.close(); chrome.kill(); await server.close();
}
