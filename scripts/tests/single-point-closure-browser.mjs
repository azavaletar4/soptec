// Actual shared Vue editor; synthetic RPC/profile/audit reads; loopback only.
import {createServer} from 'vite';import {spawn} from 'node:child_process';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://single-closure.invalid';process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-single-closure-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,seq=0,checks=0;const pending=new Map(),errors=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome timeout')),20000);let log='';chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method+' '+(params.expression||'').slice(0,100)));},60000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 ws.addEventListener('message',async e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;await c(request.url.startsWith(base)?'Fetch.continueRequest':'Fetch.failRequest',request.url.startsWith(base)?{requestId}:{requestId,errorReason:'BlockedByClient'});}});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,70));}throw Error('Timeout '+expression);};
 const check=async(expression,expected=true)=>{assert.deepEqual(await evaluate(expression),expected,expression);checks++;};
 const reset=async(type='ticket',role='ADMIN',crew=2)=>{await evaluate(`resetCase('${type}','${role}',${crew})`);await wait('!!document.querySelector("form") && document.querySelector("input[type=number]")?.value==="2" && document.body.innerText.includes("Puntos iniciales: 2")');};
 const change=async(points=5)=>{await evaluate(`(()=>{const n=document.querySelector('input[type=number]');n.value='${points}';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait('!!document.querySelector("input[maxlength]")');};
 const reason=async()=>{await evaluate(`(()=>{const r=document.querySelector('input[maxlength]');r.value='Revisión de cierre';r.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait('!document.querySelector("button[type=submit]").disabled');};
 const click=()=>evaluate('document.querySelector("button[type=submit]").click()');
 const closed=()=>wait('document.body.innerText.includes("Estado: Cerrada") && !document.querySelector("form")');
 await c('Page.navigate',{url:base+'scripts/tests/single-point-closure-browser.html'});await wait('window.ready && !!document.querySelector("form")');
 for(const type of ['ticket','installation','routine'])for(const crew of [1,2])for(const changed of [false,true]){
  await reset(type,changed?'SUPERADMIN':'ADMIN',crew);
  await check('document.querySelectorAll("form").length',1);await check('document.querySelectorAll("button").length',1);await check('document.querySelectorAll("input[type=checkbox],[role=dialog]").length',0);
  await check('document.querySelector("button[type=submit]").textContent','Confirmar cierre');await check('document.querySelector("input[maxlength]")===null');
  if(changed){await change();await check('document.querySelector("button[type=submit]").disabled');await check('document.querySelector("input[maxlength]").required');await reason();}
  await click();await closed();
  await check('calls.filter(c=>c.name==="confirm_work_order_points").length',1);await check('!calls.some(c=>c.name==="adjust_work_order_points")');await check('model.history.length',changed?1:0);
  await check('calls.find(c=>c.name==="confirm_work_order_points").args.p_reason',changed?'Revisión de cierre':'');await check('calls.find(c=>c.name==="confirm_work_order_points").args.p_confirmed');
  await wait('document.body.innerText.includes("Puntos iniciales: 2")');await check('document.body.innerText.includes("Puntos finales: '+(changed?5:2)+'")');
  await check('model.closure.crew.map(m=>m.points)',Array(crew).fill((changed?5:2)/crew));
  await check('!document.querySelector("input,button[type=submit]")');
  await check('!document.body.innerText.includes("Puntaje histórico protegido") && !document.body.innerText.includes("Importes y reparto congelados") && !document.body.innerText.includes("Una incidencia posterior requiere")');
  console.log('ONE_CLICK_PASS '+type+' crew='+crew+' changed='+changed);
 }
 await reset();await change();await reason();await evaluate('document.querySelector("form").requestSubmit();document.querySelector("form").requestSubmit()');await closed();await check('calls.filter(c=>c.name==="confirm_work_order_points").length',1);
 // Failure before commit: preserve the proposal, reconcile by SELECT, retry once.
 await reset();await change();await reason();await evaluate('model.fail="before"');await click();await wait('!!document.querySelector("[role=alert]") && !document.querySelector("button[type=submit]").disabled');
 await check('model.points',2);await check('model.history.length',0);await check('!model.confirmed');await check('document.querySelector("input[type=number]").value','5');
 await evaluate('model.fail=null');await click();await closed();await check('model.history.length',1);await check('calls.filter(c=>c.name==="confirm_work_order_points").length',2);
 // Lost response after commit: reconcile to closed without another mutation.
 await reset();await change();await reason();await evaluate('model.fail="after"');await click();await closed();await wait('document.body.innerText.includes("Puntos iniciales: 2")');
 await check('calls.filter(c=>c.name==="confirm_work_order_points").length',1);await check('model.history.length',1);
 // Lost response + unavailable read: retry same token/value remains idempotent.
 await reset();await change();await reason();await evaluate('model.fail="after-offline"');await click();await wait('document.body.innerText.includes("No hay conexión") && !document.querySelector("button[type=submit]").disabled');
 await check('model.history.length',1);await evaluate('model.fail=null;model.reviewUnavailable=false');await click();await closed();await check('model.history.length',1);await check('calls.filter(c=>c.name==="confirm_work_order_points").length',2);
 // A stale token reloads for review; never automatically submits again.
 await reset();await change();await reason();await evaluate('model.version++');await click();await wait('document.body.innerText.includes("La orden cambió") && !document.querySelector("button[type=submit]").disabled');
 await check('model.points',2);await check('calls.filter(c=>c.name==="confirm_work_order_points").length',1);await click();await closed();await check('model.history.length',1);
 // Original value survives >20 adjustments. Closed views make no mutation.
 await reset();await evaluate('seedClosedHistory()');await closed();await wait('document.body.innerText.includes("Puntos iniciales: 2")');await check('document.body.innerText.includes("Puntos finales: 23")');
 await check('!document.body.innerText.includes("Cerrado por")');await evaluate('document.querySelector("details").open=true');await wait('document.body.innerText.includes("Cerrado por: María Administradora")');
 await check('queries.some(q=>q.table==="profiles" && q.fields==="id,full_name" && q.ids.includes("00000000-0000-0000-0000-000000000002"))');
 await check('queries.some(q=>q.table==="work_order_point_changes" && q.fields==="old_points" && q.max===1 && q.orders[0][1].ascending===true)');
 await check('!/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(document.body.textContent)');await check('!calls.some(c=>c.name==="confirm_work_order_points")');
 await reset();await evaluate('model.profileError=true;seedClosedHistory()');await closed();await evaluate('document.querySelector("details").open=true');await wait('document.body.innerText.includes("Nombre no disponible")');
 await check('!document.body.textContent.includes("00000000-0000-0000-0000-000000000002")');
 for(const role of ['TECNICO_RED','SOPORTE']){
  await evaluate(`resetCase('ticket','${role}')`);await wait('!document.querySelector("section")');await check('!document.querySelector("form,input,button")');await check('!calls.some(c=>c.name==="confirm_work_order_points")');
 }
 await reset('installation');await evaluate('model.points=0');await evaluate('resetCase("installation","ADMIN");model.points=0');await wait('document.querySelector("input[type=number]")?.value==="0"');
 await check('document.querySelector("button[type=submit]").disabled');await change();await reason();await click();await closed();await wait('document.body.innerText.includes("Puntos iniciales: 0")');await check('model.points',5);
 assert.deepEqual(errors,[]);console.log('SINGLE_POINT_CLOSURE_BROWSER_PASS: '+checks+' assertions; real Vue, one click, synthetic data, no external network');
}finally{ws?.close();chrome.kill();await server.close();}
