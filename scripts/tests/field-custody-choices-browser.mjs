// Local built app only. Synthetic session/data; all API/DB requests intercepted or blocked.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const out=join(process.cwd(),'docs/evidencia-averias-rutinas-20261020');await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'field-custody-ui-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,id=0;const pending=new Map(),errors=[],checks=[];
try{
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Chrome timeout')),15000);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const seq=++id;pending.set(seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
 await c('Network.setBlockedURLs',{urls:['*supabase.co/*','*/api/*']});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const until=async expression=>{for(let i=0;i<70;i++){const r=await evaluate(expression);if(r)return r;await new Promise(r=>setTimeout(r,150));}throw Error('UI timeout: '+JSON.stringify(await evaluate('({text:document.body.innerText,requests:window.__requests})')));};
 await c('Page.navigate',{url:'http://127.0.0.1:5186/login'});await until('!!document.querySelector("input[type=password]")');
 await evaluate('new Promise((resolve,reject)=>{const r=indexedDB.open("smartrayco-campo",1);r.onupgradeneeded=()=>{r.result.createObjectStore("drafts");r.result.createObjectStore("closures")};r.onsuccess=()=>{r.result.close();resolve(true)};r.onerror=()=>reject(r.error)})');
 const fixture=()=>{
  const uid=localStorage.getItem('test-actor')||'00000000-0000-4000-8000-000000000181',other=uid.endsWith('181')?'00000000-0000-4000-8000-000000000182':'00000000-0000-4000-8000-000000000181';
  const rid='10000000-0000-4000-8000-000000000181',cid='20000000-0000-4000-8000-000000000181',contractId='30000000-0000-4000-8000-000000000181',pid='40000000-0000-4000-8000-000000000181',mid='40000000-0000-4000-8000-000000000183';
  const job=location.pathname.split('/')[2]||'ticket',now=Math.floor(Date.now()/1000),encode=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
  const user={id:uid,aud:'authenticated',role:'authenticated',email:'local@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:now+3600,user}));
  const profile={id:uid,full_name:'Técnico de prueba',role:'TECNICO_RED',active:true,must_change_password:false},client={id:cid,first_name:'Cliente',last_name:'de prueba',address:'Laboratorio'},contract={id:contractId,client_id:cid,contract_number:'LAB-001',service_type:'internet',status:'active',clients:client};
  const product={id:pid,name:'ONT Huawei en custodia',unit:'unidad',is_active:true,is_serialized:true,current_stock:0,inventory_categories:{slug:'onu'}};
  const own={id:'own-unit',serial_number:uid.endsWith('181')?'PROPIA-181':'PROPIA-182',mac_address:'AA:BB:CC:DD:EE:01',status:'with_technician',product:{id:pid,name:product.name}};
  window.EventSource=class{addEventListener(){}close(){}};window.__requests=[];window.__writes=[];window.__custodyFail=false;window.__empty=localStorage.getItem('test-empty')==='1';window.__consumed=false;window.__unitInstalled=false;window.__receipts={};
  const realFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
   const u=new URL(typeof input==='string'?input:input.url,location.href),method=init.method||(input instanceof Request?input.method:'GET');
   if(u.origin===location.origin&&!u.pathname.startsWith('/api/'))return realFetch(input,init);
   if(!u.hostname.endsWith('.supabase.co')&&!u.pathname.startsWith('/api/'))throw Error('External request blocked');
   const table=u.pathname.split('/').at(-1),headers={'Content-Type':'application/json'};window.__requests.push({path:u.pathname,method});let data=[];
   if(table==='my_inventory_custody'){
    if(window.__custodyFail)return new Response(JSON.stringify({message:'Custodia no disponible'}),{status:500,headers});
    data={materials:window.__empty||window.__consumed?[]:[{product:{id:mid,name:'Conector óptico',unit:'unidad'},quantity:1},{product:{id:'zero',name:'Agotado',unit:'unidad'},quantity:0}],units:window.__empty||window.__unitInstalled?[]:[own,{...own,id:'pending-return',status:'pending_return',product:{id:'returned-model',name:'Solo devolución'}}],pendingReturnRequests:[]};
   }else if(table==='campo_inventory_operation'||table==='routine_inventory_operation'){
    const body=JSON.parse(init.body);window.__writes.push(body);
    const qty=body.p_payload.quantity;
    data=qty>1?{materialRejected:true,operationId:body.p_operation_id,message:'Custodia insuficiente: disponible 1'}:{operationId:body.p_operation_id,jobType:job,jobId:rid,action:body.p_action,ids:['synthetic-movement'],at:new Date().toISOString()};
    if(qty===1)window.__consumed=true;
    if(['stage','install'].includes(body.p_action)){
     window.__unitInstalled=true;data=window.__receipts[body.p_operation_id]??data;window.__receipts[body.p_operation_id]=data;
     if(window.__loseEquipmentResponseOnce){window.__loseEquipmentResponseOnce=false;throw Error('Respuesta perdida de equipo');}
    }
   }else{
    if(!['GET','HEAD'].includes(method))throw Error('Unmocked write blocked: '+table);
    if(table==='user')data=user;
    if(table==='profiles')data=u.searchParams.has('id')?profile:[profile];
    if(['tickets','routines','installations'].includes(table))data=[{id:rid,title:job==='routine'?'Rutina de prueba':'Avería de prueba',client_id:cid,contract_id:contractId,status:'in_progress',assigned_to:uid,created_at:new Date().toISOString(),clients:client,contracts:contract}];
    if(table==='clients')data=u.searchParams.has('id')?client:[client];
    if(table==='service_contracts')data=u.searchParams.has('id')?contract:[contract];
    if(table==='job_assignees')data=[{job_type:job,job_id:rid,technician_id:uid,role:'support',profile},{job_type:job,job_id:rid,technician_id:other,role:'leader',profile:{...profile,id:other,full_name:'Otro integrante'}}];
    if(u.pathname.includes('/api/campo-inventory/')){
     if(table==='products')data=job==='installation'?[product]:[{...product,id:'warehouse-model',name:'MODELO GENERAL BODEGA'}];
     if(table==='contracts')data=[contract];
     if(table==='available'){
      const base={...own,product,product_id:pid,custody_technician_id:uid,client_id:null,contract_id:null,installation_id:null,ticket_id:null,routine_id:null};
      data=[base,{...base,id:'warehouse',status:'in_stock',serial_number:'BODEGA',custody_technician_id:null},{...base,id:'foreign',serial_number:'AJENA',custody_technician_id:other},{...base,id:'pending',serial_number:'DEVOLUCION',status:'pending_return'}];
     }
     data={context:{jobType:job,jobId:rid,actorId:uid,clientId:cid,contractId},items:data,next:null};
    }
   }
   return new Response(JSON.stringify(data),{status:200,headers});
  };
 };
 await c('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixture.toString()+')();'});
 await c('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const navigate=async job=>{await c('Page.navigate',{url:'http://127.0.0.1:5186/campo/'+job+'/10000000-0000-4000-8000-000000000181'});await until('document.body.innerText.includes("Conector óptico")');};
 const select=async(label,value)=>evaluate(`(()=>{const s=document.querySelector('select[aria-label=${JSON.stringify(label)}]');if(!s)throw Error('Missing select');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 for(const job of ['ticket','routine']){
  await navigate(job);
  if(job==='ticket')await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("y red"))?.click()');
  const modelLabel=job==='ticket'?'Modelo de tu custodia':'Producto serializado',unitLabel=job==='ticket'?'Serie o MAC de tu custodia':'Serie o MAC entrante';
  await until(`!!document.querySelector('select[aria-label="${modelLabel}"]')?.textContent.includes('ONT Huawei')`);
  assert(!(await evaluate('Array.from(document.querySelectorAll("select")).map(s=>s.textContent).join(" ")')).includes('MODELO GENERAL BODEGA'));
  await select(modelLabel,'40000000-0000-4000-8000-000000000181');
  await until(`document.querySelector('select[aria-label="${unitLabel}"]')?.textContent.includes('PROPIA-181')`);
  const text=await evaluate(`document.querySelector('select[aria-label="${unitLabel}"]').textContent`);assert(text.includes('AA:BB:CC:DD:EE:01'));assert(!text.includes('Solo devolución'));
  await select(unitLabel,'own-unit');
  const materialForScreenshot=job==='routine'?`document.querySelector(${JSON.stringify('select[aria-label="Material de tu custodia"]')})`:'Array.from(document.querySelectorAll("select")).find(s=>s.textContent.includes("Conector óptico"))';
  await evaluate(`(()=>{const s=${materialForScreenshot};s.value='40000000-0000-4000-8000-000000000183';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('select[aria-label="${modelLabel}"]').closest('section')?.scrollIntoView({block:'start'});window.scrollBy(0,-65);})()`);
  const shot=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,job==='ticket'?'AVERIA-MOVIL.png':'RUTINA-MOVIL.png'),Buffer.from(shot.data,'base64'));
  assert(!(await evaluate('window.__requests')).some(r=>r.path.endsWith('/available')));
  checks.push(job+': modelo fuera de catálogo, serie/MAC propia, cuadrilla y sin consulta a bodega');
  // Real Vue material form: confirmed shortage, corrected quantity and same UUID retry.
  const materialSelect=job==='routine'?`document.querySelector(${JSON.stringify('select[aria-label="Material de tu custodia"]')})`:'Array.from(document.querySelectorAll("select")).find(s=>s.textContent.includes("Conector óptico"))';
  await evaluate(`(()=>{const s=${materialSelect};s.value='40000000-0000-4000-8000-000000000183';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const qty=job==='routine'?`document.querySelector(${JSON.stringify('input[aria-label="Cantidad utilizada"]')})`:'Array.from(document.querySelectorAll("input[type=number]")).find(x=>x.max==="1")';
  await evaluate(`(()=>{const x=${qty};x.value='2';x.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const submit=job==='routine'?'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Registrar material utilizado")).click()':'Array.from(document.querySelectorAll("form")).find(f=>f.textContent.includes("Conector óptico")).dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))';
  await evaluate(submit);await until('document.body.innerText.includes("Custodia insuficiente")');
  await evaluate(`(()=>{const x=${qty};x.value='1';x.dispatchEvent(new Event('input',{bubbles:true}));})()`);await evaluate(submit);await until('window.__writes.length===2');
  const writes=await evaluate('window.__writes');assert.equal(writes[0].p_operation_id,writes[1].p_operation_id);assert.equal(writes[1].p_payload.quantity,1);checks.push(job+': rechazo y corrección real del formulario con mismo UUID');
  await until(`!Object.keys(localStorage).some(k=>k.startsWith('campo-inventory:v1:')||k.startsWith('routine-inventory:v1:')) && !document.querySelector('select[aria-label="${modelLabel}"]')?.disabled && document.querySelector('select[aria-label="${modelLabel}"]')?.options.length>1`);
  await select(modelLabel,'40000000-0000-4000-8000-000000000181');await until(`document.querySelector('select[aria-label="${unitLabel}"]')?.textContent.includes('PROPIA-181')`);await select(unitLabel,'own-unit');
  await evaluate('window.__loseEquipmentResponseOnce=true');
  await evaluate(job==='routine'?'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Registrar equipo (pendiente")).click()':`document.querySelector(${JSON.stringify('select[aria-label="Modelo de tu custodia"]')}).closest("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))`);
  await until('document.body.innerText.includes("Respuesta perdida de equipo")');
  await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Reintentar operación pendiente")||b.textContent.includes("Confirmar operación de inventario pendiente"))?.click()');
  await until('window.__writes.length===4');const equipmentWrites=await evaluate('window.__writes.slice(2)');assert.equal(equipmentWrites[0].p_operation_id,equipmentWrites[1].p_operation_id);checks.push(job+': equipo confirmado con respuesta perdida se recupera con mismo UUID');
  await until(`!Object.keys(localStorage).some(k=>k.startsWith('campo-inventory:v1:')||k.startsWith('routine-inventory:v1:'))`);
  await evaluate('localStorage.setItem("test-actor","00000000-0000-4000-8000-000000000182")');await navigate(job);
  if(job==='ticket')await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("y red"))?.click()');
  await select(modelLabel,'40000000-0000-4000-8000-000000000181');await until(`document.querySelector('select[aria-label="${unitLabel}"]')?.textContent.includes('PROPIA-182')`);
  assert(!(await evaluate(`document.querySelector('select[aria-label="${unitLabel}"]').textContent`)).includes('PROPIA-181'));checks.push(job+': sesión de otro integrante no hereda custodia');
  await evaluate('localStorage.removeItem("test-actor")');
  await evaluate('localStorage.setItem("test-empty","1")');
  await c('Page.navigate',{url:'http://127.0.0.1:5186/campo/'+job+'/10000000-0000-4000-8000-000000000181'});
  await until('document.body.innerText.includes("Sin equipos disponibles en tu custodia")');
  assert(!(await evaluate('Array.from(document.querySelectorAll("select")).map(s=>s.textContent).join(" ")')).includes('ONT Huawei'));checks.push(job+': sin custodia no expone catálogo');
  await evaluate('localStorage.removeItem("test-empty")');
  await navigate(job);await select(modelLabel,'40000000-0000-4000-8000-000000000181');await until(`document.querySelector('select[aria-label="${unitLabel}"]')?.textContent.includes('PROPIA-181')`);
  await evaluate('window.__custodyFail=true');await select(modelLabel,'40000000-0000-4000-8000-000000000181');
  await until('document.body.innerText.includes("No se pudo consultar tu custodia")');
  assert.equal(await evaluate(`document.querySelector('select[aria-label="${modelLabel}"]').options.length`),1);
  await evaluate('window.__custodyFail=false;Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Reintentar")?.click()');
  await until(`document.querySelector('select[aria-label="${modelLabel}"]')?.textContent.includes('ONT Huawei')`);checks.push(job+': error de consulta no expone catálogo y Reintentar recupera custodia');
 }
 await c('Page.navigate',{url:'http://127.0.0.1:5186/campo/installation/10000000-0000-4000-8000-000000000181'});
 await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("y red"))');
 await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("y red")).click()');
 await until('Array.from(document.querySelectorAll("select")).some(s=>s.options[0]?.textContent.includes("Producto (Modem")&&s.textContent.includes("ONT Huawei"))');
 await evaluate('(()=>{const s=Array.from(document.querySelectorAll("select")).find(s=>s.options[0]?.textContent.includes("Producto (Modem"));s.value="40000000-0000-4000-8000-000000000181";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
 await until('Array.from(document.querySelectorAll("select")).some(s=>s.options[0]?.textContent.includes("serie/MAC")&&s.textContent.includes("PROPIA-181"))');
 const altaSeries=await evaluate('Array.from(document.querySelectorAll("select")).find(s=>s.options[0]?.textContent.includes("serie/MAC")).textContent');
 for(const bad of ['BODEGA','AJENA','DEVOLUCION'])assert(!altaSeries.includes(bad));checks.push('installation: selector original conserva custodia propia y excluye bodega/ajena/devolución');
 assert.equal(errors.length,0,JSON.stringify(errors));
 await writeFile(join(out,'BROWSER-RESULTADO.json'),JSON.stringify({status:'PASS',checks,realWrites:0,browserExceptions:errors.length,viewport:'390x844'},null,2));
 console.log(JSON.stringify({status:'PASS',checks,out}));await send('Browser.close');
}finally{ws?.close();chrome.kill();}
