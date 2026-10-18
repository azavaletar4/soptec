// Run against local Vite preview on 127.0.0.1:5184. Browser-only fixtures;
// Supabase/backend network is blocked and no business RPC is executed.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
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
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 async function until(expression){for(let i=0;i<60;i++){const v=await evaluate(expression);if(v)return v;await new Promise(r=>setTimeout(r,250));}throw Error('UI_ASSERTION_TIMEOUT');}
 await c('Page.navigate',{url:'http://127.0.0.1:5184/login'});
 await until('!!document.querySelector("input[type=password]")');
 console.log('PANEL_LOGIN_RENDERED=PASS');

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
   if(!['GET','HEAD'].includes(method)&&!u.pathname.endsWith('/inventory_get_albums'))return new Response(JSON.stringify({message:'WRITE_BLOCKED'}),{status:403,headers});
   const table=u.pathname.split('/').at(-1);let data=[];
   if(table==='profiles')data={id:uid,role:'ADMIN',must_change_password:false,full_name:'Administración de prueba'};
   if(table==='user')data=user;
   if(table==='inventory_categories')data=cats;
   if(table==='inventory_get_albums')data=[{album_slug:'onu',album_name:'ONUs / ONTs',icon:'📦',color:'sky',item_count:1,low_stock:0,total_value:100},{album_slug:'tvbox',album_name:'TV Box',icon:'📺',color:'violet',item_count:1,low_stock:0,total_value:100},{album_slug:'por_recoger',album_name:'Por recoger',icon:'↩',color:'rose',item_count:0,low_stock:0,total_value:0},{album_slug:'averiados',album_name:'Averiados',icon:'⚒',color:'amber',item_count:0,low_stock:0,total_value:0}];
   if(table==='inventory_products')data=u.searchParams.has('id')?([product,tv].find(p=>'eq.'+p.id===u.searchParams.get('id'))):[product,tv].filter(p=>!u.searchParams.has('category_id')||'eq.'+p.category_id===u.searchParams.get('category_id'));
   if(table==='inventory_units')data=units.filter(x=>(!u.searchParams.has('product_id')||'eq.'+x.product_id===u.searchParams.get('product_id')||u.searchParams.get('product_id').startsWith('in.'))&&(!u.searchParams.has('status')||'eq.'+x.status===u.searchParams.get('status')));
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
 const noWrites=async()=>{const calls=await evaluate('window.__inventoryRequests');assert(!calls.some(r=>!['GET','HEAD'].includes(r.method)&&!r.path.endsWith('/inventory_get_albums')));};
 await c('Page.navigate',{url:'http://127.0.0.1:5184/inventario'});
 await until('document.body.innerText.includes("¿Dónde figura el equipo?") && document.body.innerText.includes("2 ítems")');
 assert((await body()).includes('¿Qué tipo de equipo o material buscas?'));await noWrites();
 assert(await click('ONUs / ONTs'));
 await until('document.body.innerText.includes("ONT modelo de prueba")');
 assert((await body()).includes('1 en almacén'));assert(await click('ONT modelo de prueba'));
 await until('document.body.innerText.includes("3 de 3 unidades")');
 assert((await body()).includes('Técnico: Técnico Prueba'));
 assert(await click('Mover a otro álbum'));assert(await click('TV Box'));
 await until('document.body.innerText.includes("Cambiar categoría del modelo")');
 await evaluate('Array.from(document.querySelectorAll("button")).filter(b=>b.textContent.trim()==="Cancelar").at(-1).click()');
 await noWrites();
 assert(await field('Ubicación / estado','with_technician'));
 await until('document.body.innerText.includes("1 de 3 unidades")');
 assert(!(await body()).includes('SER-ASIGNADA'));assert(await field('Ubicación / estado',''));
 assert(await field('Buscar unidad','SER-MATCH'));await until('document.body.innerText.includes("1 de 3 unidades")');
 assert(await click('SER-MATCH'));await until('document.body.innerText.includes("Historial del equipo")');
 assert(await click('Cerrar'));await noWrites();
 assert(await click('Revisar diferencias'));
 // Por defecto solo "Necesitan revisión" (regla 5): de las 4 unidades del fixture,
 // solo SER-MATCH (posible, serie coincide con un cierre) debe aparecer — la TV
 // Box sin ningún vínculo ("Ubicación sin verificar") ya NO es pendiente (caso
 // real reportado: un equipo en almacén sin evidencia contradictoria no debe
 // ocupar la cola de revisión); la asignada y la de custodia quedan afuera.
 await until('document.body.innerText.includes("1 resultados")');
 let report=await body();
 assert(report.includes('Necesitan revisión (1)'));assert(report.includes('Todo el inventario (4)'));
 assert(report.includes('Pendientes de revisión'));assert(report.includes('Total registrado'));assert(report.includes('Documentalmente coherentes'));
 assert(report.includes('Posible coincidencia que requiere revisión'));
 for(const label of ['Instalación confirmada','Custodia confirmada','Ubicación sin verificar'])assert(!report.includes(label));
 assert(report.includes('Motivo de revisión: En almacén con indicios de estar instalado'));
 assert(report.includes('Serie exacta en 1 cierre(s)'));
 let badges=await evaluate('Array.from(document.querySelectorAll("article .badge")).map(x=>x.textContent.trim())');
 assert.equal(badges.length,1);assert.equal(new Set(badges).size,1);

 // Ninguna unidad desaparece: la segunda vista sigue dando acceso a las 4,
 // incluida la TV Box sin novedad (ya no pendiente, pero tampoco oculta).
 assert(await click('Todo el inventario'));
 await until('document.body.innerText.includes("4 resultados")');
 report=await body();
 for(const label of ['Instalación confirmada','Custodia confirmada','Posible coincidencia que requiere revisión','Ubicación sin verificar'])assert(report.includes(label));
 assert(report.includes('Sin alertas — vínculo documental coherente.'));
 assert(report.includes('Sin vínculos ni coincidencias registradas — no requiere revisión.'));
 badges=await evaluate('Array.from(document.querySelectorAll("article .badge")).map(x=>x.textContent.trim())');
 assert.equal(badges.length,4);assert.equal(new Set(badges).size,4);
 await noWrites();

 assert(await field('Categoría','tvbox'));await until('document.body.innerText.includes("1 resultados")');
 assert((await body()).includes('TV Box de prueba'));assert(!(await body()).includes('SER-ASIGNADA'));
 assert(await field('Categoría',''));assert(await field('Ubicación registrada','in_stock'));
 await until('document.body.innerText.includes("2 resultados")');
 assert(await field('Ubicación registrada',''));await until('document.body.innerText.includes("4 resultados")');

 // Capturas de ambas vistas (viewport móvil), filtros ya en blanco.
 await c('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'));
 const capture=async name=>{const metrics=await c('Page.getLayoutMetrics');const screenshot=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}});await writeFile(name,Buffer.from(screenshot.data,'base64'));};
 await capture('docs/INVENTARIO-CONCILIACION-TODO-LOCAL.png');
 assert(await click('Necesitan revisión'));await until('document.body.innerText.includes("1 resultados")');
 await capture('docs/INVENTARIO-CONCILIACION-REVISION-LOCAL.png');
 await c('Emulation.setDeviceMetricsOverride',{width:0,height:0,deviceScaleFactor:0,mobile:false});

 // Búsqueda, navegación al detalle/Kardex y regreso — mismo patrón ya probado antes de esta mejora.
 assert(await field('Buscar serie','SER-MATCH'));await until('document.body.innerText.includes("1 resultados")');
 assert(await click('SER-MATCH'));await until('document.body.innerText.includes("Historial del equipo")');
 assert(await click('Cerrar'));assert(await click('Volver a Inventario'));
 // Vuelve a entrar (montaje nuevo): la vista predeterminada vuelve a ser "Necesitan revisión".
 await until('document.body.innerText.includes("1 resultados")');
 assert((await body()).includes('Necesitan revisión (1)'));
 await noWrites();

 await evaluate('window.__denyClosures=true');assert(await click('Actualizar lectura'));
 await until('document.body.innerText.includes("No se presenta un reporte parcial")');
 assert(!(await body()).includes('SER-MATCH'));await noWrites();assert.equal(errors.length,0);
 console.log('INVENTORY_SECTIONS=PASS; ALBUM_NAVIGATION=PASS; PRODUCT_FILTERS=PASS; EXISTING_KARDEX=PASS; RECONCILIATION_DEFAULT_REVIEW=PASS; RECONCILIATION_FULL_INVENTORY_REACHABLE=PASS; CATEGORY_STATUS_SEARCH=PASS; MOBILE=PASS; READ_FAILURE=PASS; EXISTING_COUNTS_UNCHANGED=PASS; BROWSER_EXCEPTIONS=0; REAL_WRITES=0');
 await send('Browser.close');
} finally {if(ws)ws.close();chrome.kill();}
