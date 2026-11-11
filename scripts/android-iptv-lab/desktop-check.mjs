// Certifica la SONDA, no un Android. Chrome usa perfil efímero y red externa bloqueada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {startLab} from './server.mjs';
const prepared=process.argv[2],lab=await startLab(prepared,0),folder=path.dirname(prepared),base=`http://127.0.0.1:${lab.port}/`;
const response=await fetch(base+'scripts/android-iptv-lab/lab.html');assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'iptv-lab-desktop-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,seq=0;const pending=new Map(),checks=[],errors=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('CHROME_START_TIMEOUT')),20000);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1])}});chrome.on('error',reject)});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT:'+method))},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});ws.send(JSON.stringify({id,method,params,sessionId}))});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Network.setBlockedURLs',{urls:['https://*']});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let n=0;n<100;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('WAIT_TIMEOUT:'+expression)};
 const click=label=>evaluate(`document.querySelectorAll('button').values().find(b=>b.textContent===${JSON.stringify(label)}).click()`);
 const newOrder=async()=>{const previous=await evaluate('lab.currentId.value');await click('Nueva orden sintética (conserva pendientes)');await until(`lab.currentId.value!==${JSON.stringify(previous)}`);await until(`(async()=>{const db=await new Promise((r,j)=>{const x=indexedDB.open('smartrayco-campo');x.onsuccess=()=>r(x.result);x.onerror=()=>j(x.error)});try{return await new Promise((r,j)=>{const x=db.transaction('drafts').objectStore('drafts').get('LAB-pointer');x.onsuccess=()=>r(x.result?.data?.id===lab.currentId.value);x.onerror=()=>j(x.error)})}finally{db.close()}})()`)};
 await c('Page.navigate',{url:base+'scripts/android-iptv-lab/lab.html'});await until('window.ready && lab.message.value.includes("Sin borrador")');
 assert.deepEqual(await evaluate('({secure:isSecureContext,locks:!!navigator.locks,crypto:!!crypto.subtle,options:document.querySelectorAll("select option").length})'),{secure:true,locks:true,crypto:true,options:4});checks.push('sonda cargada en origen seguro y selector real');
 await evaluate(`(async()=>{lab.mode.value='smart_tv_app';lab.note.value='NOTA-LAB-DESKTOP';lab.photo.value=new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1kAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'synthetic.png',{type:'image/png'});await lab.save()})()`);
 const before=await evaluate('lab.evidence()');assert.ok(before.photoBytes>0);checks.push('guardado confirmado de modalidad, nota y Blob');
 await evaluate('window.ready=false');await c('Page.reload');await until('window.ready && lab.message.value.includes("recuperado")');
 const after=await evaluate('lab.evidence()');assert.equal(after.mode,before.mode);assert.equal(after.note,before.note);assert.equal(after.photoHash,before.photoHash);checks.push('recarga conserva bytes de foto, modalidad y nota');
 await evaluate('(async()=>{await lab.enqueue();lab.offline.value=true;await lab.sync()})()');assert.equal(await evaluate('lab.items.value.length'),1);checks.push('fallo de red conserva cierre y fotos');
 const writes=lab.state.writes;
 await evaluate('(async()=>{lab.offline.value=false;lab.loseResponse.value=true;await lab.sync()})()');assert.equal(lab.state.writes,writes+1);assert.equal(await evaluate('lab.items.value.length'),1);checks.push('respuesta perdida conserva pendiente aunque servidor confirmó');
 await evaluate('window.ready=false');await c('Page.reload');await until('window.ready && lab.message.value.includes("recuperado")');
 await evaluate('lab.sync()');assert.equal(await evaluate('lab.items.value.length'),0);assert.equal(lab.state.writes,writes+1);checks.push('recuperación tras recarga reconoce recibo sin duplicar cierre');
 await newOrder();await evaluate('lab.enqueue()');
 await newOrder();await evaluate('(async()=>{lab.mode.value="customer_device";await lab.enqueue();await lab.sync()})()');assert.equal(await evaluate('lab.items.value.length'),1);assert.equal(lab.state.writes,writes+2);checks.push('incompatible retenido no bloquea orden independiente');
 await evaluate(`(async()=>{const select=document.querySelectorAll('select')[1];select.value='smart_tv_app';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until('lab.items.value[0].iptvInstallationMode==="smart_tv_app"');await evaluate('lab.sync()');assert.equal(await evaluate('lab.items.value.length'),0);checks.push('corrección explícita de modalidad recupera pendiente');
 await newOrder();await evaluate('(async()=>{lab.mode.value="rayco_tv_box";await lab.enqueue();await lab.sync()})()');assert.equal(await evaluate('lab.items.value.length'),1);assert.match(await evaluate('lab.items.value[0].lastError'),/serie\/MAC y custodia/);checks.push('WebView recibirá mensaje Rayco del transporte sintético');
 await evaluate('(async()=>{lab.rejectRayco.value=false;await lab.sync()})()');assert.equal(await evaluate('lab.items.value.length'),0);checks.push('envío Rayco aprobado por fixture transporta modalidad/recibo');
 const foreign=await fetch(base+'lab/transport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',id:'CTR-REAL'})});assert.equal(foreign.status,400);checks.push('servidor rechaza identificadores ajenos al laboratorio');
 assert.equal(errors.length,0);checks.push('sin excepciones JavaScript');
 const report={at:new Date().toISOString(),sourceCommit:lab.config.sourceCommit,desktopOnly:true,physicalAndroidExecuted:false,passed:checks.length,checks,productionWrites:0,externalNetworkBlocked:true,serverStateFile:path.join(folder,'synthetic-server.json')};
 fs.writeFileSync(path.join(folder,'desktop-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(error);process.exitCode=1;fs.writeFileSync(path.join(folder,'desktop-failure.json'),JSON.stringify({checks,error:error.message,physicalAndroidExecuted:false},null,2));}
finally{if(ws?.readyState===1)ws.send(JSON.stringify({id:++seq,method:'Browser.close'}));ws?.close();chrome.kill();await Promise.race([new Promise(r=>lab.server.close(r)),new Promise(r=>setTimeout(r,1500))]);process.exit(process.exitCode??0)}
