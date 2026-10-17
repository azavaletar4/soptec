// Run against local Vite on 127.0.0.1:5184. Browser-only fixtures;
// Supabase/backend network is blocked and no business RPC is executed.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'custodia-usability-browser-'));
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
  const uid='00000000-0000-4000-8000-000000000161',rid='10000000-0000-4000-8000-000000000161';
  const now=Math.floor(Date.now()/1000),encode=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  const user={id:uid,aud:'authenticated',role:'authenticated',email:'fase161-ui@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  const access_token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic';
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:now+3600,user}));
  window.__fase161MockRequests=[];
  const realFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
   const u=new URL(typeof input==='string'?input:input.url,location.href);
   if(u.hostname.endsWith('.supabase.co')||u.pathname.startsWith('/api/')){
    const method=init.method||(input instanceof Request?input.method:'GET');
    window.__fase161MockRequests.push({path:u.pathname,method});
    if(method!=='GET'&&method!=='HEAD'&&!u.pathname.endsWith('/inventory_custody_summary'))return new Response(JSON.stringify({message:'BLOCKED_NON_READ_REQUEST'}),{status:403,headers:{'Content-Type':'application/json'}});
    const table=u.pathname.split('/').at(-1);
    const profile={id:uid,full_name:'Prueba visual Fase 161',email:user.email,role:'ADMIN',active:true,must_change_password:false};
    let data=[];
    if(table==='profiles')data=u.searchParams.has('id')?profile:[{...profile,id:'tech-empty',role:'TECNICO_RED',full_name:'Tecnico sin custodia'},{...profile,id:'tech-custody',role:'TECNICO_RED',full_name:'Tecnico con custodia'}];
    if(table==='user')data=user;
    const product={id:'product-ui',name:'ONT simulada',is_serialized:true,unit:'unidad',category:'onu'};
    const equipment={id:'unit-ui',product_id:product.id,serial_number:'SERIE-PRUEBA-LOCAL',mac_address:null,status:'with_technician',custody_technician_id:'tech-custody',product};
    const delivery={id:'event-ui',unit_id:equipment.id,from_status:'in_stock',to_status:'with_technician',assigned_to:'tech-custody',created_at:'2026-10-18T02:30:00Z',author:{id:uid,full_name:'Administradora verificable',email:user.email},equipment};
    if(table==='inventory_products')data=u.searchParams.has('id')?product:[product];
    if(table==='inventory_units')data=[equipment];
    if(table==='inventory_unit_events')data=[delivery];
    if(table==='technician_material_custody_events')data=[];
  if(table==='inventory_custody_summary')data=[{product_id:rid,product_name:'Material de prueba visual',unit:'m',is_serialized:false,warehouse_qty:5,custody_qty:0,installed_qty:null,other_qty:null,custody_by_technician:{}}];
    if(table==='routines')data=[{id:rid,title:'Rutina simulada — solo verificación visual',routine_number:'UI-FASE161',status:'in_progress',assigned_to:uid,client_id:null,contract_id:null,category:'otro',tipo_rutina:'mantenimiento_preventivo',created_at:new Date().toISOString(),routine_returns:[]}];
    if(table==='job_assignees')data=[{job_type:'routine',job_id:rid,technician_id:uid,role:'leader',profile}];
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','Content-Range':'0-0/1'}});
   }
   return realFetch(input,init);
  };
 };
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')();'});

 await c('Page.navigate',{url:'http://127.0.0.1:5184/inventario/custodia'});
 await until('document.body.innerText.includes("Custodia de técnicos") && !document.body.innerText.includes("Cargando custodia")');

 await until('document.body.innerText.includes("SERIE-PRUEBA-LOCAL") && document.body.innerText.includes("Administradora verificable")');
 assert((await evaluate('document.body.innerText')).includes('17/10/2026'));
 const clickText=async text=>evaluate('(()=>{const b=Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes('+JSON.stringify(text)+'));if(!b)return false;b.click();return true;})()');
 assert(await clickText('Tecnico sin custodia'));
 await until('!document.body.innerText.includes("SERIE-PRUEBA-LOCAL")');
 assert(await clickText('Actualizar'));
 await until('!document.body.innerText.includes("Cargando...")');
 assert(!(await evaluate('document.body.innerText')).includes('SERIE-PRUEBA-LOCAL'));
 assert(await clickText('Tecnico con custodia'));
 await until('document.body.innerText.includes("SERIE-PRUEBA-LOCAL")');
 await evaluate('document.querySelector("details").open=true');
 await until('document.body.innerText.includes("Entrega a técnico")');
 assert(await evaluate('(()=>{const link=Array.from(document.querySelectorAll("a")).find(a=>a.textContent.includes("SERIE-PRUEBA-LOCAL"));if(!link)return false;link.click();return true;})()'));
 await until('document.body.innerText.includes("Historial del equipo") && document.body.innerText.includes("Administradora verificable")');
 assert((await evaluate('location.pathname+location.search')).includes('/inventario/product-ui?unit=unit-ui'));
 console.log('AUTO_SELECTION=PASS; MANUAL_SELECTION=PASS; REFRESH_SELECTION=PASS; HISTORY_PERU=PASS; EXISTING_EQUIPMENT_KARDEX=PASS');
 const calls=await evaluate('window.__fase161MockRequests');
 
 assert(!calls.some(r=>!['GET','HEAD'].includes(r.method)&&!r.path.endsWith('/inventory_custody_summary')));
 console.log(JSON.stringify(errors));assert.equal(errors.length,0);console.log('BROWSER_EXCEPTIONS=0; BUSINESS_WRITES=0; SYNTHETIC_SESSION=true');
 const screenshot=await c('Page.captureScreenshot',{format:'png'});
 
 await send('Browser.close');
} finally {if(ws)ws.close();chrome.kill();}


