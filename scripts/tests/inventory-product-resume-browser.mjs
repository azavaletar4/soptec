// Run against local Vite preview on 127.0.0.1:5184. Browser-only fixtures;
// Supabase/backend network is blocked and no business RPC is executed.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const baseline=process.argv.includes('--baseline');
const origin=process.env.PRODUCT_TEST_ORIGIN||'http://127.0.0.1:'+(baseline?'5185':'5184');
const profile=await mkdtemp(join(tmpdir(),'inventory-reconciliation-browser-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
 '--remote-debugging-port=0',
 '--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws; let seq=0; const pending=new Map();const errors=[];
try {
 const endpoint=await new Promise((resolve,reject)=>{
  let log='';const timeout=setTimeout(()=>reject(Error('CHROME_START_TIMEOUT')),20000);
  chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});
  chrome.on('error',reject);
 });
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);};
 function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});}
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Network.setBlockedURLs',{urls:['*supabase.co/*','*/api/*']});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression:expression.includes('await ')&&!expression.startsWith('(async')?'(async()=>{'+expression+'})()':expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 async function until(expression){for(let i=0;i<60;i++){const v=await evaluate(expression);if(v)return v;await new Promise(r=>setTimeout(r,250));}console.log(JSON.stringify(await evaluate('({text:document.body.innerText,requests:window.__inventoryRequests})')));console.log(JSON.stringify(errors));throw Error('UI_ASSERTION_TIMEOUT');}
 const fixture=()=>{
  const uid='00000000-0000-4000-8000-000000000171';
  const now=Math.floor(Date.now()/1000),encode=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  const user={id:uid,aud:'authenticated',role:'authenticated',email:'inventory-ui@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:now+3600,user}));
  const cats=[{id:'cat-ont',slug:'onu',name:'ONUs / ONTs',icon:'📦',color:'sky',is_active:true},{id:'cat-tv',slug:'tvbox',name:'TV Box',icon:'📺',color:'violet',is_active:true}];
  const product={id:'product-ont',name:'ONT modelo de prueba',category_id:'cat-ont',category:'onu',is_serialized:true,is_active:true,unit:'unidad',price:100,current_stock:0,min_stock:1,inventory_categories:cats[0]};
  const tv={...product,id:'product-tv',name:'TV Box de prueba',category_id:'cat-tv',inventory_categories:cats[1]};
  const client={id:'client-ui',first_name:'Ana',last_name:'Prueba'};
  const contract={id:'contract-ui',client_id:client.id,contract_number:'CONTRATO-PRUEBA'};
  const base={product_id:product.id,product,client_id:null,clients:null,contract_id:null,contract:null,installation_id:null,custody_technician_id:null,technician:null,mac_address:null};
  const units=[
   {...base,id:'unit-match',serial_number:'SER-MATCH',status:'in_stock'},
   {...base,id:'unit-assigned',serial_number:'SER-ASIGNADA',status:'assigned',client_id:client.id,clients:client,contract_id:contract.id,contract,installation_id:'order-ui'},
   {...base,id:'unit-custody',serial_number:'SER-CUSTODIA',status:'with_technician',custody_technician_id:'tech-ui',technician:{id:'tech-ui',full_name:'Técnico Prueba',email:null},custody_profile:{id:'tech-ui',full_name:'Técnico Prueba',email:null}},
   {...base,id:'unit-tv',serial_number:null,mac_address:'AA:BB:CC:DD:EE:01',status:'in_stock',product:tv,product_id:tv.id},
  ];
  const realFetch=window.fetch.bind(window);window.__inventoryRequests=[];
  window.fetch=async(input,init={})=>{
   const u=new URL(typeof input==='string'?input:input.url,location.href);
   if(!u.hostname.endsWith('.supabase.co')&&!u.pathname.startsWith('/api/'))return realFetch(input,init);
   const method=init.method||(input instanceof Request?input.method:'GET');window.__inventoryRequests.push({path:u.pathname,method});
   const headers={'Content-Type':'application/json','Content-Range':'0-3/4'};
   if(!['GET','HEAD'].includes(method)&&!['inventory_get_albums','inventory_custody_summary'].includes(u.pathname.split('/').at(-1)))return new Response(JSON.stringify({message:'WRITE_BLOCKED'}),{status:403,headers});
   const table=u.pathname.split('/').at(-1);let data=[];
   if(table==='profiles'&&!u.searchParams.has('id'))data=[{id:'tech-ui',role:'TECNICO_RED',active:true,full_name:'Tecnico Prueba'}];
   if(table==='profiles'&&u.searchParams.has('id'))data={id:uid,role:'ADMIN',must_change_password:false,full_name:'Administración de prueba'};
   if(table==='user')data=user;
   if(table==='inventory_categories')data=cats;
   if(table==='inventory_get_albums')data=[{album_slug:'onu',album_name:'ONUs / ONTs',icon:'📦',color:'sky',item_count:1,low_stock:0,total_value:100},{album_slug:'tvbox',album_name:'TV Box',icon:'📺',color:'violet',item_count:1,low_stock:0,total_value:100},{album_slug:'por_recoger',album_name:'Por recoger',icon:'↩',color:'rose',item_count:0,low_stock:0,total_value:0},{album_slug:'averiados',album_name:'Averiados',icon:'⚒',color:'amber',item_count:0,low_stock:0,total_value:0}];
   if(table==='inventory_products'&&u.searchParams.has('id')) {
    if(window.__productDelay)await new Promise(r=>{window.__releaseProduct=r;});
    if(window.__productFail)return new Response(JSON.stringify({message:'TEMPORARY_FAILURE'}),{status:503,headers});
    if(u.searchParams.get('id')==='eq.missing')return new Response('null',{status:200,headers});
   }
   if(table==='inventory_products')data=u.searchParams.has('id')?([product,tv].find(p=>'eq.'+p.id===u.searchParams.get('id'))):[product,tv].filter(p=>!u.searchParams.has('category_id')||'eq.'+p.category_id===u.searchParams.get('category_id'));
   if(table==='inventory_units')data=units.filter(x=>(!u.searchParams.has('product_id')||'eq.'+x.product_id===u.searchParams.get('product_id')||u.searchParams.get('product_id').startsWith('in.'))&&(!u.searchParams.has('status')||'eq.'+x.status===u.searchParams.get('status')||u.searchParams.get('status').startsWith('in.')&&u.searchParams.get('status').includes(x.status)));
   if(table==='installations')data=[{id:'order-ui',client_id:client.id,contract_id:contract.id,status:'completed'}];
   if(table==='work_order_closures'){
    if(window.__denyClosures)return new Response(JSON.stringify({message:'READ_DENIED_FIXTURE'}),{status:403,headers});
    data=[{id:'closure-ui',job_id:'order-ui',client_id:client.id,ont_serial:'SER-MATCH',created_at:'2026-10-17T20:00:00Z'}];
   }
   if(table==='inventory_unit_events')data=[{id:'event-ui',unit_id:'unit-match',from_status:null,to_status:'in_stock',created_at:'2026-10-17T20:00:00Z',author:{id:uid,full_name:'Administración de prueba'}}];
   if(Array.isArray(data))headers['Content-Range']=data.length?'0-'+(data.length-1)+'/'+data.length:'*/0';
   return new Response(JSON.stringify(data),{status:200,headers});
  };
 };
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')();'});
 const body=()=>evaluate('document.body.innerText');
 const click=async text=>evaluate('(()=>{const x=Array.from(document.querySelectorAll("a,button,[role=button]")).find(x=>x.textContent.trim().includes('+JSON.stringify(text)+'));if(!x)return false;x.click();return true;})()');
 const field=async(label,value)=>evaluate('(()=>{const l=Array.from(document.querySelectorAll("label")).find(l=>l.textContent.includes('+JSON.stringify(label)+'));const x=l?.querySelector("input,select");if(!x)return false;x.value='+JSON.stringify(value)+';x.dispatchEvent(new Event(x.tagName==="SELECT"?"change":"input",{bubbles:true}));return true;})()');
 const noWrites=async()=>{const calls=await evaluate('window.__inventoryRequests');assert(!calls.some(r=>!['GET','HEAD'].includes(r.method)&&!['inventory_get_albums','inventory_custody_summary'].includes(r.path.split('/').at(-1))));};

 const go=async path=>{await c('Page.navigate',{url:origin+path});await until('window.__inventoryRequests?.some(r=>r.path.endsWith("/inventory_products")) && !!document.querySelector("h1")');await evaluate('window.__auth=(await import("/src/stores/auth.ts")).useAuthStore();window.__inv=(await import("/src/stores/inventory.ts")).useInventoryStore();');};
 const text=()=>evaluate('document.body.innerText');
 const hasProduct='document.querySelector("h1")?.textContent.includes("ONT modelo de prueba")';
 await go('/inventario/product-ont?unit=unit-match&returnTo=%2Finventario%2Falbum%2Fonu');
 await until(hasProduct);await until('document.body.innerText.includes("Historial del equipo")');await click('Cerrar');
 await evaluate('window.__auth=(await import("/src/stores/auth.ts")).useAuthStore();window.__inv=(await import("/src/stores/inventory.ts")).useInventoryStore();');
 await evaluate('window.__auth.user={...window.__auth.user}');
 await new Promise(r=>setTimeout(r,300));
 if(baseline){assert((await text()).includes('Producto no encontrado'));assert.equal(await evaluate('window.__inv.products.length'),0);console.log('BASELINE_ROOT_CAUSE_REPRODUCED=SAME_ACTOR_SESSION_REFRESH_CLEARS_CATALOG_AND_BLANKS_DETAIL');await send('Browser.close');}
 else {
 assert(await evaluate(hasProduct));assert.equal(await evaluate('window.__inv.products.length'),1);
 const {targetId:other}=await send('Target.createTarget',{url:'about:blank'});
 for(let n=0;n<4;n++){await send('Target.activateTarget',{targetId:other});await new Promise(r=>setTimeout(r,150));await evaluate('window.__auth.user={...window.__auth.user}');await send('Target.activateTarget',{targetId});assert(await evaluate(hasProduct));}
 console.log('SAME_ACTOR_REFRESH_AND_TAB_SWITCHES=PASS');
 await go('/inventario/product-ont');await until(hasProduct);assert((await evaluate('location.pathname')).endsWith('/product-ont'));
 // Initial pending and temporary failure must never mean nonexistent.
 await evaluate('window.__productDelay=true;window.__inv.products=[];window.__auth.role=null;window.__auth.role="ADMIN";');
 await until('typeof window.__releaseProduct==="function"');assert((await text()).includes('Cargando datos del producto'));assert(!(await text()).includes('Producto no encontrado'));
 await evaluate('window.__productFail=true;window.__productDelay=false;window.__releaseProduct()');await until('document.body.innerText.includes("Reintentar")');assert(!(await text()).includes('Producto no encontrado'));
 await evaluate('window.__productFail=false');await click('Reintentar');await until(hasProduct);
 // A filtered album response cannot turn a cached miss into a server 404.
 await evaluate('await window.__inv.fetchProducts({categoryId:"cat-tv"})');
 await until('document.body.innerText.includes("no están disponibles temporalmente")');await click('Reintentar');await until(hasProduct);
 // Reload retrieves the ID directly instead of relying on that album cache.
 await go('/inventario/product-ont?unit=unit-match');await until(hasProduct);await until('document.body.innerText.includes("Historial del equipo")');await click('Cerrar');
 // Same component, different ID, including an absent ID and a delayed old request.
 const push=async path=>evaluate('(async()=>{const r=(await import("/src/router/index.ts")).default;await r.push('+JSON.stringify(path)+');})()');
 await push('/inventario/missing');await until('document.body.innerText.includes("Producto no encontrado o no disponible")');assert(!(await text()).includes('ONT modelo de prueba'));
 await evaluate('window.__productDelay=true');await push('/inventario/product-ont');await until('typeof window.__releaseProduct==="function"');
 await evaluate('window.__productDelay=false');await push('/inventario/product-tv');await until('document.querySelector("h1")?.textContent.includes("TV Box de prueba")');
 await evaluate('window.__releaseProduct()');await new Promise(r=>setTimeout(r,250));assert((await text()).includes('TV Box de prueba'));assert(!(await text()).includes('SER-MATCH'));
 await push('/inventario/product-ont');await until(hasProduct);
 // Privilege loss still invalidates sensitive store data.
 await evaluate('window.__auth.role=null');await until('document.body.innerText.includes("Reintentar")');assert.equal(await evaluate('window.__inv.products.length'),0);assert(!(await text()).includes('ONT modelo de prueba'));
 await evaluate('window.__auth.role="ADMIN"');await until(hasProduct);
 await click('Volver a Inventario');await until('document.body.innerText.includes("ONUs / ONTs")');await click('ONUs / ONTs');await until('document.body.innerText.includes("ONT modelo de prueba")');await click('ONT modelo de prueba');await until(hasProduct);
 await click('Revisar diferencias');await until('document.body.innerText.includes("4 resultados")');await click('SER-MATCH');await until('document.body.innerText.includes("Historial del equipo")');await click('Cerrar');
 await push('/inventario/custodia');await until('document.body.innerText.includes("SER-CUSTODIA")');
 await push('/inventario/product-ont');await until(hasProduct);
 console.log('PENDING_ERROR_RETRY_MISSING_ROUTE_RACE_AUTH_INVALIDATION_NAVIGATION_SERIES=PASS');
 if(process.argv.includes('--wait')){
  await send('Target.activateTarget',{targetId:other});console.log('BACKGROUND_WAIT_STARTED=180_SECONDS');
  await new Promise(r=>setTimeout(r,180000));
  await evaluate('(async()=>{const a=(await import("/src/stores/auth.ts")).useAuthStore();a.user={...a.user};})()');await send('Target.activateTarget',{targetId});assert(await evaluate(hasProduct));console.log('RETURN_AFTER_THREE_MINUTES=PASS');
 }
 await noWrites();assert.equal(errors.length,0);console.log('BROWSER_EXCEPTIONS=0; REAL_WRITES=0');await send('Browser.close');
 }
} finally {if(ws)ws.close();chrome.kill();}
