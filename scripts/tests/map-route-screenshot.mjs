import {build,preview} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=realpathSync.native(process.cwd()),outDir='dist/map-route-screenshot-'+process.pid;
const fixture={name:'route-screenshot-fixture',enforce:'pre',transform(code,id){
 if(id.endsWith('/components/layout/AppLayout.vue'))return '<script setup>import ConfirmHost from "../ConfirmHost.vue";import ToastHost from "../ToastHost.vue";</script><template><main><slot/></main><ConfirmHost/><ToastHost/></template>';
 if(id.endsWith('/views/mapa/RedMapView.vue'))return code.replace('</script>','defineExpose({openCableHilos,get map(){return map},routeCable,selectedBasemap,showOlt,showCables});\n</script>');
}};
await build({configFile:false,root,plugins:[fixture,vue(),tailwindcss()],resolve:{alias:{'@':join(root,'src')}},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://synthetic.invalid'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic')},logLevel:'error',build:{target:'esnext',outDir,rollupOptions:{input:join(root,'scripts/tests/map-route-browser.html')}}});
const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:0}}),base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-route-shot-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,c,sequence=0;const pending=new Map();
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const t=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(t);resolve(m[1])}})});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,t=setTimeout(()=>reject(Error('CDP_TIMEOUT_'+method)),15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r)},reject:e=>{clearTimeout(t);reject(e)}});ws.send(JSON.stringify({id,method,params,sessionId}))});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}if(m.method==='Fetch.requestPaused'){
  const u=new URL(m.params.request.url),local=u.origin===new URL(base).origin;
  void c(local?'Fetch.continueRequest':'Fetch.fulfillRequest',local?{requestId:m.params.requestId}:{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}).catch(()=>{});
 }};
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await c('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const until=async expression=>{for(let n=0;n<150;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,60))}throw Error('UI_TIMEOUT '+expression)};
 const button=label=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
 const point=expression=>evaluate(`(()=>{const b=${expression};const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const click=async expression=>{const p=await point(expression);await c('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await c('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})};
 const drag=async(expression,dx,dy)=>{const p=await point(expression);await c('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await c('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});for(let n=1;n<=8;n++)await c('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:p.x+dx*n/8,y:p.y+dy*n/8});await c('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p.x+dx,y:p.y+dy});await new Promise(r=>setTimeout(r,80))};
 await c('Page.navigate',{url:base+'scripts/tests/map-route-browser.html'});await until('window.ready===true && harness.fibra.cables.length===1');await until('document.querySelectorAll(".leaflet-interactive").length>0');
 await evaluate('harness.free()');
 await evaluate('harness.open()');await until(button('Editar trazado')+'!==undefined');await click(button('Editar trazado'));await until('document.querySelector("[data-testid=route-editor]")!==null');
 await drag(`document.querySelector('.route-vertex[title^="Vértice 2"]')`,45,-25);
 await new Promise(r=>setTimeout(r,150));
 mkdirSync('scripts/inventory-auth-lab/runtime',{recursive:true});
 const png=await c('Page.captureScreenshot',{format:'png'});
 writeFileSync('scripts/inventory-auth-lab/runtime/map-route-editor-live.png',Buffer.from(png.data,'base64'));
 console.log('OK: screenshot guardado');
 await send('Browser.close');
}catch(e){console.error('FAIL',e.message);process.exitCode=1}finally{ws?.close();chrome.kill();await new Promise(r=>server.httpServer.close(r))}
