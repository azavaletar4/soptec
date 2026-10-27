const { test }=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');

test('A2 navegador local: programar, cancelar y consultar novedades con API ficticia', {timeout:60000},async t=>{
 const base='http://127.0.0.1:5199';
 const vite=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port','5199','--strictPort'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,VITE_SUPABASE_URL:'https://attendance.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'},windowsHide:true,stdio:'pipe'});
 const profile=await mkdtemp(path.join(tmpdir(),'attendance-a2-'));
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
  const row={id:'00000000-0000-0000-0000-000000000070',user_id:'00000000-0000-0000-0000-000000000003',tipo:'vacaciones',fecha_inicio:'2026-11-02',fecha_fin:'2026-11-06',turno:null,hora_inicio:null,hora_fin:null,motivo:null,estado:'activa',version:1,created_by:'00000000-0000-0000-0000-000000000001',created_at:'2026-10-26T15:00:00Z',cancelled_at:null,cancelled_by:null,cancel_motivo:null,profile:{full_name:'Técnico Ficticio',email:'tecnico@example.invalid'}};
  let rows=[],crearCalls=[],cancelarCalls=[];
  async function handle({requestId,request}){
   try{
    const u=new URL(request.url);
    if(u.origin===base && request.method==='GET')return await c('Fetch.continueRequest',{requestId});
    if(u.hostname!=='attendance.invalid')throw Error('Solicitud externa inesperada: '+u.origin);
    let body=rows,code=200;
    if(request.method==='OPTIONS')body={};
    else if(u.pathname.endsWith('/rpc/asistencia_novedad_crear')){const p=JSON.parse(request.postData);crearCalls.push(p);rows=[{...row,id:p.p_operacion_id,user_id:p.p_user_id,tipo:p.p_tipo,fecha_inicio:p.p_fecha_inicio,fecha_fin:p.p_fecha_fin,turno:p.p_turno,hora_inicio:p.p_hora_inicio,hora_fin:p.p_hora_fin,motivo:p.p_motivo}];body=rows[0];}
    else if(u.pathname.endsWith('/rpc/asistencia_novedad_cancelar')){const p=JSON.parse(request.postData);cancelarCalls.push(p);rows=rows.map(r=>r.id===p.p_novedad_id?{...r,estado:'cancelada',version:r.version+1,cancelled_at:'2026-10-26T20:00:00Z',cancel_motivo:p.p_motivo}:r);body=rows.find(r=>r.id===p.p_novedad_id);}
    else if(u.pathname.endsWith('/profiles'))body=staff;
    else if(!u.pathname.endsWith('/asistencia_novedades'))throw Error('Endpoint ficticio no previsto: '+u.pathname);
    await c('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
   }catch(e){errors.push(String(e));await c('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}
  }
  await c('Runtime.enable');await c('Page.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+expression);};
  const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const navigate=async role=>{await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a2-novedades.html?role='+role});await wait("document.body.innerText.includes('Vacaciones, descansos y permisos') || document.body.innerText.includes('Mis días autorizados') || document.body.innerText.includes('Sin novedades')");};

  await t.test('SUPERADMIN programa una novedad de vacaciones por rango',async()=>{
   rows=[];await navigate('SUPERADMIN');await wait("!!document.querySelector('select')");
   await evaluate("const sel=document.querySelector('select');sel.value=sel.options[1].value;sel.dispatchEvent(new Event('change',{bubbles:true}))");
   await evaluate("document.querySelector('input[type=date]').value='2026-11-02';document.querySelector('input[type=date]').dispatchEvent(new Event('input',{bubbles:true}))");
   await evaluate("const inputs=document.querySelectorAll('input[type=date]');inputs[1].value='2026-11-06';inputs[1].dispatchEvent(new Event('input',{bubbles:true}))");
   await click('+ Programar novedad');
   await wait("document.body.innerText.includes('Novedad programada')");
   assert.equal(crearCalls.length,1);assert.equal(crearCalls[0].p_tipo,'vacaciones');assert.equal(crearCalls[0].p_fecha_inicio,'2026-11-02');assert.equal(crearCalls[0].p_fecha_fin,'2026-11-06');
   assert.equal(await evaluate("document.body.innerText.includes('Vacaciones')"),true);
  });

  await t.test('SUPERADMIN no puede cancelar sin escribir un motivo; al escribirlo se habilita',async()=>{
   rows=[row];await navigate('SUPERADMIN');await wait("document.body.innerText.includes('Técnico Ficticio')");
   assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Cancelar').disabled"),true);
   await evaluate("const input=Array.from(document.querySelectorAll('input')).find(i=>i.placeholder&&i.placeholder.includes('cancelación'));input.value='Cambio de planes';input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>true");
   assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Cancelar').disabled"),false);
   await click('Cancelar');await wait("document.body.innerText.includes('Cancelada')");
   assert.equal(cancelarCalls.at(-1).p_motivo,'Cambio de planes');assert.equal(cancelarCalls.at(-1).p_version_esperada,1);
  });

  await t.test('ADMIN/técnico solo consultan, sin formulario ni botón de cancelar',async()=>{
   rows=[row];await navigate('TECNICO_RED');await wait("document.body.innerText.includes('Mis días autorizados')");
   assert.equal(await evaluate("!!document.querySelector('form')"),false);
   assert.equal(await evaluate("!!document.querySelector('select')"),false);
   assert.equal(await evaluate("document.body.innerText.includes('2026-11-02')"),true);
   assert.equal(await evaluate("document.body.innerText.includes('Vacaciones')"),true);
  });

  await t.test('sin novedades activas, el personal no ve nada (no ensucia el widget compartido)',async()=>{
   rows=[];await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a2-novedades.html?role=ADMIN'});
   await wait("document.readyState==='complete'");
   await new Promise(r=>setTimeout(r,300)); // deja terminar el fetch/render async sin texto que esperar
   assert.equal(await evaluate("document.body.innerText.trim()"),'');
  });

  assert.deepEqual(errors,[]);
 }finally{if(ws)ws.close();if(chrome)chrome.kill();vite.kill();await new Promise(r=>setTimeout(r,500));if(path.dirname(path.resolve(profile))!==path.resolve(tmpdir()) || !path.basename(profile).startsWith('attendance-a2-'))throw Error('Directorio temporal no válido');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
