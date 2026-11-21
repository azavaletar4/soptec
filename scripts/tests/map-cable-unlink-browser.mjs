import {build,preview} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
// Control SUPERADMIN del mapa (21/11/2026): desvincular un extremo YA
// conectado desde "Editar datos del cable" exige SUPERADMIN + confirmacion
// explicita (el servidor lo exige igual, ver migracion
// 20261121190726_fo_cable_endpoint_unlink_guard.sql); reasignar a OTRO
// elemento real sigue disponible para el personal de siempre, sin aviso.
const root=realpathSync.native(process.cwd()),outDir='dist/map-cable-unlink-browser-'+process.pid;
const fixture={name:'cable-unlink-test-fixture',enforce:'pre',transform(code,id){
 if(id.endsWith('/components/layout/AppLayout.vue'))return '<script setup>import ConfirmHost from "../ConfirmHost.vue";import ToastHost from "../ToastHost.vue";</script><template><main><slot/></main><ConfirmHost/><ToastHost/></template>';
 if(id.endsWith('/views/mapa/RedMapView.vue'))return code.replace('</script>','defineExpose({openCableHilos,get map(){return map},routeCable,showCableForm,showCableHilos});\n</script>');
}};
await build({configFile:false,root,plugins:[fixture,vue(),tailwindcss()],resolve:{alias:{'@':join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://synthetic.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic')},logLevel:'error',build:{target:'esnext',outDir,rollupOptions:{input:join(root,'scripts/tests/map-route-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0}}),base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-cable-unlink-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,c,sequence=0,lastStep='start';const pending=new Map(),errors=[],checks=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1])}})});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,t=setTimeout(()=>reject(Error('CDP_TIMEOUT_'+method)),15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params,sessionId}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused'){
  const u=new URL(m.params.request.url),local=u.origin===new URL(base).origin;
  void c(local?'Fetch.continueRequest':'Fetch.fulfillRequest',local?{requestId:m.params.requestId}:{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}).catch(()=>{});
 }};
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await c('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{lastStep=expression;const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let n=0;n<150;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,60))}throw Error('UI_TIMEOUT '+expression+' '+await evaluate('document.body.innerText.slice(-1200)'))};
 const button=label=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
 const point=expression=>evaluate(`(()=>{const b=${expression};if(!b)throw Error('ELEMENT_MISSING');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const click=async expression=>{const p=await point(expression);await c('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await c('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})};
 const selectEl=`[...document.querySelectorAll('select')][4]`; // 0=Vista del mapa (pagina), 1=Tipo,2=Capacidad,3=Origen,4=Destino (modal teletransportado a <body>, despues)
 const setDestino=async value=>evaluate(`(()=>{const s=${selectEl};s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await c('Page.navigate',{url:base+'scripts/tests/map-route-browser.html'});await until('window.ready===true && harness.fibra.cables.length===1');
 // Cierra cualquier modal que haya quedado abierto de un paso anterior
 // (p.ej. el formulario sigue abierto tras cancelar el dialogo de
 // confirmacion) antes de reabrir -- si no, el overlay superpuesto del
 // formulario intercepta el click dirigido al boton de abajo (CDP clickea
 // por coordenada, no por elemento).
 const openEdit=async()=>{await evaluate('harness.view.value.showCableForm=false;harness.view.value.showCableHilos=false');await evaluate('harness.view.value.openCableHilos(harness.fibra.cables[0])');await until(button('Editar datos del cable')+'!==undefined');await click(button('Editar datos del cable'));await until(selectEl+'!==undefined')};

 // 1) ADMIN: intenta desvincular el destino (conectado a MUFA SINTETICA) -> rechazado antes de llegar al servidor, mensaje claro, cable sin cambios.
 await openEdit();
 assert.equal(await evaluate(`${selectEl}.value`),'infra:mufa');
 await setDestino('');
 await click(button('Guardar'));
 await until('document.body.innerText.includes("Solo un SUPERADMIN puede desvincular")');
 assert.equal(await evaluate('harness.db.cable.destino_infra_id'),'mufa');
 checks.push('ADMIN_BLOCKED_BEFORE_SERVER_NO_WRITE');
 await click(button('Cancelar'));

 // 2) SUPERADMIN: mismo intento -> pide confirmacion con el nombre real, cancelar no cambia nada.
 await evaluate("harness.auth.role='SUPERADMIN'");
 await openEdit();
 await setDestino('');
 await click(button('Guardar'));
 await until(`document.body.innerText.includes('"MUFA SINTETICA"')`);
 checks.push('SUPERADMIN_CONFIRM_SHOWS_REAL_NAME');
 await click(button('Cancelar'));
 assert.equal(await evaluate('harness.db.cable.destino_infra_id'),'mufa','cancelar el dialogo no debe guardar nada');
 checks.push('CONFIRM_CANCEL_KEEPS_CONNECTION');

 // 3) SUPERADMIN confirma -> se guarda, el resto del cable se conserva.
 await openEdit();
 await setDestino('');
 await click(button('Guardar'));
 await until('document.body.innerText.includes("Desvincular")');
 await click(button('Desvincular'));
 await until('harness.db.cable.destino_infra_id===null');
 assert.equal(await evaluate('harness.db.cable.hilos_total'),12);
 assert.equal(await evaluate('harness.db.cable.origen_infra_id'),'nap','el OTRO extremo, que no se toco, sigue conectado');
 checks.push('SUPERADMIN_CONFIRMED_UNLINK_PERSISTS_REST_UNCHANGED');

 assert.equal(errors.length,0,JSON.stringify(errors));
 const report={status:'PASS',at:new Date().toISOString(),checks,fixtures:'synthetic-only',productionWrites:0,newDependencies:0};
 mkdirSync('scripts/inventory-auth-lab/runtime',{recursive:true});writeFileSync('scripts/inventory-auth-lab/runtime/map-cable-unlink-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await send('Browser.close');
}catch(e){console.error(JSON.stringify({status:'FAIL',error:e.message,lastStep,errors,checks}));process.exitCode=1}finally{ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r))}
