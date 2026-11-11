// Vue/store reales, transporte sintético. Red remota dirigida a un proxy
// cerrado en loopback; HTTPS bloqueado también por CDP. Sin red productiva.
import { build, preview } from 'vite';
import vue from '@vitejs/plugin-vue';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://iptv-test.invalid';process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const root=realpathSync.native(process.cwd()),outDir='dist/iptv-browser-'+process.pid;
await build({configFile:false,root,plugins:[vue()],resolve:{alias:{'@':join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://iptv-test.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic')},logLevel:'error',build:{outDir,rollupOptions:{input:join(root,'scripts/tests/iptv-mode-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:false}});
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-iptv-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,sequence=0,checks=0,lastStep='inicio';const pending=new Map(),errors=[];
try {
 const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Chrome timeout')),20000);let log='';chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1])}});chrome.on('error',reject)});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP connection timeout')),10000);ws.onopen=()=>{clearTimeout(timer);resolve()};ws.onerror=e=>{clearTimeout(timer);reject(e)}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},method==='Page.navigate'?30000:10000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params,sessionId}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)};
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Network.setBlockedURLs',{urls:['https://*']});
 const evaluate=async expression=>{lastStep=expression;const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let n=0;n<160;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timeout: '+expression)};
 await c('Page.navigate',{url:base+'scripts/tests/iptv-mode-browser.html'});await until('window.ready===true');
 assert.equal(await evaluate('document.querySelector("select").value'),'');checks++;
 assert.equal(await evaluate('document.querySelectorAll("select option").length'),4);checks++;
 await evaluate('document.querySelector("button").click()');await until('harness.error.value.includes("Selecciona")');
 assert.equal(await evaluate('harness.calls.filter(c=>c.update).length'),0);checks++;
 for(const mode of ['smart_tv_app','customer_device','rayco_tv_box']){
  await evaluate(`(async()=>{harness.reset();harness.mode.value=null;harness.calls.length=0;await harness.nextTick();const select=document.querySelector('select');select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('change',{bubbles:true}));await harness.nextTick();document.querySelector('button').click()})()`);
  await until('harness.row.status==="completed"');
  assert.equal(await evaluate('harness.row.iptv_installation_mode'),mode);checks++;
  assert.deepEqual(await evaluate('harness.calls.filter(c=>c.update).map(c=>c.update)'),[{status:'completed',iptv_installation_mode:mode}]);checks++;
  await evaluate('harness.calls.length=0;document.querySelector("button").click()');await new Promise(r=>setTimeout(r,100));
  assert.equal(await evaluate('harness.calls.length'),0);checks++;
 }
 await evaluate('(async()=>{harness.disabled.value=true;await harness.nextTick()})()');assert.equal(await evaluate('document.querySelector("select").disabled'),true);checks++;
 // Caracteriza el esquema REAL: dos createStore con el mismo DB y sin
 // upgrade no crean automáticamente el segundo object store (riesgo previo).
 const fresh=await evaluate(`(async()=>{
  const photo=new File(['synthetic-photo'],'evidence.txt',{type:'text/plain'});
  await harness.saveDraft('publication-synthetic',{closureForm:{closureNotes:'Borrador anterior'},closurePhotos:{facade:photo},equipmentEntries:[],signatureBlob:null});
  try{await harness.enqueueClosure({jobType:'installation',jobId:'fresh-synthetic',photos:[],equipmentPhotos:[]});return 'unexpected-success'}catch(e){return e.name}
 })()`);
 assert.equal(fresh,'NotFoundError');checks++;
 await evaluate('window.ready=false');await c('Page.reload');await until('window.ready===true');
 assert.equal(await evaluate('(async()=>{const d=await harness.loadDraft("publication-synthetic");return d.closurePhotos.facade.size})()'),15);checks++;
 // Solo se reinicia la base sintética del perfil efímero y origen loopback.
 // Recargar primero cierra conexiones previas; nunca borrar datos del técnico.
 await evaluate('window.ready=false');await c('Page.reload');await until('window.ready===true');
 const reverse=await evaluate(`(async()=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('smartrayco-campo');r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Fixture bloqueada'))});
  await harness.enqueueClosure({jobType:'installation',jobId:'queue-first-synthetic',photos:[],equipmentPhotos:[]});
  try{await harness.saveDraft('publication-synthetic',{closureForm:{closureNotes:'Prueba'}});return 'unexpected-success'}catch(e){return e.name}
 })()`);
 assert.equal(reverse,'NotFoundError');checks++;
 await evaluate('window.ready=false');await c('Page.reload');await until('window.ready===true');
 assert.equal(await evaluate('(async()=>{return (await harness.listQueuedClosures())[0].jobId})()'),'queue-first-synthetic');checks++;
 await evaluate('window.ready=false');await c('Page.reload');await until('window.ready===true');
 // Perfil coherente de prueba con ambos stores: prepara el fixture, no
 // modifica el inicializador de aplicación ni oculta el fallo anterior.
 await evaluate(`(async()=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('smartrayco-campo');r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Fixture bloqueada'))});
  await new Promise((resolve,reject)=>{const r=indexedDB.open('smartrayco-campo',1);r.onupgradeneeded=()=>{r.result.createObjectStore('drafts');r.result.createObjectStore('closures')};r.onsuccess=()=>{r.result.close();resolve()};r.onerror=()=>reject(r.error)});
 })()`);
 // Persistencia real con esquema coherente, conservada al recargar.
 await evaluate(`(async()=>{
  const photo=new File(['synthetic-photo'],'evidence.txt',{type:'text/plain'});
  await harness.saveDraft('publication-synthetic',{closureForm:{closureNotes:'Borrador anterior',clientCode:'TEST'},closurePhotos:{facade:photo},equipmentEntries:[],signatureBlob:null});
  await harness.enqueueClosure({jobType:'installation',jobId:'old-synthetic',clientId:'c',contractId:'k',photos:[{category:'facade',blob:photo,fileName:photo.name}],equipmentPhotos:[]});
  await new Promise(r=>setTimeout(r,25));
  await harness.enqueueClosure({jobType:'installation',jobId:'new-synthetic',clientId:'c',contractId:'k2',iptvInstallationMode:'customer_device',photos:[],equipmentPhotos:[]});
  window.ready=false;
 })()`);
 await c('Page.reload');await until('window.ready===true');
 const persisted=await evaluate(`(async()=>{const d=await harness.loadDraft('publication-synthetic');const q=await harness.listQueuedClosures();return {note:d.closureForm.closureNotes,code:d.closureForm.clientCode,photo:d.closurePhotos.facade.size,draftHasMode:'iptvInstallationMode' in d.closureForm,jobs:q.map(i=>i.jobId),oldHasMode:'iptvInstallationMode' in q[0],oldPhoto:q[0].photos[0].blob.size,newMode:q[1].iptvInstallationMode}})()`);
 assert.equal(persisted.note,'Borrador anterior');assert.equal(persisted.code,'TEST');checks++;
 assert.equal(persisted.photo,15);assert.equal(persisted.draftHasMode,false);checks++;
 assert.deepEqual(persisted.jobs,['old-synthetic','new-synthetic']);assert.equal(persisted.oldHasMode,false);assert.equal(persisted.oldPhoto,15);assert.equal(persisted.newMode,'customer_device');checks++;
 const blocked=await evaluate(`(async()=>{const visited=[];const result=await harness.flushQueue(async item=>{visited.push(item.jobId);if(!item.iptvInstallationMode)throw new Error('Falta modalidad IPTV')});return {result,visited,errors:(await harness.listQueuedClosures()).map(i=>i.lastError??null)}})()`);
 assert.deepEqual(blocked.result,{synced:0,remaining:2});assert.deepEqual(blocked.visited,['old-synthetic']);assert.equal(blocked.errors[0],'Falta modalidad IPTV');assert.equal(blocked.errors[1],null);checks++;
 await evaluate(`(async()=>{await harness.clearDraft('publication-synthetic');for(const i of await harness.listQueuedClosures())await harness.removeQueuedClosure(i.localId)})()`);
 assert.equal(errors.length,0);checks++;
 console.log(JSON.stringify({passed:checks,synthetic:true,externalNetworkBlocked:true,productionWrites:0}));
} catch(e){console.error('IPTV_BROWSER_FAIL: '+e.message+'; paso='+lastStep+'; errores='+JSON.stringify(errors));process.exitCode=1}
finally {if(ws?.readyState===1)ws.send(JSON.stringify({id:++sequence,method:'Browser.close'}));ws?.close();chrome.kill();await Promise.race([new Promise(r=>server.httpServer.close(r)),new Promise(r=>setTimeout(r,2000))]);process.exit(process.exitCode??0)}
