// HTTP/SSE y navegador reales; escrituras solo de cuadrillas ficticias nuevas.
import assert from 'node:assert/strict';
import {spawn,fork} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {config,sql,runtime,root,gateway,wait} from './common.mjs';
const c=config(),f=JSON.parse(readFileSync(runtime+'generic-fixture.json','utf8'));
let resume=false,previous=[];
if(existsSync(runtime+'generic-validation-started.json')){
 if(!process.argv.includes('--resume-offline-harness'))throw Error('Ensayo existente; conservar evidencia, no repetir automáticamente');
 const prior=JSON.parse(readFileSync(root+'docs/INVENTARIO-LAB-GENERICOS-RESULTADOS.json','utf8'));
 assert.equal(prior.status,'INCOMPLETE');assert.equal(prior.results.length,5);assert(prior.results.every(r=>r.status==='PASS'));
 assert.equal(sql(`select count(*) from job_assignees where job_type='installation' and job_id='${f.jobs[0].id}' and technician_id='${f.users.support}' and role='leader'`),'1');
 assert.equal(sql(`select count(*) from job_assignees where job_type='installation' and job_id='${f.jobs[0].id}'`),'1');
 assert.equal(sql(`select count(*) from job_assignees where job_type='ticket' and job_id='${f.jobs[1].id}'`),'3');
 writeFileSync(runtime+'generic-browser-initial-attempt.json',JSON.stringify(prior,null,2));previous=prior.results;resume=true;
}
writeFileSync(runtime+'generic-validation-started.json',JSON.stringify({at:new Date().toISOString()}));
const report={at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',status:'INCOMPLETE',results:previous,authentication:'REAL_GOTRUE_BROWSER_AND_API',productionAccess:false,resumedAfterHarnessCancellation:resume};
const save=()=>writeFileSync(root+'docs/INVENTARIO-LAB-GENERICOS-RESULTADOS.json',JSON.stringify(report,null,2)+'\n');
const pass=(test,detail)=>{report.results.push({test,status:'PASS',detail});console.log('PASS '+test);save();};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const frame='event: invalidate\ndata: {"v":1}\n\n';
const samples=[],tokens={},external=[],exceptions=[],requests=[],sources=[];let cancelledInterceptions=0,asyncError=null;
let clock,chrome,ws;
const before=readFileSync(runtime+'generic-baseline.json','utf8').trim();
const digest=()=>sql(`select jsonb_build_object('products',(select jsonb_agg(to_jsonb(t) order by id) from inventory_products t),'units',(select jsonb_agg(to_jsonb(t) order by id) from inventory_units t),'movements',(select jsonb_agg(to_jsonb(t) order by id) from inventory_movements t),'events',(select jsonb_agg(to_jsonb(t) order by id) from inventory_unit_events t),'receipts',(select jsonb_agg(to_jsonb(t) order by id) from campo_inventory_operations t))`);
const loginApi=async a=>{const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await auth.auth.signInWithPassword({email:a.email,password:a.password});assert(!error,error?.message);return data.session.access_token;};
const crew=async(job,members)=>{
 const expected=JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('technician_id',technician_id,'role',role) order by technician_id),'[]') from job_assignees where job_type='${job.type}' and job_id='${job.id}'`));
 const r=await fetch('http://127.0.0.1:54383/rpc/set_current_job_crew',{method:'POST',headers:{Authorization:'Bearer '+tokens.admin,apikey:c.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_job_type:job.type,p_job_id:job.id,p_expected:expected,p_members:members.map(([role,kind])=>({technician_id:f.users[role],role:kind}))})});
 assert(r.ok,'Cambio de cuadrilla local rechazado: '+await r.text());
};
async function sample(role){
 const abort=new AbortController();const r=await fetch('http://127.0.0.1:54388/events',{headers:{Authorization:'Bearer '+tokens[role],'Last-Event-ID':'ignored-client-header'},signal:abort.signal});
 assert.equal(r.status,200);assert(!r.headers.has('date'));assert(!r.headers.has('etag'));assert(!r.headers.has('x-request-id'));
 const s={role,frames:[],at:[],abort,headers:Object.fromEntries(r.headers)};samples.push(s);
 const reader=r.body.getReader(),decoder=new TextDecoder();
 s.done=(async()=>{let buffer='';try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let pos;while((pos=buffer.indexOf('\n\n'))>=0){s.frames.push(buffer.slice(0,pos+2));s.at.push(Date.now());buffer=buffer.slice(pos+2);}}}catch{}})();
}
const enough=async n=>{for(let i=0;i<Math.ceil(15000/100);i++){if(samples.every(s=>s.frames.length>=n))return;await delay(100);}throw Error('No llegaron avisos periódicos esperados');};
try{
 assert.equal(digest(),before);
 for(const a of c.accounts)tokens[a.role]=await loginApi(a);
 tokens.admin=await loginApi(JSON.parse(readFileSync(runtime+'transactions-admin.json','utf8')));
 clock=fork(join(root,'scripts/inventory-auth-lab/generic-clock.mjs'),[],{cwd:root,env:{...process.env,LAB_GENERIC_CLOCK:'1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 clock.stdout.on('data',b=>process.stdout.write(b));clock.stderr.on('data',()=>console.log('GENERIC_CLOCK_DIAGNOSTIC'));
 await wait(async()=>{try{return (await fetch('http://127.0.0.1:54388/health')).ok;}catch{return false;}});
 const clockStats=()=>new Promise(resolve=>{clock.once('message',resolve);clock.send('stats');});
 const statsBefore=await clockStats();
 for(const role of ['leader','support','outsider','removed'])await sample(role);
 const profile=mkdtempSync(join(tmpdir(),'inventory-generic-'));
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('Chrome timeout')),20000);chrome.once('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails?.text);
  if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('/api/campo-inventory/'))requests.push({url:m.params.request.url,at:Date.now()});
  if(m.method==='Network.eventSourceMessageReceived')sources.push({data:m.params.data,event:m.params.eventName,id:m.params.eventId});
  if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),allowed=u.hostname==='127.0.0.1'&&['54381','54384'].includes(u.port);if(!allowed)external.push(u.origin);void send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(allowed?{}:{errorReason:'BlockedByClient'})},m.sessionId).catch(e=>{if(e.message.includes('Invalid InterceptionId'))cancelledInterceptions++;else asyncError=e.message;});}
 };
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const page=(method,params={})=>send(method,params,sessionId);
 await page('Page.enable');await page('Page.bringToFront');await page('Runtime.enable');await page('Network.enable');await page('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Error de UI: '+r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let n=0;n<150;n++){if(await evaluate(expression))return;await delay(100);}throw Error('Timeout UI: '+expression+'; estado='+await evaluate('document.querySelector("#state")?.textContent'));};
 const change=async(id,value)=>evaluate(`document.querySelector('#${id}').value=${JSON.stringify(value)};document.querySelector('#${id}').dispatchEvent(new Event('change',{bubbles:true}))`);
 const click=id=>evaluate(`document.querySelector('#${id}').click()`);
 const login=async(role,state)=>{await change('role',role);await click('login');assert.equal(await evaluate('document.querySelector("#results").textContent'),'');await until(`document.querySelector('#session').textContent==='Sesión Auth real: ${role}'`);await until(`document.querySelector('#state').textContent==='${state}'`);};
 await page('Page.navigate',{url:'http://127.0.0.1:54384/generic.html'});
 await until('document.querySelectorAll("#role option").length===4 && window.__genericLab');
 const [alta,ticket]=f.jobs;
 if(!resume){
 for(const role of ['leader','support','outsider','removed']){
  const state=role==='outsider'?'blocked':'ready';await login(role,state);
  assert.equal((await evaluate('document.querySelector("#results").textContent')).length>0,state==='ready');
 }
 pass('Cuatro sesiones reales y limpieza al cambiar de usuario','UI con Auth/store reales: líder/apoyo/asignado 200; ajeno bloqueado y caché vacío; cambio de sesión limpia inmediatamente.');
 // Tres avisos iniciales sin escrituras de actividad: observar el reloj sin acelerarlo.
 await enough(1);await enough(2);await enough(3);
 report.activityStarted=Date.now();
 await crew(alta,[['leader','leader'],['support','support']]);
 await until('document.querySelector("#state").textContent==="blocked"');
 assert.equal(await evaluate('document.querySelector("#results").textContent'),'');
 const blockedRequests=requests.length;
 await enough(4);await enough(5);
 assert.equal(requests.length,blockedRequests,'La orden denegada siguió consultándose por ticks');
 pass('Retirada con avisos abiertos y pausa de consultas','Retirada mediante RPC/JWT ADMIN ficticio; al siguiente tick, 403 limpia la UI; dos ticks posteriores no generan consultas y las señales continúan idénticas.');
 await login('support','ready');
 const beforeBurst=await evaluate('window.__genericLab.stats().requests');
 await evaluate('Promise.all(Array.from({length:100},()=>window.__genericLab.tick()))');
 assert.equal(await evaluate('window.__genericLab.stats().requests'),beforeBurst+1);
 pass('Ráfaga local sin duplicar consultas','Cien activaciones concurrentes del controlador producen una sola recarga de la orden visible. No se alteró el reloj de 10 s.');
 await crew(alta,[['outsider','leader']]);
 await until('document.querySelector("#state").textContent==="blocked"');
 assert.equal(await evaluate('document.querySelector("#results").textContent'),'');
 pass('Reasignación invalida caché de la orden visible','El apoyo pierde autorización; se vacían resultados y se detienen consultas automáticas.');
 await login('outsider','ready');
 await login('support','blocked');
 await crew(alta,[['support','leader']]);
 const paused=await evaluate('window.__genericLab.stats().requests');
 const next=samples[0].frames.length+1;await enough(next);
 assert.equal(await evaluate('window.__genericLab.stats().requests'),paused);
 await click('retry');await until('document.querySelector("#state").textContent==="ready"');
 pass('Recuperación explícita después de restituir autorización','La restitución no dispara consultas en la orden pausada; Comprobar acceso reautoriza y recarga con JWT real.');
 }else{
  await login('support','ready');
  await enough(1);await enough(2);await enough(3);report.activityStarted=Date.now();
  await crew(alta,[]); // Nuevo ensayo de metadatos; la UI pasa a la Avería autorizada.
 }
 await change('job',ticket.id);await until('document.querySelector("#state").textContent==="ready"');
 const atSwitch=requests.length;
 await evaluate('window.dispatchEvent(new Event("offline"))');
 await until('document.querySelector("#state").textContent==="offline"');
 assert.equal(await evaluate('document.querySelector("#results").textContent'),'');
 await evaluate('Promise.all(Array.from({length:10},()=>window.__genericLab.tick()))');assert.equal(requests.length,atSwitch);
 await page('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});await delay(300);
 await page('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await evaluate('window.dispatchEvent(new Event("online"))');await until('document.querySelector("#state").textContent==="ready"');
 assert(requests.slice(atSwitch).every(r=>r.url.includes(ticket.id)));
 pass('Desconexión, reconexión y selección visible','Modo offline limpia y detiene lecturas; reconexión reconsulta solo la Avería visible, sin caché de Alta ni escrituras.');
 if(resume){await enough(4);await crew(alta,[['support','leader']]);await enough(5);await crew(alta,[]);}
 await enough(6);
 assert.equal(external.length,0);assert.equal(exceptions.length,0);
 assert.equal(asyncError,null);report.cancelledInterceptions=cancelledInterceptions;
 assert(sources.length>0);assert(sources.every(s=>s.data==='{"v":1}'&&s.event==='invalidate'&&s.id===''));
 const timing=samples.map(s=>{
  assert(s.frames.every(v=>v===frame),'Contenido del transporte no constante');
  assert.deepEqual(s.headers,samples[0].headers,'Metadatos distintos entre receptores');
  const intervals=s.at.slice(1).map((t,i)=>t-s.at[i]);assert(intervals.every(n=>Math.abs(n-10000)<=500),'Cadencia fuera de tolerancia local');
  return {role:s.role,frames:s.frames.length,hash:createHash('sha256').update(frame).digest('hex'),minimumMs:Math.min(...intervals),maximumMs:Math.max(...intervals)};
 });
 report.transport={frameBytes:Buffer.byteLength(frame),cadenceMs:10000,toleranceMs:500,baselineFrames:3,activityFramesAtLeast:3,samples:timing,content:'event: invalidate + data: {v:1}; sin ID/retry/contador ni URL de orden'};
 pass('Avisos indistinguibles antes/durante actividad y revocaciones','Cuatro conexiones con JWT distintos: mismos bytes/headers y cadencia global, sin IDs; retirados y reasignados continúan recibiendo el reloj sin información operativa.');
 const statsAfter=await clockStats();
 const resource={cpuUserMs:(statsAfter.cpu.user-statsBefore.cpu.user)/1000,cpuSystemMs:(statsAfter.cpu.system-statsBefore.cpu.system)/1000,rssMiB:statsAfter.memory.rss/1024/1024,heapMiB:statsAfter.memory.heapUsed/1024/1024,connections:statsAfter.connections,contextRequests:requests.length};
 assert(resource.rssMiB<128);assert(resource.cpuUserMs+resource.cpuSystemMs<5000);assert(requests.length<120);
 report.resources=resource;report.externalRequests=external.length;report.runtimeExceptions=exceptions.length;
 pass('Recursos acotados y ausencia de accesos externos','Reloj sin consultas SQL, sin colas de replay; RSS <128 MiB y CPU <5 s en el ensayo. Consultas contextualizadas paginadas; cero peticiones externas.');
 report.status='APPROVED_IN_LAB';
 await send('Browser.close');
}catch(e){report.status='BLOCKED';report.error=e instanceof Error?e.message:'Fallo de ensayo';save();throw e;}
finally{
 for(const s of samples)s.abort.abort();ws?.close();chrome?.kill();clock?.kill('SIGTERM');
 if(clock)await Promise.race([new Promise(r=>clock.once('exit',r)),delay(2000)]);
 report.inventoryUnchanged=digest()===before;if(!report.inventoryUnchanged)report.status='BLOCKED';save();
 assert(report.inventoryUnchanged,'Cambios inesperados de inventario');console.log('GENERIC_RESULT '+report.status+'; inventario intacto.');
}
