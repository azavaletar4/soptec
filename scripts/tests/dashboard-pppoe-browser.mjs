// Vite local; auth/datos ficticios. Bloquea red externa y escrituras de negocio.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'dashboard-pppoe-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0',
  '--user-data-dir='+profile,'about:blank'], {windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws; const checks=[]; const exceptions=[];
const staticBuild=process.argv.includes('--static');
try {
  const endpoint=await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);
    chrome.on('error',reject);chrome.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let sequence=0;const pending=new Map();
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);pending.delete(message.id);if(task)message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const c=(method,params={})=>send(method,params,sessionId);
  await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
  await c('Network.setBlockedURLs',{urls:['*supabase.co/*','*/api/*','*fonts.googleapis.com/*','*fonts.gstatic.com/*']});
  const evaluate=async expression=>{const result=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('UI_TIMEOUT '+expression+' DIAGNOSTIC '+await evaluate('JSON.stringify({url:location.href,body:document.body.innerText.slice(0,1800),calls:window.__pppCalls})')+' EXCEPTIONS '+JSON.stringify(exceptions));};
  function fixture(){
    const uid='00000000-0000-4000-8000-000000000001';const now=Math.floor(Date.now()/1000);
    const enc=value=>btoa(JSON.stringify(value)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
    const user={id:uid,aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
    localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_at:now+3600,expires_in:3600,user}));
    window.__pppCalls=0;window.__writes=0;window.__mode='fresh';window.__pppTimers=new Map();let timerId=900000;
    const realTimeout=window.setTimeout.bind(window),realClear=window.clearTimeout.bind(window);
    window.setTimeout=(callback,ms,...args)=>{if(ms===60000){const id=++timerId;window.__pppTimers.set(id,()=>callback(...args));return id;}return realTimeout(callback,ms,...args);};
    window.clearTimeout=id=>{if(!window.__pppTimers.delete(id))realClear(id);};
    window.__tickPpp=async()=>{const tasks=[...window.__pppTimers.values()];window.__pppTimers.clear();for(const task of tasks)await task();};
    const realFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(!url.hostname.endsWith('.supabase.co')&&!url.pathname.startsWith('/api/'))return realFetch(input,init);
      const method=init.method||(input instanceof Request?input.method:'GET');
      if(!['GET','HEAD'].includes(method)){window.__writes++;return new Response('{}',{status:403});}
      const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Content-Range':'*/0'}});
      if(url.pathname==='/api/dashboard/pppoe-profiles'){
        window.__pppCalls++;
        if(window.__mode==='http-error')return response({error:'PRIVATE_NETWORK_DETAIL'},503);
        if(window.__mode==='slow')await new Promise((resolve,reject)=>{window.__releasePpp=resolve;init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
        const unavailable=window.__mode==='unavailable';
        const profiles=[['Dedicado','Profile_Dedicado',50,40],['Balanceador','Profile_Balanceador',90,80],['WAN 4','Profile_Gamer_04',10,6],['WAN 5','Profile_Gamer_05',9,7]]
          .map(([label,profile,registered,connected])=>({label,profile,registered:unavailable?null:registered,connected:unavailable?null:connected}));
        return response({status:unavailable?'unavailable':window.__mode==='stale'?'stale':'fresh',lastSuccessAt:unavailable?null:'2026-11-12T18:04:05Z',profiles,partial:window.__mode==='partial',message:window.__mode==='stale'?'No se pudo actualizar desde el administrador.':null});
      }
      if(url.pathname==='/api/dashboard/network-status')return response({olt:{total:1,ok:1,down:0,untested:0},mikrotik:{total:1,ok:1,down:0,untested:0},problems:[]});
      if(url.pathname==='/api/dashboard/olt-summary')return response({unconfigured:0,online:8,offline:2,lowSignal:1,deviceCount:1,scanComplete:true,checkedAt:'2026-11-12T18:00:00Z'});
      const table=url.pathname.split('/').at(-1);
      if(table==='user')return response(user);
      if(table==='profiles')return response({id:uid,full_name:'Admin de prueba',role:sessionStorage.getItem('pppoe-test-role')||'ADMIN',active:true,must_change_password:false});
      if(table==='company_settings')return response({id:1,lunes_hora_ingreso:'07:30:00',resto_hora_ingreso:'08:00:00',tolerancia_minutos:10});
      if(table==='asistencia_registros')return response(null);
      return response([]);
    };
  }
  await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')()'});
  await c('Emulation.setTimezoneOverride',{timezoneId:'Asia/Tokyo'});
  await c('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});
  await until('document.querySelectorAll("[data-testid=pppoe-card]").length===4 && document.body.innerText.includes("Lectura actual")');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-testid=pppoe-connected]")].map(el=>el.innerText)'),['40','80','6','7']);
  const section=()=>evaluate('document.querySelector("[data-testid=pppoe-section]").innerText');
  assert.match(await section(),/13:04:05/);assert.doesNotMatch(await section(),/Morosos/);
  assert.match(await evaluate('document.body.innerText'),/Soporte/);
  checks.push('FOUR_EXACT_PROFILES','CONNECTED_PRIMARY','PERU_TIME_IN_TOKYO_BROWSER','OTHER_DASHBOARD_INDICATORS_RETAINED');
  for(const width of [1440,375,320]){
    await c('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<500});
    assert.equal(await evaluate('(()=>{const el=document.querySelector("[data-testid=pppoe-section]");return el.scrollWidth<=el.clientWidth+1;})()'),true);
    const columns=await evaluate('new Set([...document.querySelectorAll("[data-testid=pppoe-card]")].map(el=>Math.round(el.getBoundingClientRect().left))).size');
    assert.equal(columns,width===1440?4:1);
    checks.push('LAYOUT_'+width);
  }
  const prior=await evaluate('window.__pppCalls');await evaluate('window.__tickPpp()');
  assert.equal(await evaluate('window.__pppCalls'),prior+1);checks.push('AUTO_REFRESH_60_SECONDS');
  await evaluate('window.__mode="stale";window.__tickPpp()');await until('document.body.innerText.includes("Datos desactualizados")');
  assert.match(await section(),/40/);assert.match(await section(),/13:04:05/);checks.push('SERVER_STALE_RETAINS_VALUES_AND_DATE');
  await evaluate('window.__mode="http-error";window.__tickPpp()');await until('document.body.innerText.includes("última lectura exitosa")');
  assert.doesNotMatch(await section(),/PRIVATE_NETWORK_DETAIL/);assert.match(await section(),/Desactualizado/);checks.push('NETWORK_ERROR_IS_EXPLICIT');
  await evaluate('window.__mode="unavailable";window.__tickPpp()');await until('document.body.innerText.includes("Sin lectura exitosa")');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-testid=pppoe-connected]")].map(el=>el.innerText)'),['—','—','—','—']);checks.push('NO_DATA_NEVER_FAKE_ZERO');
  await evaluate('window.__mode="partial";window.__tickPpp()');await until('document.body.innerText.includes("Lectura parcial")');checks.push('PARTIAL_READING_VISIBLE');
  if(!staticBuild){
  await evaluate('(async()=>{const m=await import("/src/stores/auth.ts");m.useAuthStore().role="FACTURACION";})()');
  await until('document.querySelector("[data-testid=pppoe-section]")===null');
  assert.equal(await evaluate('window.__pppTimers.size'),0);checks.push('ROLE_REVOCATION_STOPS_POLLING');
  await evaluate('(async()=>{window.__mode="fresh";const m=await import("/src/stores/auth.ts");m.useAuthStore().role="ADMIN";})()');
  await until('document.body.innerText.includes("Lectura actual")');
  }
  await evaluate('window.__mode="slow";window.__pendingPoll=window.__tickPpp();void 0');
  await until('document.querySelector("[data-testid=pppoe-section] button").disabled');
  const inFlightCalls=await evaluate('window.__pppCalls');
  await evaluate('document.querySelector("[data-testid=pppoe-section] button").click()');
  assert.equal(await evaluate('window.__pppCalls'),inFlightCalls);checks.push('NO_OVERLAPPING_REFRESH');
  await evaluate('document.querySelector(".dv-shortcuts").open=true;[...document.querySelectorAll("button")].find(el=>el.innerText.includes("Nuevo cliente")).click()');
  await until('location.pathname==="/clientes" && document.querySelector("[data-testid=pppoe-section]")===null');
  await evaluate('window.__pendingPoll');assert.equal(await evaluate('window.__pppTimers.size'),0);checks.push('UNMOUNT_ABORTS_AND_CLEARS_TIMER');
  assert.equal(await evaluate('window.__writes'),0);checks.push('NO_BUSINESS_WRITES');
  if(staticBuild){
    await evaluate('sessionStorage.setItem("pppoe-test-role","FACTURACION")');
    await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});
    await until('document.body.innerText.includes("Soporte")');
    assert.equal(await evaluate('document.querySelector("[data-testid=pppoe-section]")'),null);
    assert.equal(await evaluate('window.__pppCalls'),0);checks.push('STATIC_BUILD_PERMISSION_RETAINED');
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  console.log(JSON.stringify({synthetic:true,productionAccess:false,staticBuild,checks,exceptions:0}));
  await send('Browser.close');
} finally {ws?.close();chrome.kill();}
