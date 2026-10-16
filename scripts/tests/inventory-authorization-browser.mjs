// Autorización local por roles sintéticos; no acredita RLS Cloud ni usa red externa.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'inventory-authorization-'));
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
  ws = new WebSocket(endpoint); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const c = (method, params = {}) => send(method, params, sessionId);
  await c('Page.enable'); await c('Runtime.enable'); await c('Network.enable');
  await c('Network.setBlockedURLs', { urls: ['*supabase.co/*', 'https://inventory.invalid/*'] });
  const evaluate = async expression => { const r = await c('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  async function until(expression) { for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timeout: ' + expression); }
  function fixture(role) {
    // Preparar ambos almacenes en el perfil desechable para montar Campo sin escrituras de negocio.
    const storage = indexedDB.open('smartrayco-campo', 1);
    storage.onupgradeneeded = () => { for (const name of ['closures','drafts']) if (!storage.result.objectStoreNames.contains(name)) storage.result.createObjectStore(name); };
    storage.onsuccess = () => storage.result.close();
    const id = '00000000-0000-4000-8000-000000000001';
    const now = Math.floor(Date.now()/1000), enc = o => btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
    localStorage.clear();
    if (role !== 'ANON') {
      const user = { id, aud:'authenticated', role:'authenticated', email:'authorization@example.invalid', app_metadata:{}, user_metadata:{} };
      localStorage.setItem('sb-inventory-auth-token', JSON.stringify({access_token:enc({alg:'HS256'})+'.'+enc({sub:id,exp:now+3600,role:'authenticated'})+'.synthetic',refresh_token:'synthetic',expires_at:now+3600,user}));
    }
    const realFetch = window.fetch.bind(window); window.__calls=[];
    window.fetch = async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin&&!url.pathname.startsWith('/api/')) return realFetch(input,init);
      const method=init.method??'GET';window.__calls.push({path:url.pathname,method});
      if(!['GET','HEAD'].includes(method)&&url.pathname!=='/rest/v1/rpc/inventory_get_albums') throw Error('Escritura bloqueada en prueba');
      if(url.pathname.startsWith('/api/')) return new Response(JSON.stringify({error:'Servicio no disponible en fixture de permisos'}),{status:503,headers:{'Content-Type':'application/json'}});
      const table=url.pathname.split('/').at(-1);let data=[];
      if(table==='profiles') data=url.searchParams.has('id')?{id,role,active:true,must_change_password:false}:[];
      if(table==='inventory_categories') data=[{id:'album-1',slug:'onu',name:'ONUs',is_active:true}];
      if(table==='inventory_products'&&url.searchParams.has('id')) data={id:'product-1',name:'Producto sintético',is_serialized:false,current_stock:0,min_stock:0,price:0,inventory_categories:null};
      if(table==='inventory_products'&&url.searchParams.has('or')) data=[{id:'product-1',name:'Producto autorizado',is_serialized:false,current_stock:0,min_stock:0,price:0,inventory_categories:null}];
      return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    };
  }
  const routes=['/inventario','/inventario/album/onu','/inventario/product-1','/inventario/devoluciones','/inventario/activos-fijos'];
  for(const role of ['ADMIN','SUPERADMIN','SOPORTE','FACTURACION','TECNICO_RED','ANON']) {
    const {identifier}=await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')('+JSON.stringify(role)+');'});
    const allowed=['ADMIN','SUPERADMIN'].includes(role);
    for(const path of routes) {
      await c('Page.navigate',{url:'http://127.0.0.1:4179'+path});
      await until(allowed
        ? 'location.pathname==='+JSON.stringify(path)+' && !!document.querySelector("h1")'
        : '!location.pathname.startsWith("/inventario") && !!document.body?.textContent.trim()');
      const data=await evaluate('({path:location.pathname,menu:!!document.querySelector(\'a[href="/inventario"]\'),calls:window.__calls})');
      assert.equal(data.path.startsWith('/inventario'),allowed,role+' '+path);
      if(role!=='ANON') assert.equal(data.menu,allowed,'Menú '+role+' '+path);
      if(!allowed) assert.equal(data.calls.some(r=>/inventory_(products|units|categories|get_albums)/.test(r.path)),false,'Consulta administrativa no autorizada: '+role);
    }
    // Solo autorización de ruta de Campo; no acciona materiales ni equipos.
    if(allowed) {
      await c('Page.navigate',{url:'http://127.0.0.1:4179/inventario?q=permiso'});
      await until('document.body?.textContent.includes("Producto autorizado")');
      const before=await evaluate('window.__calls.length');
      await evaluate('(async()=>{const {useAuthStore}=await import("/src/stores/auth.ts");useAuthStore().role="SOPORTE";})()');
      await until('!document.body?.textContent.includes("Producto autorizado") && !document.querySelector(\'a[href="/inventario"]\')');
      await until('document.body?.textContent.includes("Solo Administración")');
      assert.equal(await evaluate('window.__calls.length'),before,'La revocación del rol no debe consultar datos');
    }
    if(role==='TECNICO_RED') {
      await c('Page.navigate',{url:'http://127.0.0.1:4179/campo/routine/00000000-0000-4000-8000-000000000001'});
      await until('location.pathname.startsWith("/campo/routine/") && !!document.body?.textContent.trim()');
      assert.equal(await evaluate('location.pathname.startsWith("/campo/routine/")'),true);
    }
    await c('Page.removeScriptToEvaluateOnNewDocument',{identifier});
    console.log('PASS autorización rutas/menú: '+role);
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions.map(e => e.exceptionDetails?.exception?.description?.split('\n')[0])));
  console.log('PASS: 30 combinaciones ruta/rol; sin consultas administrativas denegadas; Campo accesible para técnico; sin escrituras ni acceso Cloud.');
  await send('Browser.close');
} finally {ws?.close();chrome.kill();}
