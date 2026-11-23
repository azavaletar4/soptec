// Cola offline de cierres (campo/averias): valida que un rechazo DEFINITIVO
// (cierre administrativo ya confirmado, WorkOrderFinalError) se distinga de
// un fallo transitorio (red/sesion) y nunca se reintente solo, sin perder
// fotos/notas locales ni bloquear la sincronizacion de otras ordenes.
// Vite/store reales, IndexedDB real, transporte sintetico (supabase.rpc
// stub). Red externa bloqueada por CDP; sin Supabase/OLT/MikroTik reales.
import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://wo-finality-test.invalid';process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const root=realpathSync.native(process.cwd()),outDir='dist/wo-finality-browser-'+process.pid;
await build({configFile:false,root,plugins:[],resolve:{alias:{'@':join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://wo-finality-test.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic')},logLevel:'error',build:{outDir,rollupOptions:{input:join(root,'scripts/tests/work-order-finality-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:false}});
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-wo-finality-'));
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
 const reload=async()=>{await evaluate('window.ready=false');await c('Page.reload');for(let n=0;n<100;n++){if(await evaluate('window.ready===true'))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timeout esperando reload')};
 await c('Page.navigate',{url:base+'scripts/tests/work-order-finality-browser.html'});
 for(let n=0;n<100;n++){if(await evaluate('window.ready===true'))break;await new Promise(r=>setTimeout(r,50))}

 const fresh=async()=>{await evaluate(`(async()=>{await harness.closeCampoDatabase();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('smartrayco-campo');r.onsuccess=resolve;r.onerror=()=>reject(r.error)})})()`)};
 await fresh();

 // ---- isDefinitiveRejection: distingue WorkOrderFinalError de cualquier fallo transitorio ----
 const classify=await evaluate(`(async()=>{
   let finalCaught=null;
   harness.setFinal('ticket','job-final',true);
   try { await harness.assertWorkOrderMutable('ticket','job-final') } catch(e){ finalCaught=e }
   return {
     finalIsInstance: finalCaught instanceof harness.WorkOrderFinalError,
     finalMessage: finalCaught.message,
     classifiesFinal: harness.isDefinitiveRejection(finalCaught),
     classifiesGenericError: harness.isDefinitiveRejection(new Error('Failed to fetch')),
     classifiesPlainObject: harness.isDefinitiveRejection({code:'PGRST301',message:'JWT expired'}),
     classifiesNull: harness.isDefinitiveRejection(null),
   };
 })()`);
 assert.equal(classify.finalIsInstance,true);checks++;
 assert.match(classify.finalMessage,/Cierre administrativo definitivo/);checks++;
 assert.equal(classify.classifiesFinal,true);checks++;
 assert.equal(classify.classifiesGenericError,false);checks++;
 assert.equal(classify.classifiesPlainObject,false);checks++;
 assert.equal(classify.classifiesNull,false);checks++;

 // ---- Caso real: dos averias (6429c487/dbfa2d4a) con fotos+notas en cola,
 // una ya confirmada administrativamente (rechazo definitivo) y otra con un
 // corte de red pasajero (debe seguir reintentandose sola). ----
 await fresh();
 const seeded=await evaluate(`(async()=>{
   const photo=(txt)=>new File([txt],'evidencia.jpg',{type:'image/jpeg'});
   harness.setFinal('ticket','6429c487',true); // ya confirmado por un administrador
   const a=await harness.enqueueClosure({jobType:'ticket',jobId:'6429c487',clientId:'c1',contractId:'k1',targetStatus:'resolved',
     latitude:null,longitude:null,ontSerial:null,closureNotes:'Se reemplazo el conector, cliente conforme',
     photos:[{category:'evidencia_1',blob:photo('A'),fileName:'e1.jpg'},{category:'service_sheet',blob:photo('B'),fileName:'ficha.jpg'}],
     equipmentPhotos:[],signatureBlob:photo('FIRMA'),clientPhotoCategories:[],pendingApprovalCategories:[],
     motivoAveria:'other',motivoAveriaDetalle:'Conector dañado',justificacionCierre:null,potenciaDbm:null,
     napElementoId:null,zoneId:null,ontReplaced:false,installationAddress:null,clientCode:null});
   const b=await harness.enqueueClosure({jobType:'ticket',jobId:'dbfa2d4a',clientId:'c2',contractId:'k2',targetStatus:'resolved',
     latitude:null,longitude:null,ontSerial:null,closureNotes:'Reinicio de equipo',
     photos:[{category:'facade',blob:photo('C'),fileName:'facade.jpg'}],
     equipmentPhotos:[],signatureBlob:null,clientPhotoCategories:[],pendingApprovalCategories:[],
     motivoAveria:'other',motivoAveriaDetalle:null,justificacionCierre:null,potenciaDbm:null,
     napElementoId:null,zoneId:null,ontReplaced:false,installationAddress:null,clientCode:null});
   return {a:a.localId,b:b.localId};
 })()`);

 // Primer intento: 6429c487 ya es definitivo (rechazo); dbfa2d4a falla por
 // un corte de red pasajero (TypeError 'Failed to fetch', no definitivo).
 const firstFlush=await evaluate(`(async()=>{
   const visited=[];
   const r=await harness.flushQueue(async item=>{
     visited.push(item.jobId);
     if(item.jobId==='6429c487') await harness.assertWorkOrderMutable(item.jobType,item.jobId);
     if(item.jobId==='dbfa2d4a') throw new TypeError('Failed to fetch');
   });
   const q=await harness.listQueuedClosures();
   return {r,visited,states:q.map(i=>({job:i.jobId,rejectedFinal:!!i.rejectedFinal,error:i.lastError}))};
 })()`);
 assert.deepEqual(firstFlush.r,{synced:0,remaining:2});checks++;
 assert.deepEqual(firstFlush.visited,['6429c487','dbfa2d4a']);checks++; // ambas ordenes se intentan: una no bloquea a la otra
 assert.deepEqual(firstFlush.states.find(s=>s.job==='6429c487'),{job:'6429c487',rejectedFinal:true,error:classify.finalMessage});checks++;
 assert.equal(firstFlush.states.find(s=>s.job==='dbfa2d4a').rejectedFinal,false);checks++;

 // Segundo intento (reconexion: dbfa2d4a ahora sincroniza): el rechazo
 // definitivo NO se vuelve a enviar (se salta sin invocar submit), el
 // transitorio si se reintenta y esta vez sincroniza.
 const secondFlush=await evaluate(`(async()=>{
   const visited=[];
   const r=await harness.flushQueue(async item=>{ visited.push(item.jobId); if(item.jobId==='6429c487') await harness.assertWorkOrderMutable(item.jobType,item.jobId); });
   const q=await harness.listQueuedClosures();
   return {r,visited,remainingJobs:q.map(i=>i.jobId)};
 })()`);
 assert.deepEqual(secondFlush.r,{synced:1,remaining:1});checks++;
 assert.deepEqual(secondFlush.visited,['dbfa2d4a']);checks++; // 6429c487 NUNCA se reintenta solo
 assert.deepEqual(secondFlush.remainingJobs,['6429c487']);checks++;

 // Reinicio de la app (recarga real): el rechazo definitivo persiste en
 // IndexedDB con sus fotos y notas intactas, bit a bit.
 await reload();
 const afterRestart=await evaluate(`(async()=>{
   const q=await harness.listQueuedClosures();
   const item=q[0];
   return {
     count:q.length, job:item.jobId, rejectedFinal:!!item.rejectedFinal,
     notes:item.closureNotes, motivoDetalle:item.motivoAveriaDetalle,
     photo1:await item.photos[0].blob.text(), photo2:await item.photos[1].blob.text(),
     firma:await item.signatureBlob.text(),
   };
 })()`);
 assert.deepEqual(afterRestart,{count:1,job:'6429c487',rejectedFinal:true,notes:'Se reemplazo el conector, cliente conforme',motivoDetalle:'Conector dañado',photo1:'A',photo2:'B',firma:'FIRMA'});checks++;

 // Un tercer flush posterior tampoco lo toca (no se "cura" solo con el tiempo).
 const thirdFlush=await evaluate(`(async()=>{const visited=[];const r=await harness.flushQueue(async i=>visited.push(i.jobId));return {r,visited}})()`);
 assert.deepEqual(thirdFlush,{r:{synced:0,remaining:1},visited:[]});checks++;

 // discardFinalRejection: protegido contra borrar algo que NO sea un
 // rechazo definitivo confirmado (ninguna via "vacia" la cola a ciegas).
 await evaluate(`harness.enqueueClosure({jobType:'ticket',jobId:'pending-ok',clientId:null,contractId:null,targetStatus:'resolved',latitude:null,longitude:null,ontSerial:null,closureNotes:null,photos:[],equipmentPhotos:[],signatureBlob:null,clientPhotoCategories:[],pendingApprovalCategories:[],motivoAveria:null,motivoAveriaDetalle:null,justificacionCierre:null,potenciaDbm:null,napElementoId:null,zoneId:null,ontReplaced:false,installationAddress:null,clientCode:null})`);
 const guardedId=await evaluate(`(async()=>(await harness.listQueuedClosures()).find(i=>i.jobId==='pending-ok').localId)()`);
 const blockedDiscard=await evaluate(`(async()=>{try{await harness.discardFinalRejection(${JSON.stringify(guardedId)});return 'unexpected'}catch(e){return e.message}})()`);
 assert.match(blockedDiscard,/rechazo administrativo definitivo/);checks++;
 const stillThere=await evaluate(`(async()=>(await harness.listQueuedClosures()).length)()`);
 assert.equal(stillThere,2);checks++;

 // Ahora si: descartar el que SI es un rechazo definitivo ya revisado.
 const finalId=await evaluate(`(async()=>(await harness.listQueuedClosures()).find(i=>i.jobId==='6429c487').localId)()`);
 await evaluate(`harness.discardFinalRejection(${JSON.stringify(finalId)})`);
 const afterDiscard=await evaluate(`(async()=>(await harness.listQueuedClosures()).map(i=>i.jobId))()`);
 assert.deepEqual(afterDiscard,['pending-ok']);checks++;

 // Dueño de sesion: un pendiente de OTRO tecnico no puede descartarse desde esta sesion.
 await evaluate(`harness.enqueueClosure({jobType:'ticket',jobId:'owned-by-another',actorId:'other-tech',clientId:null,contractId:null,targetStatus:'resolved',latitude:null,longitude:null,ontSerial:null,closureNotes:null,photos:[],equipmentPhotos:[],signatureBlob:null,clientPhotoCategories:[],pendingApprovalCategories:[],motivoAveria:null,motivoAveriaDetalle:null,justificacionCierre:null,potenciaDbm:null,napElementoId:null,zoneId:null,ontReplaced:false,installationAddress:null,clientCode:null})`);
 const otherOwnerId=await evaluate(`(async()=>(await harness.listQueuedClosures()).find(i=>i.jobId==='owned-by-another').localId)()`);
 const ownerBlocked=await evaluate(`(async()=>{try{await harness.discardFinalRejection(${JSON.stringify(otherOwnerId)},'me');return 'unexpected'}catch(e){return e.message}})()`);
 assert.match(ownerBlocked,/no corresponde a tu sesión/);checks++;

 assert.equal(errors.length,0);checks++;
 console.log(JSON.stringify({passed:checks,synthetic:true,externalNetworkBlocked:true,productionWrites:0}));
} catch(e){console.error('WORK_ORDER_FINALITY_BROWSER_FAIL: '+e.message+'; paso='+lastStep+'; errores='+JSON.stringify(errors));process.exitCode=1}
finally {if(ws?.readyState===1)ws.send(JSON.stringify({id:++sequence,method:'Browser.close'}));ws?.close();chrome.kill();await Promise.race([new Promise(r=>server.httpServer.close(r)),new Promise(r=>setTimeout(r,2000))]);process.exit(process.exitCode??0)}
