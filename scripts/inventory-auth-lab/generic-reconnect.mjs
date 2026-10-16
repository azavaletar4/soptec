// Ensayo adicional acotado: caída real del reloj sin evento offline del navegador.
import assert from 'node:assert/strict';
import {spawn,fork} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config,root,runtime,wait} from './common.mjs';
config();const f=JSON.parse(readFileSync(runtime+'generic-fixture.json','utf8'));
let clock,chrome,ws;const external=[],exceptions=[];let reads=0,asyncError=null;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){clock=fork(join(root,'scripts/inventory-auth-lab/generic-clock.mjs'),[],{cwd:root,env:{...process.env,LAB_GENERIC_CLOCK:'1'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});await wait(async()=>{try{return (await fetch('http://127.0.0.1:54388/health')).ok;}catch{return false;}});}
try{
 await start();
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+mkdtempSync(join(tmpdir(),'generic-reconnect-')),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('Chrome timeout')),20000);chrome.once('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails?.text);
  if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('/api/campo-inventory/'))reads++;
  if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),ok=u.hostname==='127.0.0.1'&&['54381','54384'].includes(u.port);if(!ok)external.push(u.origin);void send(ok?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(ok?{}:{errorReason:'BlockedByClient'})},m.sessionId).catch(e=>{if(!e.message.includes('Invalid InterceptionId'))asyncError=e.message;});}
 };
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const page=(method,params={})=>send(method,params,sessionId);
 await page('Page.enable');await page('Page.bringToFront');await page('Runtime.enable');await page('Network.enable');await page('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const evaluate=async expression=>{const r=await page('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timeout '+expression);};
 await page('Page.navigate',{url:'http://127.0.0.1:54384/generic.html'});await until('document.querySelectorAll("#role option").length===4');
 await evaluate(`document.querySelector('#job').value='${f.jobs[1].id}';document.querySelector('#job').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#role').value='support';document.querySelector('#role').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#login').click()`);
 await until('document.querySelector("#state").textContent==="ready"');assert((await evaluate('document.querySelector("#results").textContent')).length>0);
 clock.kill('SIGTERM');await new Promise(r=>clock.once('exit',r));
 await until('document.querySelector("#state").textContent==="offline"');assert.equal(await evaluate('document.querySelector("#results").textContent'),'');
 const paused=reads;await delay(3500);assert.equal(reads,paused); // Fallan solo intentos del reloj, no lecturas protegidas.
 await start();await until('document.querySelector("#state").textContent==="ready"');
 assert.equal(reads-paused,3,'Reconectar debe producir una sola recarga de las tres vistas');
 assert((await evaluate('document.querySelector("#results").textContent')).length>0);
 assert.equal(external.length,0);assert.equal(exceptions.length,0);assert.equal(asyncError,null);
 writeFileSync(root+'docs/INVENTARIO-LAB-GENERICOS-RECONEXION.json',JSON.stringify({at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',status:'PASS',realJwtRole:'support',producerStopped:true,cacheCleared:true,readsWhileDisconnected:0,queriesOnReconnect:3,manualOfflineEvent:false,externalRequests:0,runtimeExceptions:0},null,2)+'\n');
 console.log('GENERIC_RECONNECT_PASS: caída real del productor limpia caché; reconexión automática con JWT real y una sola recarga.');
 await send('Browser.close');
}finally{ws?.close();chrome?.kill();clock?.kill('SIGTERM');if(clock)await Promise.race([new Promise(r=>clock.once('exit',r)),delay(1000)]);}
