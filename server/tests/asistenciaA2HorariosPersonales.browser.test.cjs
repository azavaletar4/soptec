const { test }=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');

test('A2.1 navegador local: horarios personales recurrentes con API ficticia', {timeout:60000},async t=>{
 const base='http://127.0.0.1:5200';
 const vite=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port','5200','--strictPort'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,VITE_SUPABASE_URL:'https://attendance.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'},windowsHide:true,stdio:'pipe'});
 const profile=await mkdtemp(path.join(tmpdir(),'attendance-a2-horarios-'));
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
  const staff=[{id:'00000000-0000-0000-0000-000000000003',email:'tarde@example.invalid',full_name:'Técnico Tarde',role:'TECNICO_RED',phone:null,battery_level:null,latitude:null,longitude:null,last_ping_at:null}];
  const row={id:'00000000-0000-0000-0000-000000000080',user_id:'00000000-0000-0000-0000-000000000003',dia_semana:6,turno:'tarde',hora_ingreso:'14:00:00',hora_salida:'18:00:00',created_by:'00000000-0000-0000-0000-000000000001',created_at:'2026-10-26T15:00:00Z',updated_at:'2026-10-26T15:00:00Z',profile:{full_name:'Técnico Tarde',email:'tarde@example.invalid'}};
  let rows=[],guardarCalls=[],eliminarCalls=[];
  async function handle({requestId,request}){
   try{
    const u=new URL(request.url);
    if(u.origin===base && request.method==='GET')return await c('Fetch.continueRequest',{requestId});
    if(u.hostname!=='attendance.invalid')throw Error('Solicitud externa inesperada: '+u.origin);
    let body=rows,code=200;
    if(request.method==='OPTIONS')body={};
    else if(u.pathname.endsWith('/profiles'))body=staff;
    else if(u.pathname.endsWith('/asistencia_horarios_personales') && request.method==='POST'){const p=JSON.parse(request.postData);guardarCalls.push(p);rows=[{...row,...p}];body=rows[0];}
    else if(u.pathname.endsWith('/asistencia_horarios_personales') && request.method==='DELETE'){eliminarCalls.push(u.search);rows=[];body={};}
    else if(!u.pathname.endsWith('/asistencia_horarios_personales'))throw Error('Endpoint ficticio no previsto: '+u.pathname+' '+request.method);
    await c('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET,POST,DELETE,OPTIONS'},{name:'Prefer',value:'return=representation'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
   }catch(e){errors.push(String(e));await c('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}
  }
  await c('Runtime.enable');await c('Page.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+expression);};
  const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const navigate=async role=>{await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a2-horarios-personales.html?role='+role});await wait("document.body.innerText.includes('Horarios parciales habituales') || document.body.innerText.includes('Mi horario habitual')");};

  await t.test('SUPERADMIN programa el sábado "tarde" de un técnico',async()=>{
   rows=[];await navigate('SUPERADMIN');await wait("!!document.querySelector('select')");
   await evaluate("const sel=document.querySelectorAll('select')[0];sel.value=sel.options[1].value;sel.dispatchEvent(new Event('change',{bubbles:true}))");
   await evaluate("const inputs=document.querySelectorAll('input[type=time]');inputs[0].value='14:00';inputs[0].dispatchEvent(new Event('input',{bubbles:true}));inputs[1].value='18:00';inputs[1].dispatchEvent(new Event('input',{bubbles:true}))");
   await click('+ Guardar horario');
   await wait("document.body.innerText.includes('Horario guardado')");
   assert.equal(guardarCalls.length,1);assert.equal(guardarCalls[0].hora_ingreso,'14:00');assert.equal(guardarCalls[0].hora_salida,'18:00');
   assert.equal(await evaluate("document.body.innerText.includes('Sábado 14:00–18:00 (tarde)')"),true);
  });

  await t.test('SUPERADMIN elimina el horario — vuelve al horario general',async()=>{
   rows=[row];await navigate('SUPERADMIN');await wait("document.body.innerText.includes('Técnico Tarde')");
   await evaluate("window.confirm=()=>true");await click('Eliminar');
   await wait("document.body.innerText.includes('Sin horarios personales configurados')");
   assert.equal(eliminarCalls.length,1);
  });

  await t.test('ADMIN/técnico solo consultan "Mi horario habitual", sin formulario',async()=>{
   rows=[row];await navigate('TECNICO_RED');await wait("document.body.innerText.includes('Mi horario habitual')");
   assert.equal(await evaluate("!!document.querySelector('form')"),false);
   assert.equal(await evaluate("!!document.querySelector('select')"),false);
   assert.equal(await evaluate("document.body.innerText.includes('Sábado 14:00–18:00 (tarde)')"),true);
  });

  await t.test('sin horario personal, el widget compartido no muestra nada',async()=>{
   rows=[];await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-a2-horarios-personales.html?role=ADMIN'});
   await wait("document.readyState==='complete'");
   await new Promise(r=>setTimeout(r,300));
   assert.equal(await evaluate("document.body.innerText.trim()"),'');
  });

  assert.deepEqual(errors,[]);
 }finally{if(ws)ws.close();if(chrome)chrome.kill();vite.kill();await new Promise(r=>setTimeout(r,500));if(path.dirname(path.resolve(profile))!==path.resolve(tmpdir()) || !path.basename(profile).startsWith('attendance-a2-horarios-'))throw Error('Directorio temporal no válido');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
