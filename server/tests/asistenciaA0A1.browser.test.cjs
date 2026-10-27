const { test }=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');

test('A1 navegador local: reportar, reintentar, visualizar y resolver con API ficticia', {timeout:60000},async t=>{
 const base='http://127.0.0.1:5198';
 const vite=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port','5198','--strictPort'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,VITE_SUPABASE_URL:'https://attendance.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'},windowsHide:true,stdio:'pipe'});
 const profile=await mkdtemp(path.join(tmpdir(),'attendance-a1-'));
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
  let rows=[],failReport=false;const reports=[],decisions=[];
  const row={id:'00000000-0000-0000-0000-000000000020',user_id:'00000000-0000-0000-0000-000000000003',fecha:'2026-10-26',motivo:'salud',observacion:null,estado:'pendiente',version:1,created_at:'2026-10-26T15:00:00Z',decision_motivo:null,profile:{full_name:'Técnico ficticio',email:'fixture@example.invalid'}};
  async function handle({requestId,request}){
   try{
    const u=new URL(request.url);
    if(u.origin===base && request.method==='GET')return await c('Fetch.continueRequest',{requestId});
    if(u.hostname!=='attendance.invalid')throw Error('Solicitud externa inesperada: '+u.origin);
    let body=rows,code=200;
    if(request.method==='OPTIONS')body={};
    else if(u.pathname.endsWith('/rpc/reportar_ausencia_hoy')){reports.push(JSON.parse(request.postData));if(failReport){failReport=false;code=503;body={message:'Fallo ficticio temporal'};}else{rows=[{...row,id:reports.at(-1).p_operacion_id}];body=rows[0];}}
    else if(u.pathname.endsWith('/rpc/resolver_ausencia')){const p=JSON.parse(request.postData);decisions.push(p);rows=[];body={...row,estado:p.p_decision};}
    else if(u.pathname.endsWith('/company_settings'))body={id:1,lunes_hora_ingreso:'07:30:00',resto_hora_ingreso:'08:00:00',tolerancia_min:5,almuerzo_min:120,oficina_lat:0,oficina_lng:0,oficina_radio_m:100};
    else if(u.pathname.endsWith('/feriados'))body=[];
    else if(u.pathname.endsWith('/asistencia_novedades'))body=[]; // A2: widget compartido también consulta "mis días autorizados"
    else if(u.pathname.endsWith('/asistencia_horarios_personales'))body=[]; // A2.1: y "mi horario habitual"
    else if(!u.pathname.endsWith('/asistencia_solicitudes'))throw Error('Endpoint ficticio no previsto: '+u.pathname);
    await c('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
   }catch(e){errors.push(String(e));await c('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}
  }
  await c('Runtime.enable');await c('Page.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+expression);};
  const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const navigate=async (role,surface='')=>{await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a0-a1.html?role='+role+'&surface='+surface});await wait("!!document.querySelector('h2') || document.body.innerText.includes('exento del control de asistencia') || document.body.innerText.includes('Reportar una ausencia')");await wait("!document.body.innerText.includes('Cargando')");};
  // El formulario y el historial de A1 viven ahora dentro de un desplegable
  // cerrado por defecto ("📝 Reportar una ausencia") — hay que abrirlo antes
  // de poder tocar el formulario o leer el historial. El boton incluye un
  // indicador ▲/▼ pegado al texto, por eso se busca por "incluye" y no por
  // igualdad exacta (a diferencia de click(), reservado a botones de 1 sola
  // etiqueta sin ambiguedad).
  const abrirDesplegable=()=>evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Reportar una ausencia')).click()");
  await t.test('técnico reporta; reintento conserva identificador y queda pendiente',async()=>{
   failReport=true;await navigate('TECNICO_RED');await abrirDesplegable();await wait("!!document.querySelector('form')");
   await click('Enviar solicitud');await wait("document.body.innerText.includes('Fallo ficticio temporal')");await click('Enviar solicitud');await wait("document.body.innerText.includes('queda pendiente de aprobación')");
   assert.equal(reports.length,2);assert.equal(reports[0].p_operacion_id,reports[1].p_operacion_id);assert.equal(reports[0].p_motivo,'salud');assert.equal(await evaluate("document.body.innerText.includes('Aprobar')"),false);
  });
  await t.test('abrir y cerrar el desplegable NO borra lo escrito en observación',async()=>{
   rows=[];await navigate('TECNICO_RED');await abrirDesplegable();await wait("!!document.querySelector('textarea')");
   await evaluate("const t=document.querySelector('textarea');t.value='Cita medica particular, llego mas tarde.';t.dispatchEvent(new Event('input',{bubbles:true}))");
   await abrirDesplegable(); // cierra
   await wait("document.querySelector('textarea').offsetParent===null");
   await abrirDesplegable(); // reabre
   assert.equal(await evaluate("document.querySelector('textarea').value"),'Cita medica particular, llego mas tarde.');
  });
  await t.test('ADMIN tiene reporte propio y ve decisión',async()=>{rows=[{...row,estado:'aprobada',decision_motivo:'Justificación revisada'}];await navigate('ADMIN');await abrirDesplegable();await wait("document.body.innerText.includes('Aprobada')");assert.equal(await evaluate("document.body.innerText.includes('Justificación revisada')"),true);assert.equal(await evaluate("!!document.querySelector('form')"),true);});
  // Caso real reportado en producción: Alex Prueba reportó una ausencia,
  // SUPERADMIN entró a aprobarla y los botones aparecían deshabilitados sin
  // explicación visible (exigían un comentario sin dejarlo claro).
  await t.test('SUPERADMIN aprueba SIN escribir nada — ya no queda bloqueado por un comentario obligatorio',async()=>{
   rows=[row];await navigate('SUPERADMIN');await wait("document.body.innerText.includes('Técnico ficticio')");assert.equal(await evaluate("!!document.querySelector('form')"),false);
   assert.equal(await evaluate("document.querySelector('textarea').value"),''); // nada escrito — comentario de decision
   assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Aprobar').disabled"),false);
   await evaluate("window.confirm=()=>true");await click('Aprobar');await wait("document.body.innerText.includes('No hay solicitudes')");
   assert.equal(decisions.at(-1).p_decision,'aprobada');assert.equal(decisions.at(-1).p_version_esperada,1);
   assert.ok(decisions.at(-1).p_motivo.length>0,'el backend sigue recibiendo un motivo no vacío (regla de auditoría intacta)');
  });
  await t.test('SUPERADMIN NO puede rechazar sin escribir un motivo — botón deshabilitado CON explicación visible',async()=>{
   rows=[row];await navigate('SUPERADMIN');await wait("!!document.querySelector('textarea')");
   assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Rechazar').disabled"),true);
   assert.equal(await evaluate("document.body.innerText.includes('Escribe un comentario arriba para poder rechazar')"),true);
   await evaluate("const input=document.querySelector('textarea');input.value='Rechazo motivado';input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>true");
   assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Rechazar').disabled"),false);
   await click('Rechazar');await wait("document.body.innerText.includes('No hay solicitudes')");
   assert.equal(decisions.at(-1).p_decision,'rechazada');assert.equal(decisions.at(-1).p_motivo,'Rechazo motivado');
  });
  await t.test('tras resolver, se ve quién decidió y cuándo (hora de Perú)',async()=>{
   rows=[{...row,estado:'aprobada',decision_motivo:'Aprobado sin observaciones adicionales',resolved_at:'2026-10-26T20:00:00Z',resolver:{full_name:'Super Admin Ficticio',email:'super@example.invalid'}}];
   await navigate('SUPERADMIN');await wait("document.body.innerText.includes('Super Admin Ficticio')");
   assert.equal(await evaluate("document.body.innerText.includes('Aprobado por Super Admin Ficticio')"),true);
   assert.equal(await evaluate("document.body.innerText.includes('2026')"),true); // hora real del evento, no la de renderizado
  });
  for(const role of ['ADMIN'])await t.test(role+' reporta desde el widget compartido del panel web, sin entrar a Campo',async()=>{
   rows=[];await navigate(role,'web');await wait("document.body.innerText.includes('Marcación de Jornada')");
   await abrirDesplegable();await wait("!!document.querySelector('form')");
   const before=reports.length;await click('Enviar solicitud');await wait("document.body.innerText.includes('queda pendiente de aprobación')");
   assert.equal(reports.length,before+1);assert.equal('p_user_id' in reports.at(-1),false);
   assert.equal(await evaluate("document.body.innerText.includes('Aprobar')"),false);
   assert.equal(await evaluate("location.pathname.includes('/campo')"),false);
  });
  await t.test('SUPERADMIN ve exención personal y no envía reportes ni muestra acciones de marcar',async()=>{
   rows=[];const before=reports.length;await navigate('SUPERADMIN','web');
   await wait("document.body.innerText.includes('exento del control de asistencia')");
   assert.equal(await evaluate("!!document.querySelector('form')"),false);
   assert.equal(await evaluate("document.body.innerText.includes('Marcación de Jornada')"),false);
   assert.equal(await evaluate("document.body.innerText.includes('Reportar una ausencia')"),false);
   assert.equal(reports.length,before);
  });
  assert.deepEqual(errors,[]);
 }finally{if(ws)ws.close();if(chrome)chrome.kill();vite.kill();await new Promise(r=>setTimeout(r,500));if(path.dirname(path.resolve(profile))!==path.resolve(tmpdir()) || !path.basename(profile).startsWith('attendance-a1-'))throw Error('Directorio temporal no válido');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
