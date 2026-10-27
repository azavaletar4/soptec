// Chrome + componente Vue real; todos los stores de negocio son ficticios.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const trial=process.env.WIFI_TRIAL_VISUAL==='1';
const out=trial?'docs/evidencias/tr069-wifi-habilitado-local-20261027':'docs/evidencias/tr069-wifi-local-20261027';
await mkdir(out,{recursive:true});
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
 '--remote-debugging-port=0','--user-data-dir='+await mkdtemp(join(tmpdir(),'tr069-wifi-visual-')),'about:blank'
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;let seq=0;const pending=new Map(),exceptions=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),15000);
 chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});chrome.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
 if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT: '+method));},15000);pending.set(id,{resolve:v=>{clearTimeout(timeout);resolve(v);},reject:e=>{clearTimeout(timeout);reject(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Network.setBlockedURLs',{urls:['*supabase.co/*','*/api/*','*192.168.*','*10.15.*']});
 await c('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,150));}console.error(JSON.stringify({exceptions,body:await evaluate('document.body.innerText.slice(0,1800)')}));throw Error('UI_TIMEOUT: '+expression);};
 const click=async text=>assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true;})()`));
 const shot=async name=>{await new Promise(r=>setTimeout(r,150));const s=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`${out}/${name}.png`,Buffer.from(s.data,'base64'));};
 const fill=async()=>{await evaluate(`(()=>{const s=document.querySelector('form select');s.value='InternetGatewayDevice.LANDevice.1.WLANConfiguration.5';s.dispatchEvent(new Event('change',{bubbles:true}));const i=document.querySelector('form input');i.value='PRUEBA-LOCAL-SSID';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
 await c('Page.navigate',{url:'http://127.0.0.1:5187/scripts/tests/tr069-wifi-visual.html'+(trial?'?trial=1':'')});
 await until('window.ready && document.body.innerText.includes("Configurar")');
 await click('Configurar');await until('document.querySelectorAll("form option").length===3');
 if(trial){
  assert(await evaluate('document.querySelectorAll("form option")[1].disabled'));
  await fill();await shot('01-configurar');
  await click('Guardar SSID');await until('document.body.innerText.includes("Confirmar cambio real de SSID")');await shot('02-confirmacion-cambio');
  await click('Cancelar');assert.equal(await evaluate('window.calls.filter(c=>c.operation==="TRIAL_CHANGE").length'),0);
  await click('Guardar SSID');await until('document.body.innerText.includes("Confirmar cambio real de SSID")');await click('Enviar cambio');
  await until('document.body.innerText.includes("Cambio encolado, no confirmado")');await shot('03-encolado');
  assert(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Restaurar SSID anterior")).disabled'));
  await click('Verificar resultado');await until('document.querySelector("[role=dialog]")!==null');await click('Consultar SSID');
  await until('document.body.innerText.includes("SSID verificado en GenieACS")');await shot('04-verificado');
  await click('Restaurar SSID anterior');await until('document.querySelector("[role=dialog]")!==null');await shot('05-confirmacion-restaurar');
  assert(await evaluate('document.querySelector("[role=dialog]").textContent.includes("WirelessNet-5G")'));await click('Restaurar nombre');
  await until('document.body.innerText.includes("Cambio encolado, no confirmado")');
  await click('Verificar resultado');await until('document.querySelector("[role=dialog]")!==null');await click('Consultar SSID');
  await until('document.body.innerText.includes("SSID verificado en GenieACS")');await shot('06-restaurado');
  assert.equal(await evaluate('window.trialRecord.originalSsid'),'WirelessNet-5G');
  assert.equal(await evaluate('window.trialRecord.operations.at(-1).after'),'WirelessNet-5G');
  assert.equal(await evaluate('window.blocked.length'),0);assert.equal(exceptions.length,0);
  await writeFile(out+'/resultado.json',JSON.stringify({result:'PASS',synthetic:true,realEquipmentCalls:0,exceptions,
   checks:['instancia 1 bloqueada','confirmación cancelable','solo SSID 5','encolado no confirmado','restauración bloqueada hasta verificar','respaldo persistente simulado','confirmación de restauración','restaurado simulado'],calls:await evaluate('window.calls')},null,2)+'\n');
  console.log('TRIAL_VISUAL_PASS; screenshots=6; realEquipmentCalls=0');
 }else{
 assert.equal(await evaluate('document.querySelector("form select").value'),'');
 const options=await evaluate('[...document.querySelectorAll("form option")].map(n=>n.textContent)');
 assert(options.slice(1).every(n=>n.includes('Banda desconocida')));assert(options[2].includes('WirelessNet-5G'));
 assert(await evaluate('document.body.innerText.includes("Serial GPON completo: HWTC1D3691B7")'));
 await fill();await shot('01-red-instancia-desconocida');
 await click('Preparar sin aplicar');await until('document.body.innerText.includes("Confirmar preparación de un SSID")');
 assert(await evaluate('document.body.innerText.includes("Actual: WirelessNet-5G") && document.body.innerText.includes("WLANConfiguration.5")'));
 assert(await evaluate('document.querySelector("[role=dialog]").scrollWidth <= document.querySelector("[role=dialog]").clientWidth'));
 await shot('02-confirmacion');await click('Cancelar');assert.equal(await evaluate('window.calls.filter(c=>c.operation==="PREPARE_ONLY").length'),0);
 await click('Preparar sin aplicar');await until('document.body.innerText.includes("Confirmar preparación de un SSID")');
 await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent.trim()==="Preparar sin aplicar").click()');
 await until('document.body.innerText.includes("Plan preparado. No aplicado.")');await shot('03-plan-respaldo');
 assert.equal(await evaluate('window.plan.before'),'WirelessNet-5G');assert.equal(await evaluate('window.plan.path'),'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5');
 await evaluate(`window.downloads=[];const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.downloads.push(blob.text());return original(blob);}`);
 await click('Descargar respaldo SSID');const backup=await evaluate('Promise.all(window.downloads)');assert.equal(JSON.parse(backup[0]).before,'WirelessNet-5G');
 await click('Comparar caché sin refrescar');await until('document.body.innerText.includes("Pendiente: no se ha observado un nuevo Inform")');await shot('04-pendiente');
 await evaluate(`window.inventory.lastInform=new Date(Date.parse(window.plan.preparedAt)+1000).toISOString()`);
 await click('Comparar caché sin refrescar');await until('document.body.innerText.includes("Sin evidencia nueva en caché")');
 await evaluate(`window.inventory.networks[1].timestamp=new Date(Date.parse(window.plan.preparedAt)+2000).toISOString();window.inventory.networks[1].ssid=window.plan.after;`);
 await click('Comparar caché sin refrescar');await until('document.body.innerText.includes("falta confirmación del propietario")');
 await shot('05-valor-observado-no-certificado');
 await evaluate('window.fixtureError=true');await click('Preparar sin aplicar');await until('document.body.innerText.includes("Confirmar preparación de un SSID")');
 await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent.trim()==="Preparar sin aplicar").click()');
 await until('document.body.innerText.includes("La caché cambió")');await shot('06-error');
 await click('Cerrar');await evaluate('window.setRole("TECNICO_RED")');await click('Configurar');await until('document.querySelectorAll("form option").length===3');
 assert.equal(await evaluate('[...document.querySelectorAll("form button")].some(b=>b.textContent.includes("Preparar sin aplicar"))'),false);await shot('07-tecnico-solo-lectura');
 await click('Cerrar');await evaluate('window.setRole("SUPERADMIN");window.setExplicitBands()');await click('Configurar');await until('document.querySelectorAll("form option").length===3');
 assert(await evaluate('document.querySelector("form select").textContent.includes("2.4 GHz") && document.querySelector("form select").textContent.includes("5 GHz")'));
 await fill();await shot('08-bandas-explicitas-sinteticas');
 await c('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot('09-movil');
 assert.equal(await evaluate('window.blocked.length'),0);assert.equal(exceptions.length,0);
 const calls=await evaluate('window.calls');assert(calls.every(c=>['GET_CACHE','PREPARE_ONLY'].includes(c.operation)));
 const report={result:'PASS',component:'src/views/tr069/Tr069View.vue',synthetic:true,realEquipmentCalls:0,exceptions,
 checks:['banda desconocida sin inferir por SSID','bandas explícitas sintéticas','selección sin defecto e instancia exacta','serial GPON y deviceId visibles','confirmación cancelable','respaldo descargado conserva SSID','Inform nuevo sin valor nuevo no confirma','pendiente/error/valor observado','TECNICO_RED sin preparación','ADMIN y SUPERADMIN','móvil'],calls};
 await writeFile(`${out}/resultado.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'PASS',screenshots:9,checks:report.checks,realEquipmentCalls:0,exceptions:0}));
 }
 await send('Browser.close');
}finally{ws?.close();chrome.kill();}
