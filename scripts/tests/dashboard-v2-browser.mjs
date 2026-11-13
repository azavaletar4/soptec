// Build real servido en localhost. API/Auth ficticios; red externa y escrituras bloqueadas.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const out=path.resolve(option('--output-dir','docs/dashboard-v2-final-local'));await fs.mkdir(out,{recursive:true});
const root=path.resolve(option('--dist','dist'));
const server=http.createServer(async(req,res)=>{
 try{
  if(!['GET','HEAD'].includes(req.method)||req.url.startsWith('/api/')){res.writeHead(403);res.end();return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  let file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return;}
  if(!path.extname(pathname))file=path.join(root,'index.html');
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
  const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(5194,'127.0.0.1',resolve);});
const profile=await fs.mkdtemp(path.join(tmpdir(),'rayco-dashboard-v2-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,replacedFonts=0;const checks=[],exceptions=[],forbidden=[],writeAttempts=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.on('error',reject);chrome.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let seq=0;const pending=new Map();
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);pending.delete(message.id);if(task)message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result);}
  if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if(message.method==='Runtime.bindingCalled'&&message.params.name==='__reportMutation')writeAttempts.push(message.params.payload);
  if(message.method==='Fetch.requestPaused'){
   const {request,requestId}=message.params;
   if(request.url.startsWith('https://fonts.googleapis.com/')){
    replacedFonts++;send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/css'}],body:''},message.sessionId);return;
   }
   if(!request.url.startsWith('http://127.0.0.1:5194/')&&!request.url.startsWith('data:')||!['GET','HEAD'].includes(request.method)){
    forbidden.push(request.url);send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},message.sessionId);
   }else send('Fetch.continueRequest',{requestId},message.sessionId);
  }
 };
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Runtime.addBinding',{name:'__reportMutation'});
 await c('Network.setBlockedURLs',{urls:['*supabase.co/*','wss://*']});
 await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 const evaluate=async expression=>{const result=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const until=async expression=>{for(let i=0;i<180;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('UI_TIMEOUT '+expression+' '+await evaluate('document.body.innerText.slice(-1800)'));};
 const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
 const size=async(width,height=1000)=>{
  await c('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
  // El sidebar existente anima su transform durante 200 ms al cruzar 768 px.
  await new Promise(resolve=>setTimeout(resolve,240));
 };
 const capture=async(name,full=true)=>{
  await evaluate('document.activeElement?.blur();window.scrollTo(0,0)');await new Promise(resolve=>setTimeout(resolve,100));
  const {cssContentSize}=await c('Page.getLayoutMetrics');
  const result=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,...(full?{clip:{x:0,y:0,width:cssContentSize.width,height:cssContentSize.height,scale:1}}:{})});
  await fs.writeFile(path.join(out,name+'.png'),Buffer.from(result.data,'base64'));
 };
 function fixture(){
  const uid='00000000-0000-4000-8000-000000000001',now=Math.floor(Date.now()/1000);
  const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  const user={id:uid,aud:'authenticated',role:'authenticated',email:'lab@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:enc({alg:'HS256'})+'.'+enc({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_at:now+3600,expires_in:3600,user}));
  window.__mode='fresh';window.__summaryMode=sessionStorage.getItem('v2-initial-summary')||'good';window.__writes=0;window.__api=[];window.__db=[];window.__timeouts=new Map();window.__intervals=new Map();window.__releases=[];
  const timeout=window.setTimeout.bind(window),clearTimeout=window.clearTimeout.bind(window);
  const interval=window.setInterval.bind(window),clearInterval=window.clearInterval.bind(window);let next=800000;
  window.setTimeout=(fn,ms,...args)=>{if(ms===60000){const id=++next;window.__timeouts.set(id,()=>fn(...args));return id;}return timeout(fn,ms,...args);};
  window.clearTimeout=id=>{if(!window.__timeouts.delete(id))clearTimeout(id);};
  window.setInterval=(fn,ms,...args)=>{if(ms===60000||ms===1000){const id=++next;window.__intervals.set(id,{ms,fn:()=>fn(...args)});return id;}return interval(fn,ms,...args);};
  window.clearInterval=id=>{if(!window.__intervals.delete(id))clearInterval(id);};
  window.__tickPpp=async()=>{const jobs=[...window.__timeouts.values()];window.__timeouts.clear();await Promise.all(jobs.map(fn=>fn()));};
  window.__tickGeneral=async()=>{await Promise.all([...window.__intervals.values()].filter(x=>x.ms===60000).map(x=>x.fn()));};
  const lifecycle=Array.from({length:93},(_,i)=>({id:'lab-client-'+i,status:i<80?'active':i<87?'suspended':i<91?'prospect':'retired',service_contracts:i<80?[{status:'active'}]:i<87?[{status:'suspended'}]:[],installations:[]}));
  const clients=Array.from({length:5},(_,i)=>({id:'lab-recent-'+i,first_name:'Cliente laboratorio',last_name:String(i+1),status:i===1?'prospect':i===3?'suspended':'active',created_at:new Date().toISOString()}));
  const tickets=Array.from({length:5},(_,i)=>({id:'lab-ticket-'+i,ticket_number:'LAB-'+(i+1),title:['Intermitencia de prueba','Revisión de enlace','Pérdida de señal','Validación de servicio','Revisión de instalación'][i],status:i%2?'in_progress':'open',clients:{first_name:'Cliente laboratorio',last_name:String(i+1)},created_at:new Date().toISOString()}));
  const monthly=Array.from({length:6},(_,i)=>({created_at:new Date(new Date().getFullYear(),new Date().getMonth()-5+i,10,12).toISOString(),paid_at:new Date(new Date().getFullYear(),new Date().getMonth()-5+i,10,12).toISOString(),amount:[1200,1300,1400,1500,1600,1800][i],collected:[1000,1100,1200,1300,1400,1500][i]}));
  const original=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(!url.hostname.endsWith('.supabase.co')&&!url.pathname.startsWith('/api/'))return original(input,init);
   const method=init.method||(input instanceof Request?input.method:'GET');
   if(!['GET','HEAD'].includes(method)){window.__writes++;window.__reportMutation(method);return new Response('{}',{status:403});}
   const response=(data,count=0,status=200)=>new Response(method==='HEAD'?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Content-Range':'0-0/'+count}});
   if(url.pathname.startsWith('/api/'))window.__api.push(url.pathname);
   else window.__db.push(url.pathname+'?'+url.searchParams.get('select'));
   if(url.pathname==='/api/dashboard/pppoe-profiles'){
    if(window.__mode==='http-error')return response({error:'Sin conexión'},0,503);
    if(window.__mode==='denied')return response({error:'No autorizado'},0,401);
    if(window.__mode==='slow')await new Promise((resolve,reject)=>{window.__releasePpp=resolve;init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
    const unavailable=window.__mode==='unavailable';
    const profiles=[['Dedicado','Profile_Dedicado',302,281],['Balanceador','Profile_Balanceador',610,566],['WAN 4','Profile_Gamer_04',75,71],['WAN 5','Profile_Gamer_05',54,48]].map(([label,profile,registered,connected])=>({label,profile,registered:unavailable?null:registered,connected:unavailable?null:connected}));
    return response({status:unavailable?'unavailable':window.__mode==='stale'?'stale':'fresh',lastSuccessAt:unavailable?null:window.__pppReadAt||'2026-11-12T18:04:05Z',profiles,partial:window.__mode==='partial',message:window.__mode==='stale'?'No se pudo actualizar desde el administrador.':null});
   }
   if(url.pathname.startsWith('/api/dashboard/')){
    if(window.__summaryMode==='error')return response({error:'Red de laboratorio no disponible'},0,503);
    if(window.__summaryMode==='slow')await new Promise(resolve=>window.__releases.push(resolve));
   }
   if(url.pathname==='/api/dashboard/network-status')return response(window.__summaryMode==='untested'?{olt:{total:2,ok:0,down:0,untested:2},mikrotik:{total:3,ok:0,down:0,untested:3},problems:[]}:{olt:{total:2,ok:2,down:0,untested:0},mikrotik:{total:3,ok:1,down:1,untested:1},problems:[{kind:'MikroTik',name:'Nodo laboratorio',host:'192.0.2.15'}]});
   if(url.pathname==='/api/dashboard/olt-summary')return response(window.__summaryMode==='no-olt-cache'?{unconfigured:0,online:0,offline:0,lowSignal:0,deviceCount:2,scanComplete:false,checkedAt:null}:{unconfigured:6,online:843,offline:17,lowSignal:9,deviceCount:2,scanComplete:false,checkedAt:window.__oltReadAt||'2026-11-12T18:00:00Z'});
   if(url.pathname==='/api/olt-devices')return response(Array.from({length:window.__manyOlts?2:1},(_,i)=>({id:'lab-olt-'+i,name:'OLT laboratorio',host:'192.0.2.20',brand:'zte',telnet_port:23,username:'lab',zone_id:null,is_active:true,created_at:new Date().toISOString(),lat:null,lng:null})));
   if(url.pathname.startsWith('/api/'))return response([]);
   const table=url.pathname.split('/').at(-1),select=url.searchParams.get('select')||'';
   if(table==='user')return response(user);
   if(table==='profiles')return response({id:uid,full_name:'Administrador laboratorio',role:sessionStorage.getItem('v2-role')||'ADMIN',active:true,must_change_password:false});
   if(table==='company_settings')return response({id:1,lunes_hora_ingreso:'07:30:00',resto_hora_ingreso:'08:00:00',tolerancia_minutos:10});
   if(table==='asistencia_registros')return response(null);
   if(table==='clients')return response(window.__summaryMode==='empty'?[]:select.includes('service_contracts')?lifecycle:clients,select.includes('service_contracts')?93:5);
   if(table==='service_contracts')return response([],87);
   if(table==='tickets')return method==='HEAD'?response(null,url.searchParams.has('priority')?4:url.searchParams.get('status')==='eq.open'?24:9):response(window.__summaryMode==='empty'?[]:tickets,5);
   if(table==='invoices'){
    if(select==='amount,due_date')return response([{amount:100,due_date:'2000-01-01'},{amount:200,due_date:'2000-01-02'},{amount:150,due_date:'2099-01-01'}]);
    if(select==='amount,status')return response([{amount:1000,status:'paid'},{amount:500,status:'paid'},{amount:300,status:'pending'}]);
    if(select==='amount,created_at')return response(monthly.map(x=>({amount:x.amount,created_at:x.created_at})));
    if(select==='amount,paid_at')return response(monthly.map(x=>({amount:x.collected,paid_at:x.paid_at})));
    const boundary=Date.parse((url.searchParams.get('paid_at')||'').replace(/^gte\./,''));
    const firstOfMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime();
    return response(boundary>firstOfMonth?(window.__roundToday?[{amount:1.005}]:[{amount:200},{amount:50}]):[{amount:1200},{amount:300}]);
   }
   return response([]);
  };
  document.addEventListener('DOMContentLoaded',()=>{
   const label=document.createElement('div');label.textContent='LOCAL · DATOS SIMULADOS';label.setAttribute('aria-hidden','true');label.style.cssText='position:fixed;right:10px;bottom:7px;z-index:9999;padding:4px 7px;border:1px solid #dfe7ec;background:#fff;color:#617585;font:9px Segoe UI;pointer-events:none';document.body.append(label);
  });
 }
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')()'});
 await c('Emulation.setTimezoneOverride',{timezoneId:'Asia/Tokyo'});
 await size(1440,1100);await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});
 await until('document.querySelector(".dv-portfolio")&&document.body.innerText.includes("Lectura disponible")');
 assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-testid=pppoe-connected]")].map(x=>x.innerText)'),['281','566','71','48']);
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".dv-portfolio strong")].map(x=>x.innerText)'),['80','7','4','87']);
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".dv-support-counts strong")].map(x=>x.innerText)'),['24','9','4']);
 assert.match(await evaluate('document.querySelector(".dv-billing").innerText'),/1,500\.00/);
 assert.match(await evaluate('document.querySelector(".dv-billing").innerText'),/1,800\.00/);
 assert.match(await evaluate('document.querySelector(".dv-overdue").innerText'),/450\.00/);
 assert.match(await evaluate('document.querySelector(".dv-billing-pairs>div:nth-child(2)").innerText'),/250\.00/);
 assert.equal(await evaluate('document.querySelector(".dv-rate").innerText.startsWith("83")'),true);
 assert.match(await evaluate('document.querySelector("[data-testid=pppoe-section]").innerText'),/13:04:05/);
 assert.match(await evaluate('document.querySelector("[data-testid=ont-summary]").innerText'),/13:00/);
 assert.equal(await evaluate('document.querySelectorAll(".dv-section-index,.profile-port").length'),0);
 checks.push('REAL_STORES_API_BINDINGS_NOT_PROTOTYPE_VALUES','BILLING_AND_LIFECYCLE_MEANINGS_RETAINED','PERU_TIMES_IN_TOKYO','NO_DECORATIVE_NUMBERS');
 assert.equal(await evaluate('document.querySelectorAll("[data-testid=recent-client]").length'),5);
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#revenue-chart")).display!=="none"'),true);
 assert.equal(await evaluate('[...document.querySelectorAll("[data-testid=dashboard-v2] > section")].at(-1).dataset.testid'),'attention');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".dv-attention .dv-severity")].map(x=>x.innerText)'),['Urgente','Incidencia','Revisar']);
 await capture('desktop');checks.push('DESKTOP_ALL_CLIENTS_CHART_OPEN_ATTENTION_LAST');
 const ioBefore=await evaluate('({api:window.__api.length,db:window.__db.length})');
 await click('.dv-more');assert.equal(await evaluate('document.querySelectorAll(".dv-ticket-list li").length'),5);await click('.dv-more');checks.push('ALL_RECENT_TICKETS_ACCESSIBLE');
 await size(834,1112);await capture('tablet');
 await size(1024,834);await capture('tablet-landscape');
 await size(390,844);await until('document.querySelector("[data-testid=chart-toggle]")!==null');
 assert.equal(await evaluate('document.querySelectorAll("[data-testid=recent-client]").length'),3);
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#revenue-chart")).display'),'none');
 assert.ok(await evaluate('document.querySelector("[data-testid=chart-toggle] svg").getBoundingClientRect().height<=18'));
 await capture('mobile-full');await capture('mobile',false);checks.push('MOBILE_THREE_CLIENTS_CHART_INITIALLY_COLLAPSED');
 await click('[data-testid=chart-toggle]');assert.equal(await evaluate('getComputedStyle(document.querySelector("#revenue-chart")).display!=="none"'),true);await capture('mobile-chart-expanded');await click('[data-testid=chart-toggle]');checks.push('MOBILE_CHART_EXPANDS_AND_COLLAPSES');
 const layouts=[];
 for(const width of [320,375,390,540,700,701,767,768,820,834,950,951,1024,1150,1151,1440,1920]){
  await size(width,1000);await new Promise(resolve=>setTimeout(resolve,70));
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'PAGE_OVERFLOW_'+width);
  assert.ok(await evaluate('document.querySelector("[data-testid=dashboard-v2]").scrollWidth<=document.querySelector("[data-testid=dashboard-v2]").clientWidth+1'),'DASHBOARD_OVERFLOW_'+width);
  const layout=await evaluate(`(()=>{
   const box=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
   return {width:innerWidth,dashboard:box('[data-testid=dashboard-v2]'),main:box('main'),sidebar:box('aside'),pppoe:box('[data-testid=pppoe-section]'),columns:new Set([...document.querySelectorAll('[data-testid=pppoe-card]')].map(el=>Math.round(el.getBoundingClientRect().left))).size};
  })()`);
  layouts.push(layout);
  assert.equal(layout.columns,layout.pppoe.width<=540?1:4,'PPPOE_CONTAINER_COLUMNS_'+width);
  if(width>=768){assert.equal(layout.sidebar.width,256,'SIDEBAR_WIDTH_'+width);assert.equal(layout.sidebar.left,0,'SIDEBAR_POSITION_'+width);}
  if(width>=768&&width<=1150){assert.ok(Math.abs(layout.dashboard.left-layout.main.left-16)<1);assert.ok(Math.abs(layout.main.right-layout.dashboard.right-16)<1);}
  const secondarySizes=await evaluate(`[...document.querySelectorAll('.pppoe-reading,.pppoe-source,.pppoe-registered,.dv-reading,.dv-offline,.dv-optical-footer,.dv-equipment-header,.dv-equipment-row small')].map(el=>parseFloat(getComputedStyle(el).fontSize))`);
  assert.ok(secondarySizes.every(px=>px>=11),'SECONDARY_TEXT_SIZE_'+width);
 }
 checks.push('RESPONSIVE_17_WIDTHS_320_TO_1920','TABLET_INSETS_AND_SIDEBAR_UNCHANGED','PPPOE_RESPONDS_TO_AVAILABLE_CONTAINER_WIDTH','SECONDARY_TEXT_MINIMUM_11PX');
 assert.deepEqual(await evaluate('({api:window.__api.length,db:window.__db.length})'),ioBefore);checks.push('VISUAL_INTERACTIONS_ADD_NO_READS');
 const before=await evaluate('({ppp:window.__api.filter(x=>x.endsWith("pppoe-profiles")).length,network:window.__api.filter(x=>x.endsWith("network-status")).length})');
 const sourceTimes=()=>evaluate(`({summary:document.querySelector('[data-testid=summary-updated] time')?.dateTime,ppp:document.querySelector('.pppoe-date time')?.dateTime,ont:document.querySelector('[data-testid=ont-reading] time')?.dateTime})`);
 const timesBefore=await sourceTimes();
 await evaluate('window.__tickGeneral()');
 assert.equal(await evaluate('window.__api.filter(x=>x.endsWith("network-status")).length'),before.network+1);
 assert.equal(await evaluate('window.__api.filter(x=>x.endsWith("pppoe-profiles")).length'),before.ppp);
 checks.push('GENERAL_REFRESH_60S_INDEPENDENT_FROM_PPPOE');
 const timesAfter=await sourceTimes();
 assert.ok(Date.parse(timesAfter.summary)>Date.parse(timesBefore.summary));
 assert.equal(timesAfter.ppp,timesBefore.ppp);assert.equal(timesAfter.ont,timesBefore.ont);
 assert.match(await evaluate('document.querySelector("[data-testid=summary-updated]").innerText'),/Dashboard.*\d{2}\/\d{2}\/\d{4}/s);
 assert.match(await evaluate('document.querySelector("[data-testid=ont-reading]").innerText'),/Caché ONT/);
 assert.match(await evaluate('document.querySelector(".dv-equipment .dv-reading").innerText'),/Fecha de prueba no disponible/);
 checks.push('GENERAL_SUCCESS_DOES_NOT_REDATE_SOURCES','SOURCE_LABELS_AND_UNAVAILABLE_EQUIPMENT_TIME_EXPLICIT');
 await evaluate('window.__pppReadAt="2001-01-02T08:09:10Z";window.__oltReadAt="2001-01-02T07:08:09Z";window.__tickPpp()');
 await evaluate('window.__tickGeneral()');
 const oldTimes=await sourceTimes();
 assert.equal(oldTimes.ppp,'2001-01-02T08:09:10Z');assert.equal(oldTimes.ont,'2001-01-02T07:08:09Z');
 assert.match(await evaluate('document.querySelector(".pppoe-date").innerText'),/02\/01\/2001, 03:09:10/);
 assert.match(await evaluate('document.querySelector("[data-testid=ont-reading]").innerText'),/02\/01\/2001, 02:08:09/);
 assert.doesNotMatch(await evaluate('document.querySelector("[data-testid=pppoe-section]").innerText'),/Lectura actual/);
 await size(834,1112);await capture('source-dates');
 await evaluate('delete window.__pppReadAt;delete window.__oltReadAt;window.__tickPpp()');await evaluate('window.__tickGeneral()');
 checks.push('OLD_SOURCE_DATES_RETAINED_AFTER_SUCCESSFUL_GENERAL_REFRESH');
 await evaluate('window.__roundToday=true;window.__tickGeneral()');
 assert.match(await evaluate('document.querySelector(".dv-billing-pairs>div:nth-child(2)").innerText'),/1\.00/);
 await evaluate('window.__roundToday=false;window.__tickGeneral()');checks.push('ORIGINAL_TWO_DECIMAL_ROUNDING');
 for(const mode of ['stale','http-error','unavailable','partial']){
  await evaluate('window.__mode='+JSON.stringify(mode)+';window.__tickPpp()');
  await until('!document.querySelector("[data-testid=pppoe-section] button").disabled');
  if(mode==='stale'||mode==='http-error')assert.match(await evaluate('document.querySelector("[data-testid=pppoe-section]").innerText'),/Desactualizado/);
  if(mode==='unavailable')assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-testid=pppoe-connected]")].map(x=>x.innerText)'),['—','—','—','—']);
  if(mode==='partial')assert.match(await evaluate('document.querySelector("[data-testid=pppoe-section]").innerText'),/Lectura parcial/);
 }
 checks.push('PPPOE_STALE_ERRORS_PARTIAL_NO_FALSE_ZERO');
 await evaluate('window.__mode="denied";window.__tickPpp()');await until('!document.querySelector("[data-testid=pppoe-section] button").disabled');
 assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-testid=pppoe-connected]")].map(x=>x.innerText)'),['—','—','—','—']);checks.push('HTTP_AUTH_REJECTION_CLEARS_PPPOE_VALUES');
 await evaluate('window.__mode="fresh";window.__tickPpp()');
 const successfulTimes=await sourceTimes();
 await evaluate('window.__summaryMode="error";window.__tickGeneral()');await until('document.querySelector("[data-testid=summary-error]")!==null');
 assert.deepEqual(await sourceTimes(),successfulTimes);
 assert.match(await evaluate('document.querySelector("[data-testid=summary-error]").innerText'),/última actualización exitosa/);
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".dv-portfolio strong")].map(x=>x.innerText)'),['80','7','4','87']);
 assert.match(await evaluate('document.querySelector(".dv-network").innerText'),/Estado sin actualizar/);await size(390,844);await capture('summary-stale');checks.push('SUMMARY_FAILURE_RETAINS_VALUES_AND_SUCCESS_TIME');
 await evaluate('window.__summaryMode="no-olt-cache";window.__tickGeneral()');await until('document.body.innerText.includes("Sin lectura de ONT disponible")');
 assert.equal(await evaluate('document.querySelector(".dv-online")'),null);checks.push('MISSING_OLT_CACHE_NOT_PRESENTED_AS_ZERO');
 await evaluate('window.__summaryMode="untested";window.__tickGeneral()');await until('document.querySelector(".dv-network").innerText.includes("Sin pruebas registradas")');checks.push('UNTESTED_NETWORK_NOT_HEALTHY');
 await evaluate('window.__summaryMode="empty";window.__tickGeneral()');await until('document.body.innerText.includes("Sin clientes todavía")');assert.match(await evaluate('document.body.innerText'),/Sin tickets todavía/);checks.push('EMPTY_LISTS');
 await evaluate('window.__summaryMode="good";window.__tickGeneral()');await until('document.querySelectorAll("[data-testid=recent-client]").length===3');
 // El router real recibe el destino; se cancela antes de cargar modulos ajenos.
 const holdNavigation=()=>evaluate('window.__navigation=[];document.querySelector("#app").__vue_app__.config.globalProperties.$router.beforeEach(to=>{if(to.path!=="/dashboard"){window.__navigation.push({path:to.path,query:to.query});return false;}})');
 await holdNavigation();await click('.dv-detail-grid section:first-child .dv-link');await until('window.__navigation.length===1');assert.equal(await evaluate('window.__navigation[0].path'),'/clientes');checks.push('CLIENTS_FULL_LIST_ROUTE');
 await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});await until('document.querySelector(".dv-mini.warning")!==null');
 assert.equal(await evaluate('getComputedStyle(document.querySelector("#revenue-chart")).display'),'none');
 assert.equal(await evaluate('document.querySelectorAll("[data-testid=recent-client]").length'),3);checks.push('MOBILE_FRESH_NAVIGATION_DEFAULTS');
 await holdNavigation();await click('.dv-mini.warning');await until('window.__navigation.length===1');assert.equal(await evaluate('window.__navigation[0].path'),'/olt/lab-olt-0');assert.equal(await evaluate('window.__navigation[0].query.filter'),'lowSignal');checks.push('SINGLE_OLT_FILTER_NAVIGATION');
 await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});await until('document.querySelector(".dv-mini.warning")!==null');
 await holdNavigation();await evaluate('window.__manyOlts=true');await click('.dv-mini.warning');await until('window.__navigation.length===1');assert.equal(await evaluate('window.__navigation[0].path'),'/olt');checks.push('MULTIPLE_OLT_LIST_NAVIGATION');
 await evaluate('sessionStorage.setItem("v2-initial-summary","slow")');await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});
 await until('document.body.innerText.includes("Cargando panel...")&&window.__releases.length===2');
 assert.equal(await evaluate('document.querySelector(".dv-portfolio")'),null);assert.equal(await evaluate(`document.querySelector('button[aria-label="Actualizar Dashboard"]').disabled`),true);
 await capture('initial-loading');await evaluate('window.__summaryMode="good";window.__releases.splice(0).forEach(fn=>fn())');await until('document.querySelector(".dv-portfolio")!==null');checks.push('INITIAL_LOADING_NO_FAKE_SUMMARY');
 await evaluate('sessionStorage.setItem("v2-initial-summary","error")');await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});await until('document.querySelector("[data-testid=summary-error]")!==null&&document.body.innerText.includes("Lectura disponible")');
 assert.equal(await evaluate('document.querySelector(".dv-portfolio")'),null);assert.equal(await evaluate('document.querySelectorAll("[data-testid=pppoe-card]").length'),4);checks.push('INITIAL_SUMMARY_ERROR_PPPOE_INDEPENDENT');
 await evaluate('sessionStorage.removeItem("v2-initial-summary")');
 await evaluate('sessionStorage.setItem("v2-role","FACTURACION")');await c('Page.navigate',{url:'http://127.0.0.1:5194/dashboard'});await until('document.querySelector(".dv-portfolio")!==null');
 assert.equal(await evaluate('document.querySelector("[data-testid=pppoe-section]")'),null);assert.equal(await evaluate('window.__api.filter(x=>x.endsWith("pppoe-profiles")).length'),0);checks.push('PPPOE_PERMISSION_RETAINED');
 assert.equal(await evaluate('window.__writes'),0);assert.deepEqual(writeAttempts,[]);assert.deepEqual(forbidden,[]);assert.deepEqual(exceptions,[]);
 checks.push('ZERO_BUSINESS_WRITES_AND_EXTERNAL_REQUESTS');
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'PASS',builtFrontend:true,syntheticResponses:true,productionAccess:false,writes:0,externalRequests:0,preexistingFontStylesServedLocally:replacedFonts,checks,layouts,exceptions},null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',checks:checks.length,captures:out}));
 await send('Browser.close');ws.close();chrome.kill();
 // Regresion existente contra el mismo build: polling, no solapamiento y cancelacion.
 const regression=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/tests/dashboard-pppoe-browser.mjs','--static'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
  child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(log):reject(Error(log)));
 });
 await fs.writeFile(path.join(out,'pppoe-regression.json'),String(regression).trim()+'\n');
 console.log(String(regression).trim());
}finally{ws?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
