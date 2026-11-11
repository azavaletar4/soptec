// Pruebas reales de Android en LAB. Nunca conecta a un socket de Campo habitual.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connect,restart,phone,productionMetadata,device} from './physical-device.mjs';
const reportFile=path.join(phone,'physical-check.json');
const report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):{sourceCommit:'bcb3ec4c432c6baa39f175cca115795d5ae1cd45',physicalAndroidExecuted:true,checks:[],productionWrites:0};
const stage=process.argv[2]??'mode',pass=(name,evidence)=>{const entry={name,passed:true,at:new Date().toISOString(),evidence},idx=report.checks.findIndex(x=>x.name===name);if(idx<0)report.checks.push(entry);else report.checks[idx]=entry;fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');};
let c;
try{
 c=await connect({allowUnready:stage==='legacy'});
 if(stage==='mode'){await c.evaluate('window.ready=false');await c.send('Page.reload');await c.until('window.ready===true');}
 const e=c.evaluate,until=c.until;
 if(stage==='mode'){
  report.runtime=await e('({ua:navigator.userAgent,url:location.href,secure:isSecureContext,indexedDB:!!indexedDB,locks:!!navigator.locks,crypto:!!crypto.subtle,blob:typeof Blob,file:typeof File})');
  assert.match(report.runtime.ua,/Android 15.*SmartRaycoApp\/1\.0/);assert.equal(report.runtime.secure,true);assert.equal(report.runtime.locks,true);assert.equal(report.runtime.crypto,true);
  await until('lab.message.value.length>0');assert.equal(await e('lab.items.value.length'),0);assert.equal(await e('lab.photo.value'),null);assert.equal(await e('lab.note.value'),'');
  pass('wrapper físico, origen seguro, Web Locks/IDB/Web Crypto y perfil LAB nuevo',report.runtime);
  await e(`(async()=>{const select=document.querySelector('select');select.value='smart_tv_app';select.dispatchEvent(new Event('change',{bubbles:true}));await lab.nextTick();await lab.save()})()`);
  const before=await e('lab.evidence()');assert.equal(before.mode,'smart_tv_app');assert.equal(before.note,'');assert.equal(before.photoBytes,0);
  c.close();restart();c=await connect();await c.until('lab.message.value.includes("recuperado")');
  const after=await c.evaluate('lab.evidence()');assert.equal(after.mode,before.mode);assert.equal(after.note,'');assert.equal(after.photoBytes,0);
  pass('modalidad sola conservada después de force-stop y reapertura Android',{before,after});
  await c.evaluate(`document.querySelector('input[type=file]').click()`);
  pass('selector de archivos nativo invocado desde WebView',{cameraPhotoRequired:true});
  console.log(JSON.stringify({passed:report.checks.length,next:'Tomar foto de papel con selector nativo; pendiente intervención física.',report:reportFile}));
 }else if(stage==='camera'){
  await until('lab.photo.value!==null');
  await e('(async()=>{lab.note.value="NOTA-ANDROID-CAMARA";await lab.save()})()');
  const before=await e('lab.evidence()');assert.ok(before.photoBytes>100);assert.equal(before.note,'NOTA-ANDROID-CAMARA');
  pass('fotografía real entregada por selector nativo y guardada en IDB',before);
  c.close();restart();c=await connect();await c.until('lab.message.value.includes("recuperado")');
  const after=await c.evaluate('lab.evidence()');assert.equal(after.photoHash,before.photoHash);assert.equal(after.photoBytes,before.photoBytes);assert.equal(after.note,before.note);assert.equal(after.mode,before.mode);
  pass('foto, nota y modalidad recuperadas tras force-stop Android',{before,after});
  await c.evaluate('(async()=>{lab.offline.value=true;await lab.enqueue();await lab.refresh()})()');
  const queued=await c.evaluate('lab.items.value.map(i=>({id:i.localId,operationId:i.closureOperationId,mode:i.iptvInstallationMode,photoBytes:i.photos[0]?.blob.size}))');assert.equal(queued.length,1);
  c.close();restart();c=await connect();await c.until('lab.message.value.includes("recuperado")');
  assert.deepEqual(await c.evaluate('lab.items.value.map(i=>({id:i.localId,operationId:i.closureOperationId,mode:i.iptvInstallationMode,photoBytes:i.photos[0]?.blob.size}))'),queued);
  pass('cola offline conserva IDs y foto real tras cierre/reapertura Android',queued);
  const writes=await c.evaluate('(async()=>{await lab.refresh();return lab.snapshot.value.writes})()');
  await c.evaluate('(async()=>{lab.loseResponse.value=true;await lab.sync()})()');assert.equal(await c.evaluate('lab.items.value.length'),1);assert.equal(await c.evaluate('lab.snapshot.value.writes'),writes+1);
  pass('respuesta perdida después de confirmación sintética conserva el pendiente',{writes:writes+1,remaining:1});
  c.close();restart();c=await connect();await c.until('lab.message.value.includes("recuperado")');
  await c.evaluate('lab.sync()');assert.equal(await c.evaluate('lab.items.value.length'),0);assert.equal(await c.evaluate('lab.snapshot.value.writes'),writes+1);
  pass('recibo reconocido tras reinicio: reintento sin duplicar cierre',{writes:writes+1,remaining:0});
  const screenshot=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(phone,'camera-recovery.png'),Buffer.from(screenshot.data,'base64'));
  report.productionAfter=productionMetadata();assert.deepEqual(report.productionAfter,JSON.parse(fs.readFileSync(path.join(phone,'production-before.json'),'utf8')));
  pass('APK y metadatos de Campo habitual iguales; aplicación/datos no abiertos',report.productionAfter);
  console.log(JSON.stringify({passed:report.checks.length,next:'continuar cola independiente y modalidades',report:reportFile}));
 }else if(stage==='flows'){
  await e('lab.rejectRayco.value=true;lab.offline.value=false;lab.loseResponse.value=false');
  const click=async()=>{await c.evaluate(`document.querySelectorAll('button').values().find(b=>b.textContent==='Nueva orden sintética (conserva pendientes)').click()`);await c.until('lab.mode.value===null');await c.until('lab.message.value.includes("Guardado")');};
  await c.until('lab.message.value.length>0');assert.equal(await e('lab.items.value.length'),0);
  const initial=await e('(async()=>{await lab.refresh();return lab.snapshot.value.writes})()');
  await click();await e('(async()=>{lab.note.value="INCOMPATIBLE-CONSERVAR";await lab.enqueue()})()');
  await click();await e('(async()=>{lab.mode.value="customer_device";await lab.enqueue();await lab.sync()})()');
  assert.equal(await e('lab.items.value.length'),1);assert.equal(await e('lab.items.value[0].closureNotes'),'INCOMPATIBLE-CONSERVAR');assert.equal(await e('lab.snapshot.value.writes'),initial+1);
  pass('Android: incompatible conservado y dispositivo propio independiente confirmado',{writes:initial+1,pending:await e('lab.items.value.map(i=>({id:i.localId,error:i.lastError}))')});
  await e(`{const select=document.querySelectorAll('select')[1];select.value='smart_tv_app';select.dispatchEvent(new Event('change',{bubbles:true}));}`);await until('lab.items.value[0].iptvInstallationMode==="smart_tv_app"');await e('lab.sync()');
  assert.equal(await e('lab.items.value.length'),0);assert.equal(await e('lab.snapshot.value.writes'),initial+2);pass('Android: corrección explícita de modalidad conserva y recupera el envío',{writes:initial+2});
  await click();await e('(async()=>{lab.mode.value="rayco_tv_box";await lab.enqueue();await lab.sync()})()');
  assert.equal(await e('lab.items.value.length'),1);assert.match(await e('lab.items.value[0].lastError'),/serie\/MAC y custodia/);assert.equal(await e('lab.snapshot.value.writes'),initial+2);
  pass('Android: rechazo Rayco de preflight mostrado y retenido (transporte sintético)',{error:await e('lab.items.value[0].lastError'),writes:initial+2});
  await e('(async()=>{lab.rejectRayco.value=false;await lab.sync()})()');assert.equal(await e('lab.items.value.length'),0);assert.equal(await e('lab.snapshot.value.writes'),initial+3);pass('Android: modalidad Rayco y recibo enviados tras aprobación sintética',{writes:initial+3});
  await click();await e('(async()=>{lab.mode.value="customer_device";await lab.enqueue();await lab.refresh()})()');
  const before=await e('lab.items.value.map(i=>({id:i.localId,mode:i.iptvInstallationMode}))'),d=device();
  d.run('reverse','--remove','tcp:4176');
  try{await e('(async()=>{try{return await lab.sync()}catch(error){return {expectedTransportError:error.message}}})()');assert.deepEqual(await e('lab.items.value.map(i=>({id:i.localId,mode:i.iptvInstallationMode}))'),before);assert.match(await e('lab.items.value[0].lastError'),/fetch|network/i);pass('Android: corte real del transporte USB/HTTP conserva cola',{queue:before,error:await e('lab.items.value[0].lastError')});}
  finally{d.run('reverse','tcp:4176','tcp:4176');}
  await e('lab.sync()');assert.equal(await e('lab.items.value.length'),0);assert.equal(await e('lab.snapshot.value.writes'),initial+4);pass('Android: reconexión real USB/HTTP sincroniza una sola vez',{writes:initial+4});
  await click();await e('(async()=>{lab.mode.value="customer_device";await lab.enqueue();await lab.refresh()})()');
  const results=await Promise.all([e('lab.sync()'),e('lab.sync()')]);assert.equal(results.reduce((sum,r)=>sum+r.synced,0),1);assert.equal(await e('lab.snapshot.value.writes'),initial+5);assert.equal(await e('lab.items.value.length'),0);
  await e('lab.sync()');assert.equal(await e('lab.snapshot.value.writes'),initial+5);pass('Android: sincronizaciones concurrentes y reintento vacío sin duplicados',{results,writes:initial+5});
  const shot=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(phone,'flows-completed.png'),Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify({passed:report.checks.length,report:reportFile}));
 }else if(stage==='offline'){
  await c.until('lab.message.value.length>0');assert.equal(await e('lab.items.value.length'),0);
  await e(`document.querySelectorAll('button').values().find(b=>b.textContent==='Nueva orden sintética (conserva pendientes)').click()`);await until('lab.mode.value===null');await until('lab.message.value.includes("Guardado")');
  await e('(async()=>{lab.mode.value="customer_device";await lab.enqueue();await lab.refresh()})()');
  const before=await e('lab.items.value.map(i=>i.localId)'),writes=await e('lab.snapshot.value.writes');
  await c.send('Network.enable');await c.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  try{assert.equal(await e('navigator.onLine'),false);await e('(async()=>{try{return await lab.sync()}catch(error){return {expectedTransportError:error.message}}})()');assert.deepEqual(await e('lab.items.value.map(i=>i.localId)'),before);pass('Android WebView: navigator.onLine=false (CDP) conserva cola sin transmitir',{ids:before,radioSettingsChanged:false});}
  finally{await c.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
  assert.equal(await e('navigator.onLine'),true);await e('lab.sync()');assert.equal(await e('lab.items.value.length'),0);assert.equal(await e('lab.snapshot.value.writes'),writes+1);pass('Android WebView: retorno online tras CDP sincroniza una vez',{writes:writes+1});
  console.log(JSON.stringify({passed:report.checks.length,report:reportFile}));
 }else if(stage==='legacy'){
  await c.send('Page.navigate',{url:'http://127.0.0.1:4176/scripts/android-iptv-lab/legacy.html'});await c.until('window.legacyReady===true');
  const result=await c.evaluate('window.legacyResult');assert.equal(result.error,undefined);assert.equal(result.passed,8);assert.equal(result.recordsDeleted,0);
  for(const name of result.checks)pass('Android legado: '+name,{namespace:result.namespace,version:result.version,databaseNameRedirected:true});
  report.legacy=result;
  const screenshot=await c.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(phone,'legacy-upgrade.png'),Buffer.from(screenshot.data,'base64'));
  await c.send('Page.navigate',{url:'http://127.0.0.1:4176/scripts/android-iptv-lab/lab.html'});await c.until('window.ready===true && lab.message.value.length>0');
  assert.equal(await c.evaluate('lab.items.value.length'),0);report.productionAfter=productionMetadata();assert.deepEqual(report.productionAfter,JSON.parse(fs.readFileSync(path.join(phone,'production-before.json'),'utf8')));
  report.completedAt=new Date().toISOString();report.lastFailureResolved=true;fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.checks.length,legacy:result,productionMetadataUnchanged:true,report:reportFile}));
 }else throw Error('UNKNOWN_STAGE');
}catch(error){report.lastFailure={stage,at:new Date().toISOString(),error:error.message};fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');throw error;}
finally{c?.close();}
