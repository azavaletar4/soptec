import {build,preview} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const disabled=process.argv.includes('--no-satellite'),root=realpathSync.native(process.cwd()),outDir='dist/map-route-browser-'+process.pid;
const fixture={name:'route-test-fixture',enforce:'pre',transform(code,id){
 if(id.endsWith('/components/layout/AppLayout.vue'))return '<script setup>import ConfirmHost from "../ConfirmHost.vue";import ToastHost from "../ToastHost.vue";</script><template><main><slot/></main><ConfirmHost/><ToastHost/></template>';
 if(id.endsWith('/views/mapa/RedMapView.vue'))return code.replace('</script>','defineExpose({openCableHilos,get map(){return map},routeCable,selectedBasemap,showOlt,showCables});\n</script>');
}};
await build({configFile:false,root,plugins:[fixture,vue(),tailwindcss()],resolve:{alias:{'@':join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://synthetic.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic'),'import.meta.env.VITE_MAPTILER_KEY':JSON.stringify(disabled?'':'synthetic'),'import.meta.env.VITE_MAPTILER_LICENSED':JSON.stringify(disabled?'':'true')},logLevel:'error',build:{target:'esnext',outDir,rollupOptions:{input:join(root,'scripts/tests/map-route-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0}}),base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-route-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,c,sequence=0,lastStep='start';const pending=new Map(),errors=[],checks=[],tiles=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1])}})});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,t=setTimeout(()=>reject(Error('CDP_TIMEOUT_'+method)),15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params,sessionId}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused'){
  const u=new URL(m.params.request.url),local=u.origin===new URL(base).origin;tiles.push(local?'local':u.hostname+u.pathname);
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
 const drag=async(expression,dx=35,dy=-20)=>{const p=await point(expression);await c('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await c('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});for(let n=1;n<=8;n++)await c('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:p.x+dx*n/8,y:p.y+dy*n/8});await c('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p.x+dx,y:p.y+dy});await new Promise(r=>setTimeout(r,80))};
 const open=async()=>{await evaluate('harness.open()');await until(button('Editar trazado')+'!==undefined');await click(button('Editar trazado'));await until('document.querySelector("[data-testid=route-editor]")!==null')};
 const vertex2=`document.querySelector('.route-vertex[title^="Vértice 2"]')`;
 const undoBtn=`document.querySelector('button[title="Ctrl+Z"]')`,redoBtn=`document.querySelector('button[title="Ctrl+Y"]')`;
 const segPoint=async(idx,frac)=>evaluate(`(()=>{const m=harness.view.value.map;const d=harness.draft();const a=d[${idx}],b=d[${idx+1}];const ll=harness.L.latLng(a[0]+(b[0]-a[0])*${frac},a[1]+(b[1]-a[1])*${frac});const p=m.latLngToContainerPoint(ll);const r=m.getContainer().getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y}})()`);
 const dragAt=async(p,dx,dy)=>{await c('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await c('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});for(let n=1;n<=8;n++)await c('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:p.x+dx*n/8,y:p.y+dy*n/8});await c('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p.x+dx,y:p.y+dy});await new Promise(r=>setTimeout(r,80))};
 await c('Page.navigate',{url:base+'scripts/tests/map-route-browser.html'});await until('window.ready===true && harness.fibra.cables.length===1');await until('document.querySelectorAll(".leaflet-interactive").length>0');
 if(disabled){
  // Legacy --no-satellite flag now checks availability without credentials.
  assert.equal(await evaluate('document.querySelector("option[value=satellite]").disabled'),false);assert.equal(await evaluate('document.querySelector("option[value=hybrid]").disabled'),false);
  assert.equal(tiles.some(u=>u.includes('api.maptiler.com')||u.includes('tile.googleapis.com')),false);checks.push('FREE_VIEWS_ENABLED_WITHOUT_PROVIDER_KEY');
 }else{
  await open();const original=await evaluate('harness.db.cable.path');
  assert.equal(await evaluate('document.querySelectorAll(".route-locked").length'),2);
  assert.equal(await evaluate(button('Mover recorrido completo')+'.disabled'),true);
  assert.equal(await evaluate('document.querySelectorAll(".route-segment-hit").length'),0);checks.push('NO_SEGMENT_MOVE_WHEN_BOTH_ENDS_LOCKED');
  assert.equal(await evaluate(undoBtn+'.disabled'),true);assert.equal(await evaluate(redoBtn+'.disabled'),true);checks.push('UNDO_REDO_DISABLED_ON_FRESH_EDITOR');
  await drag(vertex2);const changed=await evaluate('harness.draft()');assert.notDeepEqual(changed,original);assert.deepEqual(changed[0],original[0]);assert.deepEqual(changed.at(-1),original.at(-1));assert.deepEqual(await evaluate('harness.db.cable.path'),original);checks.push('REAL_DRAG_DRAFT_ONLY_CONNECTED_ENDS_FIXED');
  await click('document.querySelector(".route-midpoint")');assert.equal((await evaluate('harness.draft()')).length,4);await click(button('Quitar vértice seleccionado'));assert.equal((await evaluate('harness.draft()')).length,3);checks.push('ADD_REMOVE_VERTEX');
  await click(button('Restaurar trazado original'));assert.deepEqual(await evaluate('harness.draft()'),original);checks.push('RESTORE_ORIGINAL_WITHOUT_WRITES');
  assert.equal(await evaluate(redoBtn+'.disabled'),true);
  await drag(vertex2);const draggedForUndo=await evaluate('harness.draft()');assert.equal(await evaluate(undoBtn+'.disabled'),false);
  await click(undoBtn);assert.deepEqual(await evaluate('harness.draft()'),original);assert.equal(await evaluate(redoBtn+'.disabled'),false);
  await click(redoBtn);assert.deepEqual(await evaluate('harness.draft()'),draggedForUndo);
  await click(undoBtn);assert.deepEqual(await evaluate('harness.draft()'),original);
  await click('document.querySelector(".route-midpoint")');assert.equal((await evaluate('harness.draft()')).length,4);
  await click(undoBtn);assert.deepEqual(await evaluate('harness.draft()'),original);
  checks.push('UNDO_REDO_DRAG_AND_INSERT');
  await drag(vertex2);const beforeSave=await evaluate('harness.draft()');await click(button('Guardar trazado'));await until('document.querySelector("[data-testid=route-editor]")===null');assert.deepEqual(await evaluate('harness.db.cable.path'),beforeSave);assert.equal(await evaluate('harness.db.cable.metraje'),987);assert.equal(await evaluate('harness.db.cable.hilos_total'),12);assert.equal(await evaluate('harness.db.cable.origen_infra_id'),'nap');checks.push('SAVE_ONLY_PATH_KEEP_LENGTH_CAPACITY_LINKS');
  await c('Page.navigate',{url:base+'scripts/tests/map-route-browser.html'});await until('window.ready===true && harness.fibra.cables.length===1');assert.deepEqual(await evaluate('JSON.parse(JSON.stringify(harness.fibra.cables[0].path))'),beforeSave);checks.push('RELOAD_PERSISTED_GEOMETRY');
  await open();await drag(vertex2);await click(button('Cancelar trazado'));await until('document.querySelector("[data-testid=route-editor]")===null');assert.deepEqual(await evaluate('harness.db.cable.path'),beforeSave);assert.equal(await evaluate('harness.writes'),0);checks.push('CANCEL_PRESERVES_DATABASE');
  await open();await drag(vertex2);const view=await evaluate('({center:harness.view.value.map.getCenter(),zoom:harness.view.value.map.getZoom(),draft:harness.draft()})');await evaluate('harness.view.value.showOlt=false');
  for(const mode of ['satellite','hybrid','streets']){await evaluate(`(()=>{const s=document.querySelector('[aria-label="Vista del mapa"]');s.value='${mode}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await until(`harness.view.value.selectedBasemap==='${mode}'`);assert.deepEqual(await evaluate('({center:harness.view.value.map.getCenter(),zoom:harness.view.value.map.getZoom(),draft:harness.draft()})'),view);assert.equal(await evaluate('harness.view.value.showOlt'),false);}
  checks.push('ALL_BASEMAPS_KEEP_VIEW_FILTERS_SELECTION_DRAFT');
  const draftBeforePan=await evaluate('harness.draft()');await drag('document.querySelector(".leaflet-container")',70,30);assert.deepEqual(await evaluate('harness.draft()'),draftBeforePan);checks.push('MAP_PAN_NEVER_MOVES_CABLE');
  await evaluate('harness.concurrent()');await click(button('Guardar trazado'));await until('document.body.innerText.includes("El cable cambió")');assert.equal(await evaluate('harness.writes'),0);assert.notEqual(await evaluate('harness.draft()'),null);checks.push('CONCURRENT_EDIT_CONFLICT_KEEPS_DRAFT_NO_OVERWRITE');
  await click(button('Cancelar trazado'));await evaluate('harness.free()');await open();await click(button('Mover recorrido completo'));const freeBefore=await evaluate('harness.draft()');await drag('document.querySelector(".route-move-handle")',25,-15);const freeAfter=await evaluate('harness.draft()');assert.notDeepEqual(freeAfter,freeBefore);for(let i=0;i<freeAfter.length;i++){assert.ok(Math.abs((freeAfter[i][0]-freeBefore[i][0])-(freeAfter[0][0]-freeBefore[0][0]))<0.0000002)}checks.push('TRANSLATE_FREE_ROUTE_ONLY');
  await click(button('Editar vértices'));
  assert.equal(await evaluate('document.querySelectorAll(".route-segment-hit").length'),2);
  const beforeSeg=await evaluate('harness.draft()');const segPt=await segPoint(0,0.3);await dragAt(segPt,18,12);const afterSeg=await evaluate('harness.draft()');
  assert.notDeepEqual(afterSeg[0],beforeSeg[0]);assert.notDeepEqual(afterSeg[1],beforeSeg[1]);assert.deepEqual(afterSeg[2],beforeSeg[2]);
  const dLat0=afterSeg[0][0]-beforeSeg[0][0],dLng0=afterSeg[0][1]-beforeSeg[0][1];
  assert.ok(Math.abs((afterSeg[1][0]-beforeSeg[1][0])-dLat0)<0.0000002 && Math.abs((afterSeg[1][1]-beforeSeg[1][1])-dLng0)<0.0000002);
  checks.push('MOVE_SEGMENT_BOTH_FREE_ENDPOINTS_TOGETHER');
  await click(undoBtn);assert.deepEqual(await evaluate('harness.draft()'),beforeSeg);checks.push('MOVE_SEGMENT_UNDOABLE');
  // Reportado por el propietario (21/11/2026, video real): un cable SUELTO
  // (sin conectar) no se dejaba mover -- diagnosticado como el circulo de
  // 26px dificil de acertar con el mouse, no un error de logica. Prueba
  // puntual: arrastrar el VERTICE 1 (un extremo real, no el del medio) de
  // un cable con ambos extremos libres, algo que ninguna prueba anterior
  // cubria (solo se arrastraba el vertice del medio o el handle de mover
  // todo el recorrido).
  const vertex1 = `document.querySelector('.route-vertex[title^="Vértice 1"]')`;
  const beforeEndpointDrag = await evaluate('harness.draft()');
  await drag(vertex1, 15, -10);
  const afterEndpointDrag = await evaluate('harness.draft()');
  assert.notDeepEqual(afterEndpointDrag[0], beforeEndpointDrag[0]);
  assert.deepEqual(afterEndpointDrag[1], beforeEndpointDrag[1]);
  assert.deepEqual(afterEndpointDrag[2], beforeEndpointDrag[2]);
  checks.push('DRAG_FREE_ENDPOINT_VERTEX');
  await click(undoBtn);assert.deepEqual(await evaluate('harness.draft()'),beforeEndpointDrag);
  await evaluate('harness.auth.role=null');await until(button('Guardar trazado')+'.disabled');assert.equal(await evaluate('harness.writes'),0);await click(button('Cancelar trazado'));await evaluate('harness.open()');await until('document.querySelectorAll(".modal-overlay").length>0');assert.equal(await evaluate(button('Editar trazado')+'!==undefined'),false);checks.push('ROLE_REVOCATION_DISABLES_SAVE_AND_ENTRY');
  assert.ok(tiles.some(u=>u.includes('/s2cloudless_3857/')));assert.ok(tiles.some(u=>u.includes('/overlay_bright_3857/')));
  // Simulate a provider error after the successful switching checks.
  await evaluate('harness.view.value.selectedBasemap="satellite"');await until('harness.view.value.selectedBasemap==="satellite"');await evaluate('harness.tileError()');await until('harness.view.value.selectedBasemap==="streets"');checks.push('PROVIDER_FAILURE_RETURNS_TO_STREETS');
 }
 assert.equal(errors.length,0,JSON.stringify(errors));
 const report={status:'PASS',at:new Date().toISOString(),checks,fixtures:'synthetic-only',postgresTransport:'synthetic',externalNetwork:'proxy-blocked; tiles fulfilled locally',productionWrites:0,newDependencies:0};
 mkdirSync('scripts/inventory-auth-lab/runtime',{recursive:true});writeFileSync('scripts/inventory-auth-lab/runtime/map-route-browser'+(disabled?'-unconfigured':'')+'.json',JSON.stringify(report,null,2)+'\n');const png=await c('Page.captureScreenshot',{format:'png'});writeFileSync('scripts/inventory-auth-lab/runtime/map-route-browser'+(disabled?'-unconfigured':'')+'.png',Buffer.from(png.data,'base64'));console.log(JSON.stringify(report));await send('Browser.close');
}catch(e){let diagnostic;try{const r=await c('Runtime.evaluate',{expression:'JSON.stringify({draft:harness.draft(),controls:[...document.querySelectorAll(".route-vertex,.route-midpoint")].map(e=>{const r=e.getBoundingClientRect();return {title:e.title,x:r.x,y:r.y,top:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.className}})})',returnByValue:true});diagnostic=r.result.value;const png=await c('Page.captureScreenshot',{format:'png'});mkdirSync('scripts/inventory-auth-lab/runtime',{recursive:true});writeFileSync('scripts/inventory-auth-lab/runtime/map-route-browser-failure.png',Buffer.from(png.data,'base64'));}catch{}console.error(JSON.stringify({status:'FAIL',error:e.message,lastStep,errors,checks,diagnostic}));process.exitCode=1;}finally{ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r));}
