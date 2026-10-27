const { test }=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');

test('A3 navegador local: pareja autorizada y widget con API ficticia', {timeout:60000},async t=>{
 const base='http://127.0.0.1:5203';
 const vite=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port','5203','--strictPort'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,VITE_SUPABASE_URL:'https://attendance.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'},windowsHide:true,stdio:'pipe'});
 const profile=await mkdtemp(path.join(tmpdir(),'attendance-a3-'));
 let chrome,ws;let seq=0;const pending=new Map(),errors=[];
 try{
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'Vite local disponible');
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Chrome timeout')),15000);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Fetch.requestPaused')void handle(m.params);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const c=(m,p={})=>send(m,p,sessionId);
  const staff=[{id:'00000000-0000-0000-0000-000000000003',email:'tecnico@example.invalid',full_name:'Técnico Ficticio',role:'TECNICO_RED',phone:null,battery_level:null,latitude:null,longitude:null,last_ping_at:null}];
  const row={id:'00000000-0000-0000-0000-000000000070',user_id:'00000000-0000-0000-0000-000000000003',fecha_descanso:'2026-11-02',fecha_trabajo:'2026-11-01',hora_ingreso:'09:00:00',hora_salida:'18:00:00',estado:'activo',created_by:'00000000-0000-0000-0000-000000000001',created_at:'2026-10-26T15:00:00Z',cancelled_at:null,cancel_motivo:null};
  let rows=[],crearCalls=[],cancelarCalls=[];
  async function handle({requestId,request}){
   try{
    const u=new URL(request.url);
    if(u.origin===base && request.method==='GET')return await c('Fetch.continueRequest',{requestId});
    if(u.hostname!=='attendance.invalid')throw Error('Solicitud externa inesperada: '+u.origin);
    let body=rows,code=200;
    if(request.method==='OPTIONS')body={};
    else if(u.pathname.endsWith('/rpc/asistencia_intercambios_resumen')){const p=JSON.parse(request.postData);body=rows.filter(r=>r.estado==='activo').flatMap(r=>[{user_id:r.user_id,fecha:r.fecha_descanso,tipo:'descanso',fecha_vinculada:r.fecha_trabajo,hora_ingreso:r.hora_ingreso,hora_salida:r.hora_salida},{user_id:r.user_id,fecha:r.fecha_trabajo,tipo:'trabajo',fecha_vinculada:r.fecha_descanso,hora_ingreso:r.hora_ingreso,hora_salida:r.hora_salida}]).filter(r=>r.fecha>=p.p_desde && r.fecha<=p.p_hasta);}
    else if(u.pathname.endsWith('/rpc/asistencia_ausencias_resumen') || u.pathname.endsWith('/rpc/asistencia_novedades_resumen'))body=[];
    else if(u.pathname.endsWith('/rpc/asistencia_intercambio_crear')){const p=JSON.parse(request.postData);crearCalls.push(p);rows=[{...row,id:p.p_operacion_id,user_id:p.p_user_id,fecha_descanso:p.p_fecha_descanso,fecha_trabajo:p.p_fecha_trabajo,hora_ingreso:p.p_hora_ingreso,hora_salida:p.p_hora_salida}];body=rows[0];}
    else if(u.pathname.endsWith('/rpc/asistencia_intercambio_cancelar')){const p=JSON.parse(request.postData);cancelarCalls.push(p);rows=rows.map(r=>({...r,estado:'cancelado',cancelled_at:'2026-10-26T20:00:00Z',cancel_motivo:p.p_motivo}));body=rows[0];}
    else if(u.pathname.endsWith('/profiles'))body=staff;
    else if(u.pathname.endsWith('/asistencia_novedades') || u.pathname.endsWith('/asistencia_solicitudes'))body=[];else if(!u.pathname.endsWith('/asistencia_intercambios'))throw Error('Endpoint ficticio no previsto: '+u.pathname);
    await c('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
   }catch(e){errors.push(String(e));await c('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}
  }
  await c('Runtime.enable');await c('Page.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+expression);};
  const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const navigate=async role=>{await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a3.html?role='+role});await wait("!!document.querySelector('section h2')");};


  await t.test('SUPERADMIN autoriza la pareja con horario y cancela con motivo',async()=>{
   rows=[]; await navigate('SUPERADMIN');
   await evaluate("const s=document.querySelector('select');s.value=s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}));const inputs=document.querySelectorAll('input');['2026-11-02','2026-11-01','09:00','18:00'].forEach((v,i)=>{inputs[i].value=v;inputs[i].dispatchEvent(new Event('input',{bubbles:true}));})");
   await evaluate("document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
   await wait("document.body.innerText.includes('Intercambio autorizado')");
   assert.equal(crearCalls.at(-1).p_fecha_descanso,'2026-11-02');
   assert.equal(crearCalls.at(-1).p_fecha_trabajo,'2026-11-01');
   assert.equal(crearCalls.at(-1).p_hora_ingreso,'09:00');
   assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cancelar intercambio').disabled"),true);
   await evaluate("const i=document.querySelector('input[placeholder]');i.value='Cambio de planes';i.dispatchEvent(new Event('input',{bubbles:true}))");
   await click('Cancelar intercambio');await wait("document.body.innerText.includes('Cancelado')");
   assert.equal(cancelarCalls.at(-1).p_motivo,'Cambio de planes');
  });
  await t.test('ADMIN y técnico consultan ambos días sin formulario de autorización',async()=>{
   for(const role of ['ADMIN','TECNICO_RED']) {
    rows=[row];await navigate(role);await wait("document.body.innerText.includes('2026-11-02')");
    assert.equal(await evaluate("!!document.querySelector('form')"),false);
    assert.equal(await evaluate("document.body.innerText.includes('2026-11-01') && document.body.innerText.includes('09:00')"),true);
   }
  });
  await t.test('widget compartido permite domingo compensatorio y oculta marcación en lunes libre',async()=>{
   rows=[row];
   await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a3.html?role=TECNICO_RED&widget=1&day=2026-11-01'});
   await wait("document.body.innerText.includes('Jornada compensatoria autorizada')");
   assert.equal(await evaluate("document.body.innerText.includes('Marcar Ingreso')"),true);
   await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a3.html?role=ADMIN&widget=1&day=2026-11-02'});
   await wait("document.body.innerText.includes('Descanso autorizado por intercambio')");
   assert.equal(await evaluate("document.body.innerText.includes('Marcar Ingreso')"),false);
  });
  await t.test('SUPERADMIN permanece exento en widget',async()=>{
   await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a3.html?role=SUPERADMIN&widget=1'});
   await wait("document.body.innerText.includes('exento del control')");
   assert.equal(await evaluate("document.body.innerText.includes('Marcar Ingreso')"),false);
  });
  await t.test('reporte mensual real y tablero: descanso exento, domingo con ingreso o falta',async()=>{
   rows=[row];
   for(const sinIngreso of [false,true]) {
    await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a3.html?role=ADMIN&reporte=1&day=2026-11-03'+(sinIngreso?'&sinIngreso=1':'')});
    await wait("document.querySelectorAll('table').length===2 && document.querySelectorAll('table')[1].querySelector('tbody tr td:nth-child(7)')");
    const cells=await evaluate("Array.from(document.querySelectorAll('table')[1].querySelectorAll('tbody tr td')).map(c=>c.innerText.trim())");
    assert.equal(cells[1],sinIngreso?'0':'1');assert.equal(cells[4],sinIngreso?'1':'0');assert.equal(cells[6],'1 / 1');
    await evaluate("const i=document.querySelector('input[type=date]');i.value='2026-11-02';i.dispatchEvent(new Event('input',{bubbles:true}))");
    await wait("document.querySelector('table tbody').innerText.includes('Descanso autorizado por intercambio')");
    assert.equal(await evaluate("document.querySelector('table tbody').innerText.includes('Sin marcar')"),false);
   }
  });
  assert.deepEqual(errors,[]);
 }finally{if(ws)ws.close();if(chrome)chrome.kill();vite.kill();await new Promise(r=>setTimeout(r,500));if(path.dirname(path.resolve(profile))!==path.resolve(tmpdir()) || !path.basename(profile).startsWith('attendance-a3-'))throw Error('Directorio temporal no v?lido');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
