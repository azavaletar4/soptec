// Componente real, API ficticia; no abre conexiones operativas.
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'inventory-signals-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
try {
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Chrome timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let seq=0;const pending=new Map(),exceptions=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Network.setBlockedURLs',{urls:['*supabase.co/*','https://inventory.invalid/*']});
 await c('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Version/4.0 Chrome/130.0 Mobile Safari/537.36 SmartRaycoApp'});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);}
 for(const type of ['installation','ticket']){
  await c('Page.navigate',{url:'http://127.0.0.1:4179/scripts/tests/field-inventory-harness.html?type='+type});
  await until('window.__ready && document.body.textContent.includes("SERIE-CONTEXTUAL") && window.__sources.length===1');
  assert.deepEqual(await evaluate('window.__subscriptions'),['job_assignees']);
  assert.equal(await evaluate('window.__sources[0].url'),'/api/inventory-signals');
  const initial=await evaluate('window.__calls.filter(c=>c.path.startsWith("/api/campo-inventory/")).length');
  assert.equal(initial,type==='installation'?3:4,'Un snapshot inicial por vista, sin consulta duplicada al abrir SSE');
  await evaluate('window.__state().materialForm.productId="00000000-0000-4000-8000-000000000007";window.__state().materialForm.quantity=2;window.__state().handleAddMaterial()');
  await until('window.__state().materials.length===1 && !window.__state().savingMaterial');
  assert.equal(await evaluate('window.__state().materials[0].quantity'),2);
  assert.equal(await evaluate('window.__calls.filter(c=>c.method==="POST").length'),1,'Registrar material no duplica la escritura');
  const baseline=await evaluate('window.__calls.filter(c=>c.path.startsWith("/api/campo-inventory/")).length');
  await evaluate('window.__state().closureForm.closureNotes="Borrador preservado"; window.__state().onPhotoChange("evidence", {target:{files:[new File(["foto"],"prueba.jpg",{type:"image/jpeg"})]}}); window.__state().signatureBlob=new Blob(["firma"],{type:"image/png"}); window.__hold=true; for(let i=0;i<100;i++)window.__tick()');
  await until('window.__delayed.length>0');
  assert.equal(await evaluate('window.__calls.filter(c=>c.path.startsWith("/api/campo-inventory/")).length'),baseline+initial,'100 señales simultáneas comparten una lectura');
  await evaluate('window.__hold=false;window.__delayed.splice(0).forEach(r=>r())');
  await until('!window.__state().loadingUnits && !window.__state().loadingInstallEquipment');
  for(const status of [403,401]){
   await evaluate('window.__deny='+status+';window.__tick()');
   await until('window.__state().inventoryAccessBlocked && !document.body.textContent.includes("SERIE-CONTEXTUAL")');
   assert.equal(await evaluate('window.__state().fieldProducts.length+window.__state().materials.length+window.__state().assignedUnits.length+window.__state().pendingUnits.length+window.__state().installEquipmentUnits.length+window.__state().availableIncomingUnits.length+window.__state().installAvailableUnits.length'),0);
   const n=await evaluate('window.__calls.length');await evaluate('for(let i=0;i<100;i++)window.__tick()');
   assert.equal(await evaluate('window.__calls.length'),n,'Denegación pausa consultas');
   assert.equal(await evaluate('window.__state().closureForm.closureNotes'), 'Borrador preservado');
   assert.equal(await evaluate('window.__state().closurePhotos.evidence.name'), 'prueba.jpg');
   assert.equal(await evaluate('window.__state().signatureBlob.size'),5);
   await evaluate('window.__deny=0;Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Comprobar acceso al inventario")).click()');
   await until('document.body.textContent.includes("SERIE-CONTEXTUAL")');
  }
  await evaluate('window.__hold=true;window.__tick()');await until('window.__delayed.length>0');
  await evaluate('window.__actor=window.__auth.user;window.__auth.user=null');
  await until('!document.body.textContent.includes("SERIE-CONTEXTUAL")');
  await evaluate('window.__hold=false;window.__delayed.splice(0).forEach(r=>r())');
  await new Promise(r=>setTimeout(r,100));assert.equal(await evaluate('document.body.textContent.includes("SERIE-CONTEXTUAL")'),false,'Respuesta anterior al logout descartada');
  await evaluate('window.__auth.user={id:"00000000-0000-4000-8000-000000000099"}');
  await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate('document.body.textContent.includes("SERIE-CONTEXTUAL")'),false,'Cambio de usuario no recupera datos del anterior');
  await evaluate('window.__auth.user=window.__actor');await until('document.body.textContent.includes("SERIE-CONTEXTUAL")');
  await evaluate('window.__state().onPhotoChange(window.__state().jobType==="installation"?"facade":"evidencia_1",{target:{files:[new File(["foto"],"prueba.jpg",{type:"image/jpeg"})]}})');
  await evaluate('window.dispatchEvent(new Event("offline"))');await until('!document.body.textContent.includes("SERIE-CONTEXTUAL")');
  await evaluate('window.dispatchEvent(new Event("online"))');await until('document.body.textContent.includes("SERIE-CONTEXTUAL")');
  await evaluate('window.__state().signatureBlob=null;window.__state().handleCloseSubmit()');
  await until(type==='installation'?'window.__state().signatureMissing':'!!window.__state().closeError');
  await evaluate('window.__state().signatureBlob=new Blob(["firma"]);window.__state().closureForm.zoneId="zona-ficticia";window.__state().closureForm.napElementoId="nap-ficticia";window.__state().closureForm.clientCode="TEST";window.__state().closureForm.motivoAveria="other";window.__state().closureForm.motivoAveriaDetalle="Causa ficticia";window.__state().handleCloseSubmit()');
  await until('window.__closures.length===1');
  assert.equal(await evaluate('window.__closures[0].jobType'),type);
  assert.equal(await evaluate('window.__closures[0].jobId'),'00000000-0000-4000-8000-000000000002');
  assert.equal(await evaluate('window.__closures[0].signatureBlob.size'),5);
  assert.equal(await evaluate('window.__closures[0].closureNotes'),'Borrador preservado');
  assert.equal(await evaluate('window.__closures[0].photos[0].file.name'),'prueba.jpg');
  assert.equal(await evaluate('window.__closures[0].contractId'),'00000000-0000-4000-8000-000000000004');
  await evaluate('window.__sources.at(-1).onerror();window.__unmount()');
  const sources=await evaluate('window.__sources.length');await new Promise(r=>setTimeout(r,1200));
  assert.equal(await evaluate('window.__sources.length'),sources,'No reconecta después de desmontar');
  assert.equal(await evaluate('window.__sources.every(s=>s.closed)'),true);
  console.log('PASS '+type+': 401/403, caché, sesión/reingreso, offline/reconexión, agrupación de 100 avisos, firma/foto/borrador, validación de cierre y cleanup.');
 }
 assert.equal(exceptions.length,0,JSON.stringify(exceptions));
 await send('Browser.close');
}finally{ws?.close();chrome.kill();}
