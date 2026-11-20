// Targeted provider integration only. Reuses the existing editor/fixture unchanged.
import {build,preview} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const unauthorized=process.argv.includes('--unauthorized'),root=realpathSync.native(process.cwd()),outDir='dist/google-provider-test-'+process.pid;
const expose={name:'google-evaluation-fixture',enforce:'pre',transform(code,id){
 if(id.endsWith('/components/layout/AppLayout.vue'))return '<script setup>import ConfirmHost from "../ConfirmHost.vue";import ToastHost from "../ToastHost.vue";</script><template><main><slot/></main><ConfirmHost/><ToastHost/></template>';
 if(id.endsWith('/views/mapa/RedMapView.vue'))return code.replace('</script>','defineExpose({openCableHilos,get map(){return map},routeCable,selectedBasemap,showOlt,showCables});\n</script>');
}};
await build({configFile:false,root,plugins:[expose,vue(),tailwindcss()],resolve:{alias:{'@':join(root,'src')}},define:{
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://synthetic.invalid'),
 'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic'),
 'import.meta.env.VITE_NETWORK_MAP_PROVIDER':JSON.stringify('google'),
 'import.meta.env.VITE_GOOGLE_MAPS_KEY':JSON.stringify('synthetic-not-a-real-key'),
 'import.meta.env.VITE_GOOGLE_MAPS_AUTHORIZED':JSON.stringify(unauthorized?'false':'true'),
 'import.meta.env.VITE_MAPTILER_KEY':JSON.stringify(''),
 'import.meta.env.VITE_MAPTILER_LICENSED':JSON.stringify('false'),
},logLevel:'error',build:{target:'esnext',outDir,rollupOptions:{input:join(root,'scripts/tests/map-route-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0}}),base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'google-provider-synthetic-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,c,seq=0,lastStep='start';const tasks=new Map(),checks=[],errors=[],tilePaths=[];
function mockGoogle(){
 const original=window.fetch.bind(window);window.__googleCalls=[];window.__googleDenied=false;window.__googleSlow=false;window.__googleAborted=0;
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.hostname!=='tile.googleapis.com')return original(input,init);
  window.__googleCalls.push({path:url.pathname,options:init.body?JSON.parse(init.body):null});
  const reply=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  if(window.__googleDenied)return new Response('SYNTHETIC_PROVIDER_SECRET_MUST_NOT_REACH_UI',{status:403});
  if(window.__googleSlow)await new Promise((resolve,reject)=>{const t=setTimeout(resolve,500);const cancel=()=>{clearTimeout(t);window.__googleAborted++;reject(new DOMException('Synthetic cancel','AbortError'))};if(init.signal?.aborted)cancel();else init.signal?.addEventListener('abort',cancel,{once:true})});
  if(url.pathname==='/v1/createSession')return reply({session:'synthetic-'+JSON.parse(init.body).mapType+'-'+(JSON.parse(init.body).layerTypes?'hybrid':'plain'),expiry:String(Math.floor(Date.now()/1000)+3600),tileWidth:256,tileHeight:256,imageFormat:'png'});
  if(url.pathname==='/tile/v1/viewport')return reply({copyright:'Map data SYNTHETIC Google Maps / SYNTHETIC provider <b>plain text</b>',maxZoomRects:[{north:90,south:-90,west:-180,east:180,maxZoom:19}]});
  throw Error('UNEXPECTED_GOOGLE_ENDPOINT');
 };
}
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1])}})});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(Error('CDP_TIMEOUT_'+method)),15000);tasks.set(id,{resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params,sessionId}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=tasks.get(m.id);tasks.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused'){
  const url=new URL(m.params.request.url),local=url.origin===new URL(base).origin,googleTile=url.hostname==='tile.googleapis.com'&&url.pathname.startsWith('/v1/2dtiles/');
  if(!local)tilePaths.push(url.hostname+url.pathname); // Query/key/session are never saved.
  void c(local?'Fetch.continueRequest':googleTile?'Fetch.fulfillRequest':'Fetch.failRequest',local?{requestId:m.params.requestId}:googleTile?{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}:{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
 }};
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+mockGoogle.toString()+')()'});
 await c('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{lastStep=expression;const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let i=0;i<180;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,60))}throw Error('UI_TIMEOUT '+expression)};
 const button=label=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
 const click=expression=>evaluate(`(${expression}).click()`);
 const mode=async value=>{await evaluate(`(()=>{const select=document.querySelector('[aria-label="Vista del mapa"]');select.value='${value}';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await until(`harness.view.value.selectedBasemap==='${value}'`);await until('document.querySelector(".google-network-attribution")!==null')};
 await c('Page.navigate',{url:base+'scripts/tests/map-route-browser.html'});await until('window.ready===true && harness.fibra.cables.length===1');
 if(unauthorized){
  assert.equal(await evaluate('window.__googleCalls.length'),0);assert.equal(tilePaths.length,0);
  assert.equal(await evaluate('document.querySelector("[aria-label=\\"Vista del mapa\\"]").disabled'),true);
  checks.push('NO_AUTHORIZATION_ZERO_GOOGLE_OR_FALLBACK_REQUESTS');
 }else{
  await until('document.querySelector(".google-network-attribution img[alt=\\"Google Maps\\"]")!==null');
  await until('document.querySelector(".leaflet-tile")!==null');
  assert.ok(tilePaths.every(p=>p.startsWith('tile.googleapis.com/v1/2dtiles/')));checks.push('OFFICIAL_GOOGLE_TILES_ONLY');
  assert.equal(await evaluate('document.querySelector(".google-network-attribution").querySelector("b")'),null);
  assert.match(await evaluate('document.querySelector(".google-network-attribution").innerText'),/SYNTHETIC provider/);checks.push('OFFICIAL_LOGO_VIEWPORT_CREDIT_PLAIN_TEXT');
  await evaluate('harness.open()');await until(button('Editar trazado')+'!==undefined');await click(button('Editar trazado'));await until('document.querySelector(".route-midpoint")!==null');
  await click('document.querySelector(".route-midpoint")');const draft=await evaluate('harness.draft()');assert.equal(draft.length,4);
  const before=await evaluate('({center:harness.view.value.map.getCenter(),zoom:harness.view.value.map.getZoom(),draft:harness.draft(),markers:document.querySelectorAll(".route-vertex").length})');
  for(const next of ['satellite','hybrid','streets']){await mode(next);assert.deepEqual(await evaluate('({center:harness.view.value.map.getCenter(),zoom:harness.view.value.map.getZoom(),draft:harness.draft(),markers:document.querySelectorAll(".route-vertex").length})'),before)}
  checks.push('THREE_GOOGLE_VIEWS_KEEP_EXISTING_EDITOR_AND_GEOMETRY');
  assert.equal(await evaluate('window.__googleCalls.filter(c=>c.path==="/v1/createSession").some(c=>c.options.layerTypes?.includes("layerRoadmap")&&c.options.overlay===false)'),true);checks.push('HYBRID_IS_BLENDED_GOOGLE_IMAGERY_AND_LABELS');
  await evaluate('harness.view.value.map.panBy([40,25],{animate:false});void 0');await until('document.querySelector(".google-network-attribution")!==null');assert.deepEqual(await evaluate('harness.draft()'),draft);checks.push('VIEWPORT_MOVE_UPDATES_CREDIT_PRESERVES_DRAFT');
  await evaluate('window.__googleSlow=true;harness.view.value.selectedBasemap="satellite"');await new Promise(r=>setTimeout(r,80));await evaluate('harness.view.value.selectedBasemap="hybrid"');await new Promise(r=>setTimeout(r,650));await until('document.querySelector(".google-network-attribution")!==null');assert.ok(await evaluate('window.__googleAborted>0'));await evaluate('window.__googleSlow=false');checks.push('RAPID_MODE_CHANGE_IGNORES_STALE_RESPONSES');
  await click(button('Guardar trazado'));await until('document.querySelector("[data-testid=route-editor]")===null');assert.equal(await evaluate('harness.writes'),1);assert.equal(await evaluate('harness.db.cable.metraje'),987);checks.push('EXISTING_SAVE_PATH_ONLY_UNCHANGED');
  await evaluate('window.__googleDenied=true;harness.view.value.selectedBasemap="streets"');await until('document.body.innerText.includes("No se pudo validar Google Maps")');
  assert.equal(await evaluate('document.querySelector(".google-network-attribution")'),null);assert.equal(await evaluate('document.querySelectorAll(".leaflet-tile").length'),0);
  assert.equal(await evaluate('document.body.innerText.includes("SYNTHETIC_PROVIDER_SECRET")'),false);
  assert.ok(tilePaths.every(p=>p.startsWith('tile.googleapis.com/v1/2dtiles/')));checks.push('ERROR_STOPS_GOOGLE_NO_UNAUTHORIZED_OSM_FALLBACK');
  await evaluate('window.__googleDenied=false;harness.view.value.map.panBy([10,10],{animate:false});void 0');await until('document.querySelector(".google-network-attribution")!==null');await until('!document.body.innerText.includes("No se pudo validar Google Maps")');checks.push('RECOVERY_CLEARS_STALE_PROVIDER_ERROR');
 }
 assert.equal(errors.length,0,JSON.stringify(errors));
 const report={status:'PASS',at:new Date().toISOString(),checks,provider:'Google Map Tiles API via unchanged Leaflet editor',liveGoogleRequests:0,fixtures:'synthetic session, viewport, tiles and infrastructure',billingEnabled:false,productionWrites:0};
 mkdirSync('scripts/inventory-auth-lab/runtime',{recursive:true});writeFileSync('scripts/inventory-auth-lab/runtime/google-basemap-browser'+(unauthorized?'-unauthorized':'')+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await send('Browser.close');
}catch(e){console.error(JSON.stringify({status:'FAIL',error:e.message,lastStep,checks,errors}));process.exitCode=1;}finally{ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r));}
