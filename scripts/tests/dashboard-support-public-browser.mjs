// HTTPS publicado real, perfil nuevo sin sesión. Nunca simula Auth ni datos.
import {spawn} from 'node:child_process';import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'dashboard-support-public-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;const exceptions=[],mutations=[];
try{
 const endpoint=await new Promise((r,j)=>{let log='';const timer=setTimeout(()=>j(Error('CHROME_TIMEOUT')),20000);chrome.on('error',j);chrome.stderr.on('data',x=>{log+=x;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);r(m[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();
 const send=(method,params={},sessionId)=>new Promise((r,j)=>{const id=++seq;const timer=setTimeout(()=>j(Error('CDP_TIMEOUT:'+method)),30000);pending.set(id,{resolve:v=>{clearTimeout(timer);r(v);},reject:e=>{clearTimeout(timer);j(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);
  if(m.method==='Fetch.requestPaused'){const {request,requestId}=m.params;if(!['GET','HEAD'].includes(request.method)){mutations.push(request.method);send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},m.sessionId);}else send('Fetch.continueRequest',{requestId},m.sessionId);}
 };
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const c=(m,p={})=>send(m,p,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI_TIMEOUT');};
 const routes=['/dashboard','/soporte','/soporte/rutinas','/soporte/instalaciones','/clientes?section=pending_install','/clientes/prospectos','/facturacion','/inventario','/campo'];
 for(const route of routes){await c('Page.navigate',{url:'https://panel.rayconetworks.com'+route});await until('location.pathname==="/login"&&document.querySelector("input[type=password]")!==null');}
 const apis=await evaluate(`(async()=>{const paths=['/api/dashboard/pppoe-profiles','/api/dashboard/network-status','/api/dashboard/olt-summary'];const rows=[];for(const path of paths){const r=await fetch(path);rows.push({path,status:r.status});}const health=await(await fetch('/api/health')).json();return {rows,health:health.status};})()`);
 assert.ok(apis.rows.every(r=>r.status===401));assert.equal(apis.health,'ok');assert.deepEqual(exceptions,[]);assert.deepEqual(mutations,[]);
 const result={status:'PASS',at:new Date().toISOString(),realPublishedHttps:true,authenticatedSessionUsed:false,authOrDataFixtures:false,protectedRoutesRedirectToLogin:routes,apiGuards:apis.rows,health:apis.health,exceptions,writeAttempts:mutations,businessWrites:0};
 await writeFile('deploy/dashboard-support-prospects-20261113/public-browser.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));await send('Browser.close');
}finally{ws?.close();chrome.kill();}
