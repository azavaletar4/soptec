// Navegador real: login GoTrue y peticiones reales, sin interceptar/responder datos.
import { spawn } from 'node:child_process';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { root } from './common.mjs';
const profile=await mkdtemp(join(tmpdir(),'inventory-real-auth-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Chrome timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let seq=0;const pending=new Map(),exceptions=[],external=[],responses=[];
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails?.text);
  if(m.method==='Network.responseReceived'&&m.params.response.url.includes('/api/campo-inventory/'))responses.push({status:m.params.response.status});
  if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),allowed=u.hostname==='127.0.0.1'&&['54381','54384'].includes(u.port);if(!allowed)external.push(u.origin);void send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(allowed?{}:{errorReason:'BlockedByClient'})},m.sessionId);}
 };
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI timeout: '+expression+'; estado='+await evaluate('document.querySelector("#status")?.textContent')+'; externas='+JSON.stringify(external));};
 await c('Page.navigate',{url:'http://127.0.0.1:54384/'});await until('document.querySelectorAll("#role option").length===4');
 const results=[];
 for(const role of ['leader','support','outsider','removed']){
  await evaluate(`document.querySelector('#role').value='${role}';document.querySelector('#role').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#login').click()`);
  await until(`document.querySelector('#status').textContent==='Sesión Auth real: ${role}'`);
  for(const index of [0,1]){
   await evaluate(`document.querySelector('#job').selectedIndex=${index};document.querySelector('#job').dispatchEvent(new Event('change',{bubbles:true}))`);
   const start=responses.length;
   await evaluate(`document.querySelector('#read').click()`);
   const allowed=['leader','support'].includes(role);
   await until(`document.querySelector('#status').textContent.startsWith('${allowed?'Lectura autorizada':'Denegado:'}')`);
   await until(`document.querySelector('#results').textContent.${allowed?'includes("LAB-")':'length===0'}`);
   // Cada lectura ejecuta materials, assigned y pending en paralelo.
   for(let n=0;n<30&&responses.length<start+3;n++)await new Promise(r=>setTimeout(r,100));
   assert.equal(responses.length-start,3);assert(responses.slice(start).every(r=>r.status===(allowed?200:403)));
   results.push({role,job:index===0?'installation':'ticket',status:allowed?200:403,realLogin:true});
   console.log(`PASS UI Auth real ${role} ${index===0?'Alta':'Avería'} ${allowed?200:403}`);
  }
 }
 assert.equal(exceptions.length,0,JSON.stringify(exceptions));assert.equal(external.length,0,JSON.stringify(external));
 await writeFile(root+'docs/INVENTARIO-LAB-AUTH-NAVEGADOR.json',JSON.stringify({at:new Date().toISOString(),results,externalRequests:external.length,runtimeExceptions:exceptions.length,simulatedSessions:false},null,2)+'\n');
 await send('Browser.close');
}finally{ws?.close();chrome.kill();}
