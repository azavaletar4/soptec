// App de Campo: "Failed to write blobs (InvalidBlob)" al cerrar averias con
// fotos. Causa real: un File capturado con <input type="file" capture>
// (camara nativa en Android) puede seguir respaldado por un URI de
// contenido temporal; guardarlo directo en IndexedDB (cola offline,
// borrador local) puede fallar con ese error nativo si Android ya liberó
// ese archivo — no es un problema de Supabase. La correccion materializa
// cada Blob/File en memoria pura ANTES de escribir a IndexedDB (safeBlob.ts),
// tanto al capturar la foto (CampoTrabajoDetailView.vue) como, por defensa
// en profundidad, dentro de offlineQueue.enqueueClosure.
//
// Esta prueba reproduce la clase exacta de fallo (un Blob cuyo origen ya no
// es legible) con un File sintetico cuyo arrayBuffer() rechaza — el mismo
// sintoma que un content:// URI ya liberado por Android, aunque no se
// pueda reproducir aqui la race de Android en si (eso requiere un
// dispositivo real). Vite/store reales, IndexedDB real, red externa
// bloqueada; sin Supabase/OLT/MikroTik reales.
import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://photo-invalidblob-test.invalid';process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const root=realpathSync.native(process.cwd()),outDir='dist/photo-invalidblob-browser-'+process.pid;
await build({configFile:false,root,plugins:[],resolve:{alias:{'@':join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://photo-invalidblob-test.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic')},logLevel:'error',build:{outDir,rollupOptions:{input:join(root,'scripts/tests/photo-evidence-invalidblob-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:false}});
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-photo-invalidblob-'));
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
 await c('Page.navigate',{url:base+'scripts/tests/photo-evidence-invalidblob-browser.html'});
 for(let n=0;n<100;n++){if(await evaluate('window.ready===true'))break;await new Promise(r=>setTimeout(r,50))}
 const fresh=async()=>{await evaluate(`(async()=>{await harness.closeCampoDatabase();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('smartrayco-campo');r.onsuccess=resolve;r.onerror=()=>reject(r.error)})})()`)};

 // ---- toSafeFile/toSafeBlob: materializa sin corromper bytes/metadatos ----
 await fresh();
 const roundtrip=await evaluate(`(async()=>{
   const original=new File(['hola-mundo'],'foto.jpg',{type:'image/jpeg',lastModified:123456});
   const safe=await harness.toSafeFile(original);
   return {name:safe.name,type:safe.type,lastModified:safe.lastModified,text:await safe.text(),isFile:safe instanceof File};
 })()`);
 assert.deepEqual(roundtrip,{name:'foto.jpg',type:'image/jpeg',lastModified:123456,text:'hola-mundo',isFile:true});checks++;

 // ---- Caso real: foto "condenada" (origen ya no legible, como un
 // content:// URI liberado por Android) -- toSafeFile debe RECHAZAR, nunca
 // devolver silenciosamente un archivo vacio/corrupto. ----
 const doomedRejects=await evaluate(`(async()=>{
   try { await harness.toSafeFile(harness.doomedFile('p.jpg')); return 'unexpected-success'; }
   catch(e){ return e.name || e.message; }
 })()`);
 assert.equal(doomedRejects,'NotReadableError');checks++;

 // ---- enqueueClosure con una foto BUENA: debe guardarse y recuperarse
 // byte a byte, sin corrupcion por la materializacion. ----
 await fresh();
 const goodPhoto=await evaluate(`(async()=>{
   const file=new File(['bytes-reales-de-la-foto'],'evidencia.jpg',{type:'image/jpeg'});
   const queued=await harness.enqueueClosure(harness.baseClosure({photos:[{category:'evidencia_1',blob:file,fileName:file.name}]}));
   const list=await harness.listQueuedClosures();
   return {queuedId:queued.localId,count:list.length,bytes:await list[0].photos[0].blob.text(),category:list[0].photos[0].category};
 })()`);
 assert.equal(goodPhoto.count,1);checks++;
 assert.deepEqual({bytes:goodPhoto.bytes,category:goodPhoto.category},{bytes:'bytes-reales-de-la-foto',category:'evidencia_1'});checks++;

 // ---- enqueueClosure con una foto CONDENADA (simula un llamador futuro
 // que se saltee la materializacion al capturar): debe fallar con un
 // mensaje CLARO y accionable, nunca con el texto nativo crudo, y no debe
 // quedar ninguna entrada a medio escribir en la cola. ----
 await fresh();
 const doomedPhotoEnqueue=await evaluate(`(async()=>{
   try {
     await harness.enqueueClosure(harness.baseClosure({jobId:'doomed-photo',photos:[{category:'evidencia_1',blob:harness.doomedFile('p.jpg'),fileName:'p.jpg'}]}));
     return {thrown:false};
   } catch(e) { return {thrown:true,message:e.message}; }
 })()`);
 assert.equal(doomedPhotoEnqueue.thrown,true);checks++;
 assert.match(doomedPhotoEnqueue.message,/Vuelve a capturar esa foto/);checks++;
 assert.doesNotMatch(doomedPhotoEnqueue.message,/InvalidBlob|NotReadableError/);checks++;
 const afterDoomedPhoto=await evaluate(`(async()=>(await harness.listQueuedClosures()).length)()`);
 assert.equal(afterDoomedPhoto,0);checks++; // nada a medio guardar

 // ---- Lo mismo para equipmentPhotos[].blob y para signatureBlob
 // (los otros 2 campos que tambien pasan por sanitizeForStorage). ----
 const doomedEquipment=await evaluate(`(async()=>{
   try { await harness.enqueueClosure(harness.baseClosure({jobId:'doomed-eq',equipmentPhotos:[{equipmentType:'modem',blob:harness.doomedFile('eq.jpg'),fileName:'eq.jpg'}]})); return {thrown:false}; }
   catch(e){ return {thrown:true,message:e.message}; }
 })()`);
 assert.equal(doomedEquipment.thrown,true);checks++;
 assert.match(doomedEquipment.message,/Vuelve a capturar esa foto/);checks++;

 const doomedSignature=await evaluate(`(async()=>{
   try { await harness.enqueueClosure(harness.baseClosure({jobId:'doomed-sig',signatureBlob:harness.doomedFile('firma.png')})); return {thrown:false}; }
   catch(e){ return {thrown:true,message:e.message}; }
 })()`);
 assert.equal(doomedSignature.thrown,true);checks++;
 const afterDoomedAll=await evaluate(`(async()=>(await harness.listQueuedClosures()).length)()`);
 assert.equal(afterDoomedAll,0);checks++; // ninguno de los 3 casos dejo basura en la cola

 // ---- Varias fotos y una foto grande (~3MB) en el mismo cierre: todas
 // sobreviven la materializacion byte a byte. ----
 await fresh();
 const bigAndMultiple=await evaluate(`(async()=>{
   const bigBytes=new Uint8Array(3*1024*1024); for(let i=0;i<bigBytes.length;i++) bigBytes[i]=i%256;
   const big=new File([bigBytes],'grande.jpg',{type:'image/jpeg'});
   const a=new File(['foto-a'],'a.jpg',{type:'image/jpeg'});
   const b=new File(['foto-b'],'b.jpg',{type:'image/jpeg'});
   await harness.enqueueClosure(harness.baseClosure({jobId:'varias-fotos',
     photos:[{category:'evidencia_1',blob:a,fileName:'a.jpg'},{category:'evidencia_2',blob:b,fileName:'b.jpg'},{category:'service_sheet',blob:big,fileName:'grande.jpg'}]}));
   const list=await harness.listQueuedClosures();
   const stored=list[0].photos;
   const bigStored=stored.find(p=>p.category==='service_sheet');
   const bigBuffer=new Uint8Array(await bigStored.blob.arrayBuffer());
   let bigIntact=bigBuffer.length===bigBytes.length;
   for(let i=0;i<bigBytes.length&&bigIntact;i++) if(bigBuffer[i]!==bigBytes[i]) bigIntact=false;
   return {
     count:stored.length,
     aText:await stored.find(p=>p.category==='evidencia_1').blob.text(),
     bText:await stored.find(p=>p.category==='evidencia_2').blob.text(),
     bigSize:bigStored.blob.size,
     bigIntact,
   };
 })()`);
 assert.deepEqual(bigAndMultiple,{count:3,aText:'foto-a',bText:'foto-b',bigSize:3*1024*1024,bigIntact:true});checks++;

 // ---- Reinicio de app (recarga real): la foto grande y las demas siguen
 // intactas en IndexedDB despues de recargar. ----
 await reload();
 const afterRestart=await evaluate(`(async()=>{
   const list=await harness.listQueuedClosures();
   const item=list.find(i=>i.jobId==='varias-fotos');
   return {found:!!item,count:item?.photos.length,aText:await item.photos.find(p=>p.category==='evidencia_1').blob.text()};
 })()`);
 assert.deepEqual(afterRestart,{found:true,count:3,aText:'foto-a'});checks++;

 // ---- Almacenamiento limitado (QuotaExceededError real, del navegador):
 // mensaje claro y especifico de espacio, nunca el texto crudo solo, y el
 // formulario no se pierde (no se borra nada de la cola por este fallo). ----
 const quota=await evaluate(`(async()=>{
   const proto=IDBObjectStore.prototype, original=proto.put;
   proto.put=function(value,key){
     if(value && value.jobId==='quota-test') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
     return original.apply(this,arguments);
   };
   try {
     await harness.enqueueClosure(harness.baseClosure({jobId:'quota-test',photos:[{category:'evidencia_1',blob:new File(['x'],'x.jpg',{type:'image/jpeg'}),fileName:'x.jpg'}]}));
     return {thrown:false};
   } catch(e){ return {thrown:true,message:e.message}; }
   finally { proto.put=original; }
 })()`);
 assert.equal(quota.thrown,true);checks++;
 assert.match(quota.message,/espacio de almacenamiento suficiente/);checks++;
 assert.match(quota.message,/nada se borró/);checks++;
 const afterQuota=await evaluate(`(async()=>(await harness.listQueuedClosures()).some(i=>i.jobId==='quota-test'))()`);
 assert.equal(afterQuota,false);checks++; // el intento fallido no deja una entrada a medias

 assert.equal(errors.length,0);checks++;
 console.log(JSON.stringify({passed:checks,synthetic:true,externalNetworkBlocked:true,productionWrites:0}));
} catch(e){console.error('PHOTO_INVALIDBLOB_BROWSER_FAIL: '+e.message+'; paso='+lastStep+'; errores='+JSON.stringify(errors));process.exitCode=1}
finally {if(ws?.readyState===1)ws.send(JSON.stringify({id:++sequence,method:'Browser.close'}));ws?.close();chrome.kill();await Promise.race([new Promise(r=>server.httpServer.close(r)),new Promise(r=>setTimeout(r,2000))]);process.exit(process.exitCode??0)}
