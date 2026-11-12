// Navegador sin sesion: rutas reales y guardas HTTP. Bloquea escrituras y terceros.
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'pppoe-published-access-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
 '--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0',
 '--host-resolver-rules=MAP panel.rayconetworks.com 192.168.55.201','--user-data-dir='+profile,'about:blank'],
 {windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,writesBlocked=0;const failures=[],exceptions=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{
  let log='';const timer=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);
  chrome.on('error',reject);chrome.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
 });
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let sequence=0;const pending=new Map();
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 ws.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const task=pending.get(message.id);pending.delete(message.id);if(task)message.error?task.reject(Error('CDP_FAILED')):task.resolve(message.result);}
  if(message.method==='Runtime.exceptionThrown')exceptions.push('JS_EXCEPTION');
  if(message.method==='Fetch.requestPaused'){
   const {request,requestId}=message.params,url=new URL(request.url);
   if(!['GET','HEAD'].includes(request.method)||url.origin!=='https://panel.rayconetworks.com'){
    if(!['GET','HEAD'].includes(request.method))writesBlocked++;
    send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},message.sessionId).catch(()=>failures.push('INTERCEPT_FAILED'));
   }else send('Fetch.continueRequest',{requestId},message.sessionId).catch(()=>failures.push('INTERCEPT_FAILED'));
  }
 };
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 const evaluate=async expression=>{
  const result=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error('BROWSER_EVALUATION_FAILED');return result.result.value;
 };
 const routes=['/dashboard','/olt','/soporte','/inventario','/facturacion'];
 for(const route of routes){
  await c('Page.navigate',{url:'https://panel.rayconetworks.com'+route});
  let ready=false;
  for(let i=0;i<150;i++){
   if(await evaluate('location.pathname==="/login"&&!!document.querySelector("input[type=password]")')){ready=true;break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'LOGIN_ROUTE_FAILED_'+route);
 }
 const guarded=['/api/dashboard/pppoe-profiles','/api/olt-devices','/api/soporte/ranking-tecnicos','/api/campo-inventory/units','/api/invoices'];
 const statuses=await evaluate('(async()=>{const paths='+JSON.stringify(guarded)+';const out={};for(const path of paths){out[path]=(await fetch(path,{cache:"no-store"})).status;}out.invalidToken=(await fetch("/api/dashboard/pppoe-profiles",{headers:{Authorization:"Bearer invalid.diagnostic.token"},cache:"no-store"})).status;return out;})()');
 for(const code of Object.values(statuses))assert.equal(code,401);
 assert.equal(writesBlocked,0);assert.deepEqual(failures,[]);assert.deepEqual(exceptions,[]);
 console.log(JSON.stringify({status:'PASS',productionReadOnly:true,authenticatedUserSession:false,routesRedirectToLogin:routes,guarded,httpStatuses:statuses,writesBlocked,exceptions:exceptions.length}));
}finally{ws?.close();chrome.kill();}
