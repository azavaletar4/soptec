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
 async function until(expression){for(let i=0;i<60;i++){const v=await evaluate(expression);if(v)return v;await new Promise(r=>setTimeout(r,250));}console.log(JSON.stringify(await evaluate('({text:document.body.innerText,requests:window.__requests})')));console.log(JSON.stringify(errors));throw Error('UI_ASSERTION_TIMEOUT');}
 await c('Page.navigate',{url:'http://127.0.0.1:5184/login'});
 await until('!!document.querySelector("input[type=password]")');
 console.log('PANEL_LOGIN_RENDERED=PASS');


 await evaluate('new Promise((resolve,reject)=>{const r=indexedDB.open("smartrayco-campo",1);r.onupgradeneeded=()=>{r.result.createObjectStore("drafts");r.result.createObjectStore("closures")};r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=()=>reject(r.error)})');
 const fixture=()=>{
  const uid=localStorage.getItem('test-actor')||'00000000-0000-4000-8000-000000000181',other='00000000-0000-4000-8000-000000000182',rid='10000000-0000-4000-8000-000000000181',cid='20000000-0000-4000-8000-000000000181',contractId='30000000-0000-4000-8000-000000000181',pid='40000000-0000-4000-8000-000000000181';
  const now=Math.floor(Date.now()/1000),encode=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  const user={id:uid,aud:'authenticated',role:'authenticated',email:'custody-ui@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:now+3600,user}));
  const profile={id:uid,full_name:'Tecnico prueba',role:'TECNICO_RED',active:true,must_change_password:false};
  const client={id:cid,first_name:'Cliente',last_name:'Simulado',phone:'',address:'Prueba'};
  const contract={id:contractId,client_id:cid,contract_number:'PRUEBA',service_type:'internet',status:'active',clients:client};
  const product={id:pid,name:'Huawei de prueba',unit:'unidad',is_active:true,is_serialized:true,current_stock:0,inventory_categories:{slug:'onu'}};
  const base={product_id:pid,product,status:'with_technician',custody_technician_id:uid,client_id:null,contract_id:null,installation_id:null,ticket_id:null,routine_id:null};
  window.EventSource=class{constructor(){setTimeout(()=>this.onopen?.({}),0)}addEventListener(){}close(){}};
  window.__requests=[];window.__availableReads=0;
  const realFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
   const u=new URL(typeof input==='string'?input:input.url,location.href);
   if(!u.hostname.endsWith('.supabase.co')&&!u.pathname.startsWith('/api/'))return realFetch(input,init);
   const method=init.method||(input instanceof Request?input.method:'GET');window.__requests.push({path:u.pathname,method});const headers={'Content-Type':'application/json'};
   if(!['GET','HEAD'].includes(method))return new Response(JSON.stringify({message:'WRITE_BLOCKED'}),{status:403,headers});
   const table=u.pathname.split('/').at(-1);let data=[];
   if(table==='user')data=user;
   if(table==='profiles')data=u.searchParams.has('id')?profile:[profile];
   if(table==='installations')data=[{id:rid,client_id:cid,contract_id:contractId,status:'in_progress',assigned_to:uid,created_at:new Date().toISOString(),clients:client,contracts:contract}];
   if(table==='clients')data=u.searchParams.has('id')?client:[client];
   if(table==='service_contracts')data=u.searchParams.has('id')?contract:[contract];
   if(table==='job_assignees')data=[{job_type:'installation',job_id:rid,technician_id:uid,role:'leader',profile}];
   if(u.pathname.includes('/api/campo-inventory/')){
    if(table==='products')data=[product];
    if(table==='available'){
     window.__availableReads++;
     data=[{...base,id:'own',serial_number:uid.endsWith('181')?'RUBER-PROPIA':'OTRO-PROPIA',status:window.__revoke?'in_stock':'with_technician'},
      {...base,id:'foreign',serial_number:'AJENA',custody_technician_id:uid===other?'00000000-0000-4000-8000-000000000181':other},
      {...base,id:'stock',serial_number:'BODEGA',status:'in_stock',custody_technician_id:null},
      {...base,id:'pending',serial_number:'DEVOLUCION',status:'pending_return'},
      {...base,id:'assigned',serial_number:'INSTALADA',status:'assigned'}];
    }
    data={context:{jobType:'installation',jobId:rid,actorId:uid,clientId:cid,contractId},items:data,next:null};
   }
   return new Response(JSON.stringify(data),{status:200,headers});
  };
 };
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')();'});
 const navigate=async()=>{await c('Page.navigate',{url:'http://127.0.0.1:5184/campo/installation/10000000-0000-4000-8000-000000000181'});await until('Array.from(document.querySelectorAll("select option")).some(x=>x.textContent.includes("Huawei de prueba"))');};
 const chooseProduct=()=>evaluate('(()=>{const s=Array.from(document.querySelectorAll("select")).find(s=>s.options[0]?.textContent.includes("Producto (Modem"));s.value="40000000-0000-4000-8000-000000000181";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
 const series=()=>evaluate('Array.from(document.querySelectorAll("select")).find(s=>s.options[0]?.textContent.includes("serie/MAC"))?.textContent');
 await navigate();await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("y red"))?.click()');await chooseProduct();await until('document.body.innerText.includes("RUBER-PROPIA")');
 const list=await series();assert(list.includes('RUBER-PROPIA'));for(const bad of ['AJENA','BODEGA','DEVOLUCION','INSTALADA'])assert(!list.includes(bad));
 await evaluate('window.__revoke=true;const s=Array.from(document.querySelectorAll("select")).find(s=>s.options[0]?.textContent.includes("serie/MAC"));s.value="own";s.dispatchEvent(new Event("change",{bubbles:true}));');
 const before=await evaluate('window.__availableReads');
 await evaluate('Array.from(document.querySelectorAll("form")).find(f=>f.textContent.includes("Actualizar mis series")).dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
 await until('document.body.innerText.includes("El equipo ya no está disponible")');
 assert((await evaluate('window.__availableReads'))>before);
 assert(!(await evaluate('window.__requests')).some(r=>r.path.includes('/campo_inventory_operation')));
 await evaluate('localStorage.setItem("test-actor","00000000-0000-4000-8000-000000000182")');
 await navigate();await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("y red"))?.click()');await chooseProduct();await until('document.body.innerText.includes("OTRO-PROPIA")');
 assert(!(await series()).includes('RUBER-PROPIA'));
 assert.equal(errors.length,0);
 console.log('RUBER_ONLY_OWN=PASS; OTHER_ONLY_OWN=PASS; WAREHOUSE_FOREIGN_INSTALLED_PENDING_HIDDEN=PASS; PREWRITE_REVALIDATION=PASS; REAL_WRITES=0; BROWSER_EXCEPTIONS=0');
 await send('Browser.close');
} finally {if(ws)ws.close();chrome.kill();}
