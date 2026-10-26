// Real Vue components, synthetic SDK responses, all external network blocked.
import {createServer} from 'vite';import {spawn} from 'node:child_process';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://pending-points.invalid';process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});await server.listen();const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-pending-points-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,seq=0,checks=0;const pending=new Map(),errors=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome timeout')),20000);let log='';chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method+' '+(params.expression||'').slice(0,180)));},45000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 ws.addEventListener('message',async e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;await c(request.url.startsWith(base)?'Fetch.continueRequest':'Fetch.failRequest',request.url.startsWith(base)?{requestId}:{requestId,errorReason:'BlockedByClient'});}});
 await c('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.calls=[];const real=window.fetch.bind(window);
  const crew=[{technicianId:'00000000-0000-0000-0000-000000000003',name:'Líder ficticio',role:'leader'},{technicianId:'00000000-0000-0000-0000-000000000007',name:'Ayudante ficticio',role:'support'}];
  const confirmation=()=>({id:'lab-final',points:model.points,crew:crew.map(m=>({...m,points:model.points/2,netPoints:model.points/2})),confirmed_by:'lab-admin',confirmed_at:'2026-10-26T05:00:00Z',invalidated_at:null});
  window.fetch=async(input,init={})=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin===location.origin)return real(input,init);
   const table=url.pathname.split('/').at(-1),body=init.body?JSON.parse(init.body):null;calls.push({table,body});
   const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
   if(table==='work_order_point_changes')return json(model.history);
   if(table==='work_order_point_review')return json({points:model.points,status:model.type==='ticket'?'resolved':'completed',technicalCompletedAt:'2026-10-26T04:32:23Z',historical:model.historical,canAdjustPoints:model.canAdjust&&!model.confirmed,finished:true,crew,recurrencePenalty:0,definitiveClosure:true,token:'revision-'+model.version,confirmation:model.confirmed?confirmation():null,lastConfirmation:null});
   if(table==='my_field_order_points')return json({jobPoints:model.points,configuredPoints:model.points,personalPoints:model.points/2,crewSize:2,status:'completed',asOf:'2026-10-26T05:00:00Z'});
   if(table==='adjust_work_order_points'){
    if(body.p_expected_points!==model.points)return json({message:'El puntaje cambió'},400);
    if(!body.p_reason?.trim())return json({message:'Motivo obligatorio'},400);
    model.history.push({id:'lab-adjust',old_points:model.points,new_points:body.p_points,changed_by:'lab-admin',changed_at:'2026-10-26T05:00:00Z',reason:body.p_reason});model.points=body.p_points;model.version++;return new Response(null,{status:204});
   }
   if(table==='confirm_work_order_points'){
    if(body.p_expected_token!=='revision-'+model.version)return json({message:'La orden cambió; recarga'},400);
    if(body.p_points!==model.points&&!body.p_reason?.trim())return json({message:'Motivo obligatorio'},400);
    if(body.p_points!==model.points)model.history.push({id:'lab-adjust-confirm',old_points:model.points,new_points:body.p_points,reason:body.p_reason});
    model.points=body.p_points;model.confirmed=true;model.version++;return json(confirmation());
   }
   throw Error('External request blocked: '+table);
  };
 `});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw Error('Timeout: '+expression);};
 const check=async(expression,expected=true)=>{assert.deepEqual(await evaluate(expression),expected,expression);checks++;};
 console.log('LOCAL_BROWSER_NAVIGATE');await c('Page.navigate',{url:base+'scripts/tests/pending-point-adjustment-browser.html'});await wait('window.ready && document.querySelector("input[type=number]")?.value==="2"');
 for(const role of ['ADMIN','SUPERADMIN'])for(const type of ['ticket','installation','routine']){
  console.log('MODAL_BEGIN '+role+' '+type);await evaluate(`resetCase('${type}','${role}')`);await wait('document.querySelector("input[type=number]")?.value==="2"');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Revisar confirmación")).click()');await wait('document.querySelector("[role=dialog] input[type=number]")');
  await check('document.querySelector("[role=dialog]").innerText.includes("Puntos vigentes de la orden: 2 pts")');
  await evaluate('(()=>{const n=document.querySelector("[role=dialog] input[type=number]");n.value="5";n.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await wait('document.querySelector("[role=dialog] input[maxlength]")');
  await check('document.querySelector("[role=dialog]").innerText.includes("2.5 pts netos")');
  await check('document.querySelector("[role=dialog]").innerText.includes("Líder ficticio") && document.querySelector("[role=dialog]").innerText.includes("Ayudante ficticio")');
  await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").click()');await check('document.querySelector("[role=dialog] button[type=submit]").disabled');
  await evaluate('(()=>{const r=document.querySelector("[role=dialog] input[maxlength]");r.value="Revisión de trabajo terminado";r.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await wait('!document.querySelector("[role=dialog] input[type=checkbox]").checked');
  await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").click()');await wait('!document.querySelector("[role=dialog] button[type=submit]").disabled');
  await evaluate('(()=>{const f=document.querySelector("[role=dialog] form");f.requestSubmit();f.requestSubmit();})()');
  await wait('!document.querySelector("[role=dialog]") && document.body.innerText.includes("Puntos confirmados: 5")');
  await check('calls.filter(c=>c.table==="confirm_work_order_points").length',1);await check('model.history.length',1);await check('document.querySelector("input[type=number]")===null');console.log('MODAL_PASS '+role+' '+type);
 }
 // A converted Alta may enter the modal at zero, but cannot confirm zero.
 await evaluate('resetCase("installation","ADMIN");model.points=0');await wait('document.querySelector("input[type=number]")?.value==="0"');
 await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Revisar confirmación")).click()');await wait('document.querySelector("[role=dialog] input[type=number]")');
 await check('document.querySelector("[role=dialog] button[type=submit]").disabled');
 await evaluate('(()=>{const n=document.querySelector("[role=dialog] input[type=number]");n.value="5";n.dispatchEvent(new Event("input",{bubbles:true}));})()');await wait('document.querySelector("[role=dialog] input[maxlength]")');
 await evaluate('(()=>{const r=document.querySelector("[role=dialog] input[maxlength]");r.value="Asignación inicial";r.dispatchEvent(new Event("input",{bubbles:true}));})()');await wait('!document.querySelector("[role=dialog] input[type=checkbox]").checked');
 await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").click()');await wait('!document.querySelector("[role=dialog] button[type=submit]").disabled');await evaluate('document.querySelector("[role=dialog] form").requestSubmit()');await wait('model.confirmed && !document.querySelector("[role=dialog]")');await check('model.points',5);
 // Saving separately uses the reviewed value, not a stale parent prop.
 await evaluate('resetCase("ticket","ADMIN");staleProps()');await wait('document.querySelector("input[type=number]")?.value==="3"');
 await evaluate('(()=>{const n=document.querySelector("input[type=number]");n.value="5";n.dispatchEvent(new Event("input",{bubbles:true}));const r=document.querySelector("input[maxlength]");r.value="Revisión separada";r.dispatchEvent(new Event("input",{bubbles:true}));})()');
 await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Guardar puntaje")).click()');await wait('model.points===5');
 await check('calls.find(c=>c.table==="adjust_work_order_points").body.p_expected_points',3);
 for(const role of ['TECNICO_RED','SOPORTE']){await evaluate(`resetCase('ticket','${role}')`);await wait('!document.querySelector("input[type=number]")');await check('!document.body.innerText.includes("Revisar confirmación administrativa")');await check('!calls.some(c=>["adjust_work_order_points","confirm_work_order_points"].includes(c.table))');}
 await evaluate('resetCase();model.canAdjust=false');await wait('document.body.innerText.includes("Puntaje histórico protegido")');await check('document.querySelector("input[type=number]")===null');
 await check('campoPointsWiring',{orderCards:1,contributionCards:0});
 for(const uid of ['00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000007']){
  await evaluate(`resetCase('ticket','TECNICO_RED','field','${uid}')`);await wait('document.body.innerText.includes("Puntos totales: 2 pts")');
  await check('document.querySelectorAll("section").length',1);await check('!document.body.innerText.includes("Mi aporte") && !document.body.innerText.includes("administrativa") && !document.body.innerText.includes("noviembre")');
  await evaluate('model.points=5;emitFieldUpdate()');await wait('document.body.innerText.includes("Puntos totales: 5 pts") && document.body.innerText.includes("Tu parte asignada: 2.5 pts")');
  await check('document.querySelector("input")==null');await check('!calls.some(c=>["adjust_work_order_points","confirm_work_order_points","my_field_job_points"].includes(c.table))');
 }
 assert.deepEqual(errors,[]);console.log(`PENDING_POINT_ADJUSTMENT_BROWSER_PASS: ${checks} assertions; actual Vue modal and field card, loopback only, synthetic API`);
}finally{ws?.close();chrome.kill();await server.close();}
