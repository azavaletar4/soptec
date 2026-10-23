// Bundle HTTPS real; sesión y respuestas de datos sólo simuladas. Cero escrituras HTTP.
import fs from 'node:fs';import { spawn } from 'node:child_process';import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';import assert from 'node:assert/strict';
const snapshot=JSON.parse(fs.readFileSync('scripts/inventory-auth-lab/runtime/clientes-cloud-private.json','utf8')).find(r=>r.kind==='snapshot');
const profile=await mkdtemp(join(tmpdir(),'clientes-deployed-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
try {
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Chrome timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let seq=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error('CDP timeout: '+method)),30000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Network.setBlockedURLs',{urls:['*supabase.co/*']});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);};
 function fixture(rows){
  const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'validation@example.invalid',app_metadata:{},user_metadata:{}};
  const enc=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');const now=Math.floor(Date.now()/1000);
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:enc({alg:'HS256'})+'.'+enc({sub:user.id,exp:now+3600,role:'authenticated'})+'.synthetic',refresh_token:'synthetic',expires_at:now+3600,user}));
  const clients=rows.map((r,n)=>({...r,id:'synthetic-'+n,first_name:'Validación',last_name:String(n),document_number:'SIM-'+n,phone:null,created_at:'2026-10-23',service_contracts:r.service_contracts.map((s,i)=>({...s,id:'ct-'+n+'-'+i,client_id:'synthetic-'+n,priority:'medium',client_code:'SIM-SERV-'+n+'-'+i,created_at:'2026-10-23'})),installations:r.installations.map((s,i)=>({...s,id:'inst-'+n+'-'+i,client_id:'synthetic-'+n,created_at:'2026-10-23'}))}));
  const realFetch=window.fetch.bind(window);window.__calls=[];
  window.fetch=async(input,init={})=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.origin===location.origin&&!url.pathname.startsWith('/api/'))return realFetch(input,init);
   const method=init.method||'GET';window.__calls.push({path:url.pathname,method});if(!['GET','HEAD'].includes(method))throw Error('Blocked operational write');
   const table=url.pathname.split('/').at(-1);let data=[];
   if(table==='profiles')data={id:user.id,role:'ADMIN',must_change_password:false,full_name:'Validación simulada'};
   if(table==='clients')data=clients;
   if(table==='service_contracts')data=clients.flatMap(c=>c.service_contracts);
   if(table==='installations')data=clients.flatMap(c=>c.installations);
   if(table==='prospects')data=[{id:'synthetic-prospect',full_name:'Prospecto de validación',phone:'SIMULADO',estado:'en_negociacion',created_at:'2026-10-23',canal_contacto:'otro'}];
   const total=Array.isArray(data)?data.length:null;
   if(Array.isArray(data)){const from=Number(url.searchParams.get('offset')||0);const limit=Number(url.searchParams.get('limit')||500);data=data.slice(from,from+limit);}
   return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json',...(total!==null?{'Content-Range':'0-'+Math.max(0,data.length-1)+'/'+total}:{})}});
  };
 }
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')('+JSON.stringify(snapshot.rows)+');'});
 await c('Page.navigate',{url:'https://panel.rayconetworks.com/clientes'});
 await until('document.body?.textContent.includes("'+snapshot.counts.subscribers+' abonados vigentes · '+snapshot.counts.retired+' retirados")');
 const click=label=>evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim().startsWith('+JSON.stringify(label)+')).click()');
 const rowCount=()=>evaluate('document.querySelectorAll("tbody tr").length');
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('a[href="/clientes/prospectos"]')).filter(a=>a.textContent.includes('Prospectos')).length`),1);
 await click('+ Nuevo cliente');await until('!!document.querySelector(".modal-overlay form")');await click('Cancelar');
 await click('Suspendidos');assert.equal(await rowCount(),snapshot.counts.suspended);
 await click('Con múltiples servicios');assert.equal(await rowCount(),snapshot.counts.multipleServices);
 assert.equal(await evaluate('new Set(Array.from(document.querySelectorAll("tbody tr")).map(r=>r.textContent)).size'),snapshot.counts.multipleServices);
 await click('Todos');await click('Clientes retirados');assert.equal(await rowCount(),snapshot.counts.retired);
 await click('Reincorporar');await until('document.querySelector("[role=dialog]")?.textContent.includes("Preparar reincorporación")');await click('Cerrar');
 await evaluate(`document.querySelector('a[href="/clientes/prospectos"]').click()`);
 await until('document.querySelector("h1")?.textContent==="Prospectos"');
 assert.ok(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Nuevo prospecto"))'));
 assert.equal(await evaluate('window.__calls.filter(c=>!["GET","HEAD"].includes(c.method)).length'),0);
 assert.equal(errors.length,0,JSON.stringify(errors));
 const report={status:'PASS',origin:'https://panel.rayconetworks.com',realPublishedBundle:true,dataAndSession:'SIMULATED_FROM_READ_ONLY_AGGREGATE_SNAPSHOT_NO_REAL_IDENTIFIERS',subscribers:snapshot.counts.subscribers,retired:snapshot.counts.retired,suspended:snapshot.counts.suspended,multipleServices:snapshot.counts.multipleServices,prospectsLink:true,newClientModal:true,prospectsPage:true,reincorporationPreparationOnly:true,operationalHttpWrites:0,realAuthenticatedValidation:'PENDING_OPERATOR'};
 fs.writeFileSync('docs/CLIENTES-DESPLIEGUE-NAVEGADOR.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{ws?.close();chrome.kill();}
