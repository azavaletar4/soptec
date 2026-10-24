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
const profile=await mkdtemp(join(tmpdir(),'rayco-points-'));
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
    window.calls=[];window.fail=false;
    const real=window.fetch.bind(window);window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin)return real(input,init);
      if(url.pathname.endsWith('/work_order_point_review'))return new Response(JSON.stringify({
        points:5,status:window.reviewClosed||'open',technicalCompletedAt:window.reviewClosed?'2026-11-12T15:00:00Z':null,
        historical:false,finished:!!window.reviewClosed,crew:[{technicianId:'synthetic',name:'Técnico',role:'leader'}],token:'synthetic-review',
        confirmation:window.reviewClosed?{id:'synthetic-confirmation',points:5,crew:[{technicianId:'synthetic',name:'Técnico',role:'leader'}],confirmed_at:'2026-11-13T15:00:00Z',confirmed_by:'synthetic-admin',invalidated_at:null}:null,lastConfirmation:null
      }),{headers:{'content-type':'application/json'}});
      if(url.pathname.endsWith('/work_order_point_changes'))return new Response('[]',{headers:{'content-type':'application/json'}});
      if(url.pathname.endsWith('/adjust_work_order_points')){
        window.calls.push(JSON.parse(init.body));
        return new Response(window.fail?JSON.stringify({message:'La orden ya está cerrada'}):null,{status:window.fail?400:204,headers:{'content-type':'application/json'}});
      }
      throw Error('External network blocked');
    };
  `});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);};
  await c('Page.navigate',{url:base+'scripts/tests/work-order-points-browser.html'});
  await wait('window.ready && document.querySelector("form")');
  for(const type of ['ticket','installation','routine']) {
    await evaluate(`setCase('ADMIN','open','${type}')`);await wait('document.querySelector("form")');
    assert.equal(await evaluate(`(()=>{const i=document.querySelector('input[type=number]');i.value='8';i.dispatchEvent(new Event('input',{bubbles:true}));return i.checkValidity();})()`),true);checks++;
    const before=await evaluate('calls.length');
    await evaluate(`document.querySelector('form').requestSubmit()`);
    assert.equal(await evaluate('calls.length'),before);checks++;
    await evaluate(`(()=>{const i=document.querySelector('input[maxlength]');i.value='Ajuste de prueba';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form').requestSubmit();})()`);
    await wait('window.saved===8');
    assert.equal(await evaluate('calls.at(-1).p_expected_points'),5);checks++;
    assert.equal(await evaluate('calls.at(-1).p_job_type'),type);checks++;
    await evaluate('window.saved=null');
  }
  for(const role of ['TECNICO_RED','SOPORTE']) {await evaluate(`setCase('${role}','open')`);await wait('!document.querySelector("form")');checks++;}
  // Estas fixtures terminales YA tienen confirmación vigente.
  for(const status of ['resolved','closed','completed','cancelled']) {await evaluate(`window.reviewClosed='${status}';setCase('SUPERADMIN','${status}')`);await wait('!document.querySelector("form")');checks++;}
  assert.deepEqual(errors,[]);checks++;
  console.log(`WORK_ORDER_POINTS_BROWSER_OK: ${checks} checks; synthetic data; external network blocked`);
} finally {if(ws)ws.close();chrome.kill();await server.close();}
