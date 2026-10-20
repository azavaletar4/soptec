// Run against local Vite on 127.0.0.1:5197. Installation kit browser fixtures;
// Supabase/backend network is blocked; writes run only in the synthetic fixture.
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
 async function until(expression){for(let i=0;i<60;i++){const v=await evaluate(expression);if(v)return v;await new Promise(r=>setTimeout(r,250));}console.log(JSON.stringify(await evaluate('({text:document.body.innerText,requests:window.__requests})')));console.log(JSON.stringify(errors));throw Error('UI_ASSERTION_TIMEOUT');}
 await c('Page.navigate',{url:'http://127.0.0.1:5197/login'});
 await until('!!document.querySelector("input[type=password]")');
 await evaluate('new Promise((resolve,reject)=>{const r=indexedDB.open("smartrayco-campo",1);r.onupgradeneeded=()=>{r.result.createObjectStore("drafts");r.result.createObjectStore("closures")};r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=()=>reject(r.error)})');
 function fixture(){
  const uid='00000000-0000-4000-8000-000000000181',rid='10000000-0000-4000-8000-000000000181',cid='20000000-0000-4000-8000-000000000181',contractId='30000000-0000-4000-8000-000000000181';
  const now=Math.floor(Date.now()/1000),enc=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  const user={id:uid,aud:'authenticated',role:'authenticated',email:'kit@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:now+3600,user}));
  const profile={id:uid,full_name:'Técnico de laboratorio',role:'TECNICO_RED',active:true,must_change_password:false},client={id:cid,first_name:'Cliente',last_name:'Ficticio',phone:'',address:'Laboratorio'},contract={id:contractId,client_id:cid,contract_number:'KIT-PRUEBA',service_type:'internet',status:'active',clients:client};
  const products=[['conector','Conector Óptico'],['roseta','Roseta Óptica'],['patchcord','Patchcord'],['drop','Cable Drop 100 metros'],['bobina','Bobina Drop'],['otro','Grapas']].map(([id,name])=>({id,name,unit:id==='bobina'?'metros':'unidad',is_active:true,is_serialized:false,current_stock:100,inventory_categories:{slug:'ferreteria'}}));
  window.EventSource=class{constructor(){setTimeout(()=>this.onopen?.({}),0)}addEventListener(){}close(){}};
  const initial={custody:{conector:1,roseta:1,patchcord:1,drop:4,bobina:100,otro:3},movements:[],receipts:{},writes:[]};
  if(!localStorage.getItem('kit-lab-state'))localStorage.setItem('kit-lab-state',JSON.stringify(initial));
  window.__kitState=()=>JSON.parse(localStorage.getItem('kit-lab-state'));
  window.__kitSave=s=>localStorage.setItem('kit-lab-state',JSON.stringify(s));
  window.__kitReset=(stock=1)=>{const s=structuredClone(initial);s.custody.conector=stock;window.__kitSave(s);for(const k of Object.keys(localStorage))if(k.startsWith('campo-inventory:'))localStorage.removeItem(k);};
  const realFetch=fetch.bind(window);
  window.fetch=async(input,init={})=>{
   const u=new URL(typeof input==='string'?input:input.url,location.href);
   if(!u.hostname.endsWith('.supabase.co')&&!u.pathname.startsWith('/api/'))return realFetch(input,init);
   const table=u.pathname.split('/').at(-1),method=init.method||(input instanceof Request?input.method:'GET'),s=window.__kitState();
   const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Content-Range':'0-0/1'}});
   if(table==='campo_inventory_operation'){
    const req=JSON.parse(init.body);s.writes.push(req);window.__kitSave(s);
    if(s.receipts[req.p_operation_id])return response(s.receipts[req.p_operation_id]);
    if(req.p_action!=='kit')return response({message:'NO AUTORIZADO EN LAB'},403);
    if(req.p_payload.items.some(i=>i.quantity>(s.custody[i.productId]||0)))return response({materialRejected:true,operationId:req.p_operation_id,message:'No tienes suficiente material en custodia'});
    const ids=[];for(const item of req.p_payload.items){const id='movement-'+(s.movements.length+1);ids.push(id);s.custody[item.productId]-=item.quantity;s.movements.push({id,product_id:item.productId,product:products.find(p=>p.id===item.productId),quantity:item.quantity,movement_type:'egreso',created_at:'2026-10-20T20:00:00Z',reason:'Kit de prueba',is_reversed:false});}
    const result={operationId:req.p_operation_id,jobType:'installation',jobId:rid,action:'kit',ids,at:'2026-10-20T20:00:00Z'};s.receipts[req.p_operation_id]=result;const lose=s.loseResponse;s.loseResponse=false;window.__kitSave(s);if(lose)throw new TypeError('Respuesta perdida sintética');return response(result);
   }
   if(table==='my_inventory_custody')return response({units:[],materials:products.map(p=>({product:p,quantity:s.custody[p.id]})),pendingReturnRequests:[]});
   if(!['GET','HEAD'].includes(method)&&!['my_field_job_points'].includes(table))return response({message:'WRITE_BLOCKED'},403);
   let data=[];
   if(table==='user')data=user;
   if(table==='profiles')data=u.searchParams.has('id')?profile:[profile];
   if(table==='installations')data=[{id:rid,client_id:cid,contract_id:contractId,status:'in_progress',assigned_to:uid,created_at:'2026-10-20T12:00:00Z',clients:client,contracts:contract}];
   if(table==='clients')data=u.searchParams.has('id')?client:[client];
   if(table==='service_contracts')data=u.searchParams.has('id')?contract:[contract];
   if(table==='job_assignees')data=[{job_type:'installation',job_id:rid,technician_id:uid,role:'leader',profile}];
   if(u.pathname.includes('/api/campo-inventory/')){if(table==='products')data=products;if(table==='materials')data=s.movements;data={context:{jobType:'installation',jobId:rid,actorId:uid,clientId:cid,contractId},items:data,next:null};}
   return response(data);
  };
 }
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')();'});
 await c('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; Mobile; wv) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36 SmartRaycoApp/1.0'});
 await c('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const url='http://127.0.0.1:5197/campo/installation/10000000-0000-4000-8000-000000000181';
 const open=async()=>{await c('Page.navigate',{url});await until('document.body.textContent.includes("Kit base de instalación")');await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("3. Materiales")).click()');await until('[...document.querySelectorAll("section")].find(s=>s.textContent.includes("Kit base de instalación"))?.querySelectorAll("input[type=number]").length===3');await until('document.body.innerText.includes("Tu custodia: 1")||document.body.innerText.includes("Tu custodia: 0")||document.body.innerText.includes("Tu custodia: 2")');};
 const values=()=>evaluate(`(()=>{const s=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent.includes('Kit base'));return [...s.querySelectorAll('.divide-y > div')].map(r=>({label:r.querySelector('span').textContent,value:Number(r.querySelector('input[type=number]').value),max:r.querySelector('input[type=number]').max}));})()`);
 const setConnector=async qty=>evaluate(`(()=>{const row=[...document.querySelectorAll('.divide-y > div')].find(r=>r.textContent.includes('Conector Óptico'));const i=row.querySelector('input');i.value=${qty};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const register=()=>evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Registrar kit base")).click()');
 const state=()=>evaluate('window.__kitState()');
 const reset=async n=>{await evaluate('window.__kitReset('+n+')');await open();};
 const checks=[];await open();const defaults=await values();assert.deepEqual(defaults.map(r=>r.value),[1,1,1]);assert.equal((await state()).writes.length,0);
 await evaluate('[...document.querySelectorAll("section")].find(s=>s.querySelector("h2")?.textContent.includes("Kit base")).scrollIntoView({block:"start"})');
 await writeFile('docs/ALTA-KIT-CONECTOR-UNO.png',Buffer.from((await c('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await register();await until('window.__kitState().movements.length===3 && document.body.innerText.includes("Kit base registrado")');assert.equal((await state()).custody.conector,0);checks.push('DEFAULTS_1_1_1_AND_ONE_CONNECTOR_CONSUMED');
 const persisted=await state();await open();await until('[...document.querySelectorAll("section")].find(s=>s.querySelector("h2")?.textContent.trim()==="Materiales usados")?.querySelectorAll("ul li").length===3');assert.deepEqual((await state()).movements,persisted.movements);assert.equal((await state()).writes.length,1);checks.push('REOPEN_PRESERVES_CONSUMED_MATERIALS_WITHOUT_NEW_WRITE');
 await reset(0);await register();await until('document.body.innerText.includes("No tienes suficiente material en custodia")');assert.equal((await state()).movements.length,0);checks.push('ZERO_CUSTODY_REJECTED');
 await evaluate('const s=window.__kitState();s.custody.conector=1;window.__kitSave(s)');await register();await until('window.__kitState().movements.length===3');let st=await state();assert.equal(st.writes[0].p_operation_id,st.writes[1].p_operation_id);checks.push('RETRY_AFTER_DELIVERY_SAME_UUID_ONCE');
 await reset(2);await setConnector(2);await register();await until('window.__kitState().movements.length===3');st=await state();assert.equal(st.movements.find(m=>m.product_id==='conector').quantity,2);checks.push('MANUAL_TWO_WITH_SUFFICIENT_CUSTODY');
 await reset(1);await setConnector(2);await register();await until('document.body.innerText.includes("No tienes suficiente material en custodia")');await setConnector(1);await register();await until('window.__kitState().movements.length===3');st=await state();assert.equal(st.writes[0].p_operation_id,st.writes[1].p_operation_id);assert.equal(st.movements.find(m=>m.product_id==='conector').quantity,1);checks.push('CONFIRMED_REJECTION_CORRECTED_WITH_SAME_UUID');
 await reset(1);await evaluate('const s=window.__kitState();s.loseResponse=true;window.__kitSave(s)');await register();await until('document.body.innerText.includes("Confirmar operación de inventario pendiente")');st=await state();assert.equal(st.movements.length,3);await open();await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Confirmar operación de inventario pendiente")).click()');await until('!Object.keys(localStorage).some(k=>k.startsWith("campo-inventory:v1:"))');st=await state();assert.equal(st.movements.length,3);assert.equal(st.writes[0].p_operation_id,st.writes[1].p_operation_id);checks.push('LOST_RESPONSE_REOPEN_RETRY_NO_DUPLICATE');
 assert.equal(errors.length,0,JSON.stringify(errors));const report={result:'PASS',synthetic:true,productionAccess:false,physicalAndroid:false,defaults,checks,exceptions:0};await writeFile('docs/ALTA-KIT-CONECTOR-NAVEGADOR.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await send('Browser.close');
}finally{if(ws)ws.close();chrome.kill();}
