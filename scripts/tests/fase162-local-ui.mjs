// Browser-only synthetic test against the local build. No production traffic.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'fase162-ui-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;let seq=0;const pending=new Map(),errors=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});chrome.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const c=(m,p={})=>send(m,p,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Network.setBlockedURLs',{urls:['*supabase.co/*','*/api/*']});
 await c('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:1,mobile:true});
 await c('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 Android Chrome SmartRaycoApp/1.0'});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let i=0;i<80;i++){const v=await evaluate(expression);if(v)return v;await new Promise(r=>setTimeout(r,250));}console.log(await evaluate('document.body.innerText'));throw Error('UI_TIMEOUT');};
 const fixture=()=>{
  const tech='00000000-0000-4000-8000-000000000162',rid='10000000-0000-4000-8000-000000000162',client='20000000-0000-4000-8000-000000000162',contract='30000000-0000-4000-8000-000000000162';
  const role=localStorage.getItem('fixture-role')||'TECNICO_RED',now=Math.floor(Date.now()/1000),enc=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  const user={id:tech,aud:'authenticated',role:'authenticated',email:'ui@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:tech,role:'authenticated',aud:'authenticated',exp:now+3600,iat:now})+'.fake',refresh_token:'fake',expires_at:now+3600,expires_in:3600,token_type:'bearer',user}));
  window.__requests=[];
  // Existing drafts/closures use one DB with two independent createStore calls.
  // Seed both stores in this fixture; cold-profile initialization is a separate,
  // pre-existing issue, not an inventory write and not patched by Phase 162.
  const storageReady=new Promise((resolve,reject)=>{
   const open=indexedDB.open('smartrayco-campo',1);
   open.onupgradeneeded=()=>{for(const name of ['drafts','closures'])if(!open.result.objectStoreNames.contains(name))open.result.createObjectStore(name);};
   open.onsuccess=()=>{open.result.close();resolve();};open.onerror=()=>reject(open.error);
  });
  const products=[{id:'utp',name:'UTP',unit:'metro',is_active:true,is_serialized:false,current_stock:100},{id:'rj',name:'RJ45',unit:'unidad',is_active:true,is_serialized:false,current_stock:100},{id:'tv',name:'TV Box',unit:'unidad',is_active:true,is_serialized:true,current_stock:0}];
  const state=JSON.parse(localStorage.getItem('fixture-state')||'null')||{materials:[],events:[],units:[{id:'incoming',product_id:'tv',serial_number:'TV-NEW',status:'in_stock',client_id:null,contract_id:null,routine_id:null,product:products[2]},{id:'outgoing',product_id:'tv',serial_number:'TV-OLD',status:'assigned',client_id:client,contract_id:contract,routine_id:null,installation_id:'original',product:products[2]}]};
  window.fetch=async(input,init={})=>{
   await storageReady;
   const u=new URL(typeof input==='string'?input:input.url,location.href),method=init.method||(input instanceof Request?input.method:'GET');
   const headers=new Headers(init.headers||(input instanceof Request?input.headers:{}));
   let data=[];
   if(u.pathname.includes('/rpc/routine_inventory_operation')){
    const req=JSON.parse(init.body);window.__requests.push(req);
    if(req.p_action==='consume')state.materials.push({id:'m'+state.materials.length,product_id:req.p_payload.product_id,quantity:req.p_payload.quantity,movement_type:'egreso',reverses_movement_id:null,product:products.find(p=>p.id===req.p_payload.product_id)});
    if(req.p_action==='install'){const unit=state.units.find(x=>x.id===req.p_payload.unit_id);Object.assign(unit,{status:'pending_approval',routine_id:rid,client_id:client,contract_id:contract});}
    if(req.p_action==='withdraw')Object.assign(state.units.find(x=>x.id===req.p_payload.unit_id),{status:'en_recupero',routine_id:rid});
    if(req.p_action==='approve')state.units.find(x=>x.id===req.p_payload.unit_id).status='assigned';
    localStorage.setItem('fixture-state',JSON.stringify(state));data={operation_id:req.p_operation_id};
   }else if(method!=='GET'&&method!=='HEAD')return new Response('{}',{status:403});
   else if(u.pathname.startsWith('/api/'))data=[];
   else{
    const table=u.pathname.split('/').at(-1);
    if(table==='profiles')data=[{id:tech,full_name:'Técnico simulado',email:user.email,role,active:true,must_change_password:false}];
    if(table==='clients')data=[{id:client,first_name:'Cliente',last_name:'simulado',document_number:'TEST'}];
    if(table==='service_contracts')data=[{id:contract,contract_number:'CONTRATO-TEST',client_id:client,status:'active'}];
    if(table==='routines')data=[{id:rid,routine_number:'UI-162',title:'Rutina de prueba local',status:'in_progress',client_id:client,contract_id:contract,assigned_to:tech,tipo_rutina:'servicio_cliente',subtipo:'tv_box',priority:'normal',category:'otro',created_at:new Date().toISOString(),routine_returns:[]}];
    if(table==='job_assignees')data=[{job_type:'routine',job_id:rid,technician_id:tech,role:'leader',profile:{id:tech,full_name:'Técnico simulado'}}];
    if(table==='inventory_products')data=products;
    if(table==='inventory_movements')data=state.materials;
    if(table==='inventory_unit_events')data=state.events;
    if(table==='inventory_units'){
     data=state.units;
     if(u.searchParams.has('routine_id'))data=data.filter(x=>x.routine_id===rid);
     if(u.searchParams.has('client_id'))data=data.filter(x=>x.client_id===client);
     if(u.searchParams.has('product_id'))data=data.filter(x=>x.product_id==='tv');
    }
    if(table==='user')data=user;
    if(headers.get('accept')?.includes('vnd.pgrst.object+json')&&Array.isArray(data))data=data[0]??null;
   }
   return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','Content-Range':'0-0/1'}});
  };
 };
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')();'});
 await c('Page.navigate',{url:'http://127.0.0.1:4176/campo/routine/10000000-0000-4000-8000-000000000162'});
 await until(`!!document.querySelector(${JSON.stringify('[aria-label="Material de bodega"]')})`);
 const value=async(label,v)=>evaluate(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 const click=async text=>{await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes(${JSON.stringify(text)})&&!b.disabled)`);await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})&&!b.disabled).click()`);};
 await value('Material de bodega','utp');await value('Cantidad utilizada','12.75');await click('Registrar material utilizado');
 await until('document.body.innerText.includes("12.75 metro")');
 await value('Material de bodega','rj');await value('Cantidad utilizada','4');await click('Registrar material utilizado');
 await until('document.body.innerText.includes("4 unidad")');
 await value('Producto serializado','tv');await until(`document.querySelector(${JSON.stringify('[aria-label="Serie o MAC entrante"]')}).options.length>1`);
 await value('Serie o MAC entrante','incoming');await click('Registrar equipo (pendiente de aprobación)');
 await until('document.body.innerText.includes("pending_approval")');
 await value('Equipo a retirar','outgoing');await value('Motivo del movimiento','Retiro simulado');await click('Registrar retiro pendiente de recepción');
 await until('document.body.innerText.includes("en_recupero")');
 const requests=await evaluate('window.__requests');assert.deepEqual(requests.map(r=>r.p_action),['consume','consume','install','withdraw']);assert(requests.every(r=>r.p_operation_id));
 console.log('MOBILE_WEBVIEW_UA_MATERIALS_TVBOX_WITHDRAW_UI=PASS');
 await evaluate('localStorage.setItem("fixture-role","ADMIN")');
 await c('Page.navigate',{url:'http://127.0.0.1:4176/soporte/rutinas'});
 await until('Array.from(document.querySelectorAll(".cursor-pointer")).some(e=>e.textContent.includes("Rutina de prueba local"))');
 await evaluate('Array.from(document.querySelectorAll(".cursor-pointer")).find(e=>e.textContent.includes("Rutina de prueba local")).click()');
 await until('document.body.innerText.includes("Aprobar equipo")');await click('Aprobar equipo');
 await until('window.__requests.some(r=>r.p_action==="approve")');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('OFFICE_APPROVAL_UI=PASS; BROWSER_EXCEPTIONS=0; REAL_API_REQUESTS=0');
 const screenshot=await c('Page.captureScreenshot',{format:'png'});await writeFile('revision-fase2/fase162-ui.png',Buffer.from(screenshot.data,'base64'));
 await send('Browser.close');
}finally{if(ws)ws.close();chrome.kill();}
