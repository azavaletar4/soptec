// Only loopback Vite. Every external request is blocked; API responses synthetic.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});
await server.listen();
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-point-confirmations-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;let seq=0;const pending=new Map();const errors=[];let checks=0;
try {
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Chrome timeout')),20000);let log='';
    chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    chrome.on('error',reject);
  });
  ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const c=(method,params={})=>send(method,params,sessionId);
  await c('Page.enable');await c('Runtime.enable');
  await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  ws.addEventListener('message',async e=>{
    const m=JSON.parse(e.data);if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request}=m.params;
    if(request.url.startsWith(base))await c('Fetch.continueRequest',{requestId});
    else await c('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
  });
  await c('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.calls=[];window.points=12;window.version=1;window.confirmed=false;window.stale=false;
    window.scenario={status:'open',type:'ticket'};window.reviewReads=0;
    const crew=[{technicianId:'00000000-0000-0000-0000-000000000003',name:'Ana',role:'leader'},{technicianId:'00000000-0000-0000-0000-000000000004',name:'Luis',role:'support'}];
    const confirmation=()=>({id:'synthetic-confirmation',points:window.points,crew,confirmed_by:'00000000-0000-0000-0000-000000000002',confirmed_at:'2026-11-13T15:00:00Z',invalidated_at:null,invalidation_reason:null});
    const real=window.fetch.bind(window);window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin)return real(input,init);
      const table=url.pathname.split('/').at(-1),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
      window.calls.push({table,method,body});
      const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
      if(table==='work_order_point_changes')return json([]);
      if(table==='work_order_point_review'){
        window.reviewReads++;
        return json({points:window.points,status:scenario.status,technicalCompletedAt:['resolved','closed','completed'].includes(scenario.status)?'2026-11-12T15:00:00Z':null,
          historical:false,finished:['resolved','closed','completed'].includes(scenario.status),crew,token:'review-'+window.version,
          confirmation:window.confirmed?confirmation():null,lastConfirmation:window.confirmed?confirmation():null});
      }
      if(table==='confirm_work_order_points'){
        if(!body.p_confirmed)return json({message:'Falta confirmación explícita'},400);
        if(window.stale || body.p_expected_token!=='review-'+window.version)return json({message:'La orden o cuadrilla cambió; recarga la revisión'},400);
        window.points=body.p_points;window.confirmed=true;window.version++;
        return json(confirmation());
      }
      if(table==='adjust_work_order_points'){
        window.points=body.p_points;window.version++;return new Response(null,{status:204});
      }
      throw Error('External network blocked: '+table);
    };
  `});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);};
  await c('Page.navigate',{url:base+'scripts/tests/work-order-points-browser.html'});
  await wait('window.ready && document.querySelector("form")');
  for(const role of ['ADMIN','SUPERADMIN'])for(const type of ['ticket','installation','routine']) {
    const status=type==='ticket'?'resolved':'completed';
    await evaluate(`window.points=12;window.confirmed=false;window.stale=false;window.version++;window.scenario={status:'${status}',type:'${type}'};setCase('${role}','${status}','${type}')`);
    await wait('document.querySelector("input[type=number]")?.value==="12"');
    const before=await evaluate('calls.filter(c=>c.table==="confirm_work_order_points").length');
    await evaluate(`(()=>{const n=document.querySelector('input[type=number]');n.value='18';n.dispatchEvent(new Event('input',{bubbles:true}));const r=document.querySelector('input[maxlength]');r.value='Ajuste revisado';r.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Revisar confirmación')).click();})()`);
    await wait('document.querySelector("[role=dialog]")');
    assert.equal(await evaluate('document.querySelector("[role=dialog]").innerText.includes("18 pts")'),true);checks++;
    assert.equal(await evaluate('document.querySelector("[role=dialog]").innerText.includes("Ana") && document.querySelector("[role=dialog]").innerText.includes("Luis") && document.querySelector("[role=dialog]").innerText.includes("9 pts")'),true);checks++;
    assert.equal(await evaluate('document.querySelector("[role=dialog] button[type=submit]").disabled'),true);checks++;
    assert.equal(await evaluate('calls.filter(c=>c.table==="confirm_work_order_points").length'),before);checks++;
    await evaluate(`(()=>{document.querySelector('[role=dialog] input[type=checkbox]').click();const f=document.querySelector('[role=dialog] form');f.requestSubmit();f.requestSubmit();})()`);
    await wait('document.body.innerText.includes("Puntos confirmados: 18") && !document.querySelector("[role=dialog]")');
    assert.equal(await evaluate('calls.filter(c=>c.table==="confirm_work_order_points").length'),before+1);checks++;
    assert.equal(await evaluate('calls.filter(c=>c.table==="confirm_work_order_points").at(-1).body.p_reason'), 'Ajuste revisado');checks++;
    assert.equal(await evaluate('calls.filter(c=>c.table==="confirm_work_order_points").at(-1).body.p_job_type'),type);checks++;
    assert.equal(await evaluate('!!document.querySelector("input[type=number]")'),false);checks++;
  }
  await evaluate('window.points=12;window.confirmed=false;window.version++;window.scenario={status:"resolved",type:"ticket"};setCase("ADMIN","resolved","ticket")');
  await wait('document.querySelector("input[type=number]")?.value==="12"');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Revisar confirmación")).click()');
  await wait('document.querySelector("[role=dialog]")');
  await evaluate('window.version++;document.querySelector("[role=dialog] input[type=checkbox]").click();document.querySelector("[role=dialog] form").requestSubmit()');
  await wait('document.querySelector("[role=dialog]").innerText.includes("cuadrilla cambió")');
  assert.equal(await evaluate('window.confirmed'),false);checks++;
  await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent.includes("Volver")).click();[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Actualizar revisión")).click()');
  await wait('!document.querySelector("[role=dialog]") && document.querySelector("input[type=number]")?.value==="12"');
  for(const role of ['TECNICO_RED','SOPORTE']){
    await evaluate(`setCase('${role}','resolved','ticket')`);
    await wait('!document.querySelector("input[type=number]") && ![...document.querySelectorAll("button")].some(b=>b.textContent.includes("Revisar confirmación"))');checks++;
  }
  assert.equal(await evaluate('calls.some(c=>c.method==="PATCH")'),false);checks++;
  assert.deepEqual(errors,[]);checks++;
  console.log(`POINT_CONFIRMATIONS_BROWSER_OK: ${checks} checks; real Vue editor, synthetic API, external network blocked`);
} finally {if(ws)ws.close();chrome.kill();await server.close();}
