// Focused layer integration. All infrastructure is synthetic; external requests
// are intercepted locally, even if legacy paid-provider flags are present.
import {build,preview} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const root=realpathSync.native(process.cwd()),outDir='dist/zero-cost-map-test-'+process.pid;
const expose={name:'zero-cost-map-fixture',enforce:'pre',transform(code,id){
 if(id.endsWith('/components/layout/AppLayout.vue'))return '<script setup>import ConfirmHost from "../ConfirmHost.vue";import ToastHost from "../ToastHost.vue";</script><template><main><slot/></main><ConfirmHost/><ToastHost/></template>';
 if(id.endsWith('/views/mapa/RedMapView.vue'))return code.replace('</script>','defineExpose({openCableHilos,get map(){return map},routeCable,selectedBasemap,showOlt,showCables});\n</script>');
}};
await build({configFile:false,root,plugins:[expose,vue(),tailwindcss()],resolve:{alias:{'@':join(root,'src')}},define:{
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://synthetic.invalid'),
 'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic'),
 'import.meta.env.VITE_NETWORK_MAP_PROVIDER':JSON.stringify('google'),
 'import.meta.env.VITE_GOOGLE_MAPS_KEY':JSON.stringify('synthetic-not-a-real-key'),
 'import.meta.env.VITE_GOOGLE_MAPS_AUTHORIZED':JSON.stringify('true'),
 'import.meta.env.VITE_MAPTILER_KEY':JSON.stringify('synthetic-not-a-real-key'),
 'import.meta.env.VITE_MAPTILER_LICENSED':JSON.stringify('true'),
},logLevel:'error',build:{target:'esnext',outDir,rollupOptions:{input:join(root,'scripts/tests/map-route-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0}}),base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'zero-cost-map-synthetic-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,c,seq=0,lastStep='start';const tasks=new Map(),checks=[],errors=[],requests=[];
// Valid 1px fixture (not satellite evidence).
const tile='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1])}})});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(Error('CDP_TIMEOUT_'+method)),15000);tasks.set(id,{resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params,sessionId}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=tasks.get(m.id);tasks.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused'){
  const url=new URL(m.params.request.url),local=url.origin===new URL(base).origin;
  const allowed=url.hostname==='tile.openstreetmap.org'||url.hostname==='tiles.maps.eox.at'&&/^\/wmts\/1\.0\.0\/(s2cloudless_3857|overlay_bright_3857)\/default\/g\/\d+\/\d+\/\d+\.(jpg|png)$/.test(url.pathname);
  if(!local)requests.push({host:url.hostname,path:url.pathname,hasQuery:!!url.search});
  void c(local?'Fetch.continueRequest':allowed?'Fetch.fulfillRequest':'Fetch.failRequest',local?{requestId:m.params.requestId}:allowed?{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'},{name:'Cache-Control',value:'max-age=604800'}],body:tile}:{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
 }};
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await c('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{lastStep=expression;const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let i=0;i<180;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,60))}throw Error('UI_TIMEOUT '+expression)};
 const button=label=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
 const click=expression=>evaluate(`(${expression}).click()`);
 const layers=()=>evaluate('(()=>{const a=[];harness.view.value.map.eachLayer(l=>{if(l instanceof harness.L.TileLayer)a.push({url:l._url,native:l.options.maxNativeZoom,zIndex:l.options.zIndex,buffer:l.options.keepBuffer,idle:l.options.updateWhenIdle,zooming:l.options.updateWhenZooming})});return a})()');
 const mode=async value=>{await evaluate(`(()=>{const s=document.querySelector('[aria-label="Vista del mapa"]');s.value='${value}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await until(`harness.view.value.selectedBasemap==='${value}'`);await until('document.querySelectorAll(".leaflet-tile-loaded").length>0')};
 const state=()=>evaluate('({center:harness.view.value.map.getCenter(),zoom:harness.view.value.map.getZoom(),draft:harness.draft(),markers:document.querySelectorAll(".leaflet-marker-icon").length,tooltips:[...document.querySelectorAll(".leaflet-tooltip")].map(n=>n.textContent).sort(),olt:harness.view.value.showOlt,cables:harness.view.value.showCables,selected:harness.view.value.routeCable?.id})');
 await c('Page.navigate',{url:base+'scripts/tests/map-route-browser.html'});await until('window.ready===true && harness.fibra.cables.length===1');await until('document.querySelectorAll(".leaflet-tile-loaded").length>0');
 assert.equal((await layers())[0].url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
 assert.equal(await evaluate('document.querySelector("[aria-label=\\"Vista del mapa\\"]").disabled'),false);checks.push('OSM_DEFAULT_NO_ACCOUNT_NO_DISABLED_VIEWS');
 await evaluate('harness.open()');await until(button('Editar trazado')+'!==undefined');await click(button('Editar trazado'));await until('document.querySelector(".route-midpoint")!==null');await click('document.querySelector(".route-midpoint")');
 await evaluate('harness.view.value.showOlt=false');await until('![...document.querySelectorAll(".leaflet-tooltip")].some(n=>n.textContent.includes("OLT SINTETICA"))');const before=await state();assert.equal(before.draft.length,4);
 for(const next of ['satellite','hybrid','streets','hybrid']){await mode(next);assert.deepEqual(await state(),before)}checks.push('VIEWS_PRESERVE_CENTER_ZOOM_DRAFT_FILTERS_SELECTION_INFRASTRUCTURE');
 let defs=await layers();assert.equal(defs.length,2);assert.match(defs[0].url,/s2cloudless_3857/);assert.match(defs[1].url,/overlay_bright_3857/);assert.ok(defs[1].zIndex>defs[0].zIndex);
 assert.ok(defs.every(d=>d.native===14&&d.buffer===0&&d.idle&&!d.zooming));checks.push('HYBRID_TRANSPARENT_LABEL_LAYER_BELOW_NETWORK_NO_PREFETCH');
 assert.match(await evaluate('document.querySelector(".leaflet-control-attribution").innerText'),/2016.*CC BY 4.0/);assert.match(await evaluate('document.querySelector(".leaflet-control-attribution").innerText'),/OpenStreetMap.*MapServer/);
 assert.match(await evaluate('document.querySelector("[data-testid=satellite-limit]").innerText'),/2016.*10 m.*zoom 14/);assert.ok(before.zoom>14);checks.push('ATTRIBUTION_AND_OLD_LOW_RESOLUTION_OVERZOOM_NOTICE');
 assert.ok(requests.filter(r=>r.host==='tiles.maps.eox.at').every(r=>Number(r.path.split('/')[6])<=14));checks.push('NO_IMAGERY_REQUEST_ABOVE_NATIVE_ZOOM_14');
 assert.equal(await evaluate('harness.writes'),0);await click(button('Cancelar trazado'));await until('document.querySelector("[data-testid=route-editor]")===null');assert.equal(await evaluate('harness.writes'),0);checks.push('CANCEL_WITH_LAYER_CHANGES_WRITES_NOTHING');
 await evaluate('harness.open()');await until(button('Editar trazado')+'!==undefined');await click(button('Editar trazado'));await until('document.querySelector(".route-midpoint")!==null');await click('document.querySelector(".route-midpoint")');
 const draft=await evaluate('harness.draft()');await mode('satellite');await click(button('Guardar trazado'));await until('document.querySelector("[data-testid=route-editor]")===null');
 assert.equal(await evaluate('harness.writes'),1);assert.equal(await evaluate('harness.db.cable.metraje'),987);assert.deepEqual(await evaluate('JSON.parse(JSON.stringify(harness.db.cable.path))'),draft);assert.deepEqual(await evaluate('Object.keys(harness.calls.find(c=>c.payload).payload)'),['path']);checks.push('SAVE_ON_SATELLITE_ONLY_SYNTHETIC_GEOMETRY_METRAGE_UNCHANGED');
 await c('Page.reload',{ignoreCache:false});await until('window.ready===true&&harness.fibra.cables[0].path.length===4');assert.deepEqual(await evaluate('JSON.parse(JSON.stringify(harness.db.cable.path))'),draft);checks.push('SYNTHETIC_GEOMETRY_RELOAD_PRESERVED');
 await mode('hybrid');await evaluate('harness.tileError()');await until('harness.view.value.selectedBasemap==="streets"');await until('document.querySelectorAll(".leaflet-tile-loaded").length>0');
 assert.equal((await layers()).length,1);assert.match((await layers())[0].url,/tile.openstreetmap.org/);assert.match(await evaluate('document.querySelector("[role=alert]").innerText'),/gratuito no está disponible/);assert.equal(await evaluate('harness.writes'),0);checks.push('EOX_ERROR_RETURNS_TO_FREE_OSM_NO_WRITE');
 await mode('hybrid');await until('document.querySelector("[role=alert]")===null');checks.push('USER_RETRY_CLEARS_PROVIDER_ERROR');
 assert.ok(requests.length>0);assert.ok(requests.every(r=>['tile.openstreetmap.org','tiles.maps.eox.at'].includes(r.host)&&!r.hasQuery));checks.push('LEGACY_GOOGLE_MAPTILER_FLAGS_IGNORED_NO_PAID_OR_KEY_REQUESTS');
 assert.equal(errors.length,0,JSON.stringify(errors));
 const report={status:'PASS',at:new Date().toISOString(),checks,requests:requests.length,hosts:[...new Set(requests.map(r=>r.host))],liveProviderRequests:0,fixtures:'synthetic infrastructure/database and intercepted tiles; live sample HTTP evidence recorded separately',billingEnabled:false,productionWrites:0};
 mkdirSync('scripts/inventory-auth-lab/runtime',{recursive:true});writeFileSync('scripts/inventory-auth-lab/runtime/zero-cost-basemap-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await send('Browser.close');
}catch(e){console.error(JSON.stringify({status:'FAIL',error:e.message,lastStep,checks,errors}));process.exitCode=1;}finally{ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r));}
