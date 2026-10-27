// Only loopback Vite. Every external request is blocked; API responses synthetic.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://points.invalid';
process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});
await server.listen();
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-field-points-'));
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
    window.calls=[];window.points=10;window.denied=false;window.readfail=false;
    window.existingSignature=null;window.closureFail=false;window.savedClosures=[];
    const real=window.fetch.bind(window);window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin)return real(input,init);
      const table=url.pathname.split('/').at(-1),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
      window.calls.push({table,method,body});
      const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
      if(table==='work_order_is_final')return json(!!window.finalOrder);
      if(table==='my_field_order_points'){
        if(window.readfail)return json({message:'Prueba de error de lectura'},400);
        return json(window.denied?null:window.pointsResponse||{jobPoints:window.points,configuredPoints:window.points,personalPoints:window.points/2,crewSize:2,status:'in_progress',asOf:new Date().toISOString()});
      }
      if(table==='assert_material_closure_ready')return json(null);
      if(table==='work_order_closures'){
        if(method==='GET'){
          if(window.closureFail)return json({message:'No se pudo leer la firma anterior'},400);
          return json(window.existingSignature?[{signature_path:window.existingSignature}]:[]);
        }
        if(method==='POST'){window.savedClosures.push(body);return new Response(null,{status:204});}
      }
      if(['tickets','installations','routines'].includes(table))return json({id:'10000000-0000-0000-0000-000000000001',...body});
      if(table==='work_order_photos')return json([]);
      throw Error('External or unexpected operation blocked: '+url.pathname);
    };
  `});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let n=0;n<220;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);};
  await c('Page.navigate',{url:base+'scripts/tests/field-order-points-browser.html'});
  await wait('window.ready && document.body.innerText.includes("10 pts")');

  for(const kind of ['ticket','installation','routine']) {
    await evaluate(`setCase('${kind}');window.pointsResponse={jobPoints:4,configuredPoints:4,personalPoints:2,creditedPoints:2,recurrencePenalty:0,scoringState:'confirmed',creditedAt:'2026-11-01T05:00:00Z',crewSize:2,status:'confirmed'};emitOrderChange();`);
    await wait('document.body.innerText.includes("Tu aporte neto: 2 pts")');checks++;
    assert.ok(await evaluate('document.body.innerText.includes("Puntos confirmados de la orden: 4 pts")'));checks++;
    assert.ok(await evaluate('document.body.innerText.includes("per\u00edodo de confirmaci\u00f3n")'));checks++;
    await evaluate("window.pointsResponse={...window.pointsResponse,jobPoints:12,personalPoints:6,recurrencePenalty:2.5,creditedPoints:3.5};emitOrderChange()");
    await wait('document.body.innerText.includes("Tu aporte neto: 3.5 pts")');checks++;
    assert.ok(await evaluate('document.body.innerText.includes("Descuento por reincidencia: 2.5 pts")'));checks++;
    await evaluate("window.pointsResponse={...window.pointsResponse,scoringState:'pending',creditedPoints:0};emitOrderChange()");
    await wait('document.body.innerText.includes("Pendiente de confirmaci\u00f3n administrativa")');checks++;
    assert.equal(await evaluate('document.body.innerText.includes("Tu aporte neto")'),false);checks++;
    await evaluate("window.pointsResponse=undefined;emitOrderChange()");
    await wait('document.body.innerText.includes("Tu parte asignada")');checks++;
  }
  assert.equal(await evaluate('calls.every(c=>c.table==="my_field_order_points")'),true);checks++;
  assert.deepEqual(errors,[]);checks++;
  console.log('NOVEMBER_POINTS_BROWSER_OK: '+checks+' checks; synthetic responses; external requests blocked; no writes');
} finally {if(ws)ws.close();chrome.kill();await server.close();}
