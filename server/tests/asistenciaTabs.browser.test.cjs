const { test }=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdtemp,rm,mkdir,writeFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');

test('Asistencia: pestanas, borradores y responsive con API ficticia', {timeout:60000},async t=>{
 const base='http://127.0.0.1:5207';
 const vite=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port','5207','--strictPort'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,VITE_SUPABASE_URL:'https://attendance.invalid',VITE_SUPABASE_ANON_KEY:'synthetic-test-key'},windowsHide:true,stdio:'pipe'});
 const profile=await mkdtemp(path.join(tmpdir(),'attendance-tabs-'));
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
  const staff=[{id:'00000000-0000-0000-0000-000000000001',full_name:'Administracion Demo',email:'demo@example.invalid',role:'SUPERADMIN'},{id:'00000000-0000-0000-0000-000000000003',full_name:'Lucia Mendoza',email:'lucia@example.invalid',role:'TECNICO_RED'},{id:'00000000-0000-0000-0000-000000000004',full_name:'Jorge Salazar',email:'jorge@example.invalid',role:'ADMIN'}];
  const row={id:'00000000-0000-0000-0000-000000000070',user_id:'00000000-0000-0000-0000-000000000003',fecha_descanso:'2026-11-02',fecha_trabajo:'2026-11-01',hora_ingreso:'09:00:00',hora_salida:'18:00:00',estado:'activo',created_by:'00000000-0000-0000-0000-000000000001',created_at:'2026-10-26T15:00:00Z',cancelled_at:null,cancel_motivo:null};
  let rows=[row],crearCalls=[],cancelarCalls=[];const mutations=[];
  const solicitud={id:'ausencia-1',user_id:staff[1].id,fecha:'2026-11-02',motivo:'salud',observacion:'Atencion medica coordinada. Datos ficticios.',estado:'pendiente',version:1,profile:staff[1],created_at:'2026-11-02T12:00:00Z'};
  const novedad={id:'novedad-1',user_id:staff[2].id,tipo:'vacaciones',fecha_inicio:'2026-11-16',fecha_fin:'2026-11-20',estado:'activa',version:1,profile:staff[2],created_at:'2026-11-03T12:00:00Z'};
  async function handle({requestId,request}){
   try{
    const u=new URL(request.url);
    if(u.origin===base && request.method==='GET')return await c('Fetch.continueRequest',{requestId});
    if(u.hostname!=='attendance.invalid')throw Error('Solicitud externa inesperada: '+u.origin);
    let body=rows,code=200;
    if(request.method!=='GET' && request.method!=='OPTIONS' && !u.pathname.endsWith('_resumen'))mutations.push(u.pathname);
    if(request.method==='OPTIONS')body={};
    else if(u.pathname.endsWith('/rpc/asistencia_intercambios_resumen')){const p=JSON.parse(request.postData);body=rows.filter(r=>r.estado==='activo').flatMap(r=>[{user_id:r.user_id,fecha:r.fecha_descanso,tipo:'descanso',fecha_vinculada:r.fecha_trabajo,hora_ingreso:r.hora_ingreso,hora_salida:r.hora_salida},{user_id:r.user_id,fecha:r.fecha_trabajo,tipo:'trabajo',fecha_vinculada:r.fecha_descanso,hora_ingreso:r.hora_ingreso,hora_salida:r.hora_salida}]).filter(r=>r.fecha>=p.p_desde && r.fecha<=p.p_hasta);}
    else if(u.pathname.endsWith('/rpc/asistencia_ausencias_resumen') || u.pathname.endsWith('/rpc/asistencia_novedades_resumen'))body=[];
    else if(u.pathname.endsWith('/rpc/asistencia_intercambio_crear')){const p=JSON.parse(request.postData);crearCalls.push(p);rows=[{...row,id:p.p_operacion_id,user_id:p.p_user_id,fecha_descanso:p.p_fecha_descanso,fecha_trabajo:p.p_fecha_trabajo,hora_ingreso:p.p_hora_ingreso,hora_salida:p.p_hora_salida}];body=rows[0];}
    else if(u.pathname.endsWith('/rpc/asistencia_intercambio_cancelar')){const p=JSON.parse(request.postData);cancelarCalls.push(p);rows=rows.map(r=>({...r,estado:'cancelado',cancelled_at:'2026-10-26T20:00:00Z',cancel_motivo:p.p_motivo}));body=rows[0];}
    else if(u.pathname.endsWith('/profiles'))body=staff;
    else if(u.pathname.endsWith('/asistencia_novedades'))body=[novedad];else if(u.pathname.endsWith('/asistencia_solicitudes'))body=[{...solicitud,estado:u.searchParams.get('estado')?.slice(3)||'pendiente'}];else if(!u.pathname.endsWith('/asistencia_intercambios'))throw Error('Endpoint ficticio no previsto: '+u.pathname);
    await c('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
   }catch(e){errors.push(String(e));await c('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});}
  }
  await c('Runtime.enable');await c('Page.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+expression);};
  const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const navigate=async role=>{await c('Page.navigate',{url:base+'/server/tests/fixtures/asistencia-tabs.html?role='+role});await wait("document.querySelectorAll('[role=tab]').length===4 && !!document.querySelector('table tbody tr td')");};

  const select=async id=>{await evaluate(`document.getElementById('attendance-tab-${id}').click()`);await wait(`document.getElementById('attendance-tab-${id}').getAttribute('aria-selected')==='true'`);};
  const fill=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const value=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
  const captures=path.resolve(__dirname,'../../docs/capturas/asistencia-tabs');
  await mkdir(captures,{recursive:true});
  async function screenshot(name) {
   await evaluate('window.scrollTo(0,0)');
   // Deja finalizar la transición responsive del menú antes de capturar.
   await new Promise(r=>setTimeout(r,300));
   const metrics=await c('Page.getLayoutMetrics');
   const r=await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:metrics.cssContentSize.width,height:Math.min(3500,Math.ceil(metrics.cssContentSize.height)),scale:1}});
   await writeFile(path.join(captures,name+'.png'),Buffer.from(r.data,'base64'));
  }

  await t.test('escritorio: Asistencia inicial, un solo panel visible y reporte conservado',async()=>{
   await c('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   await navigate('SUPERADMIN');
   assert.equal(await evaluate("document.querySelector('[role=tab][aria-selected=true]').textContent.trim()"),'Asistencia');
   assert.equal(await evaluate("Array.from(document.querySelectorAll('[role=tabpanel]')).filter(e=>getComputedStyle(e).display!=='none').length"),1);
   assert.equal(await evaluate("document.getElementById('attendance-panel-asistencia').querySelectorAll('table').length"),2);
   assert.equal(await evaluate("Array.from(document.querySelectorAll('form')).filter(e=>e.getClientRects().length).length"),0);
   await screenshot('desktop-asistencia');
  });
  await t.test('descansos: formularios separados de listados; borradores y filtros sobreviven',async()=>{
   await select('descansos');await wait("document.querySelectorAll('#attendance-panel-descansos article').length===2");
   await fill('#attendance-panel-descansos form select',staff[1].id);
   await fill('#attendance-panel-descansos form input[type=date]','2026-11-09');
   await fill('#attendance-panel-descansos textarea','Coordinación pendiente de confirmar');
   assert.equal(await evaluate("(()=>{const f=document.querySelector('#attendance-panel-descansos form').getBoundingClientRect();const l=document.querySelector('#attendance-panel-descansos .attendance-list').getBoundingClientRect();return l.left>f.right;})()"),true);
   await screenshot('desktop-descansos');
   await select('asistencia');await fill('input[placeholder="Nombre del colaborador"]','Lucia');
   await select('descansos');
   assert.equal(await value('#attendance-panel-descansos form select'),staff[1].id);
   assert.equal(await value('#attendance-panel-descansos form input[type=date]'),'2026-11-09');
   assert.equal(await value('#attendance-panel-descansos textarea'),'Coordinación pendiente de confirmar');
   await select('asistencia');assert.equal(await value('input[placeholder="Nombre del colaborador"]'),'Lucia');
   await fill('input[placeholder="Nombre del colaborador"]','');
  });
  await t.test('horarios y ausencias: borradores, acciones y navegación de teclado intactos',async()=>{
   await select('horarios');await fill('#attendance-panel-horarios form select',staff[2].id);
   await fill('#attendance-panel-horarios input[type=time]','14:00');
   await screenshot('desktop-horarios');
   await select('ausencias');await wait("!!document.querySelector('#attendance-panel-ausencias textarea')");
   await fill('#attendance-panel-ausencias textarea','Conservar comentario de revisión');
   assert.equal(await evaluate("Array.from(document.querySelectorAll('#attendance-panel-ausencias button')).find(b=>b.textContent.trim()==='Rechazar').disabled"),false);
   await select('horarios');assert.equal(await value('#attendance-panel-horarios input[type=time]'),'14:00');
   assert.equal(await value('#attendance-panel-horarios form select'),staff[2].id);
   await select('ausencias');assert.equal(await value('#attendance-panel-ausencias textarea'),'Conservar comentario de revisión');
   await screenshot('desktop-ausencias');
   await fill('#attendance-panel-ausencias select','aprobada');await wait("document.querySelector('#attendance-panel-ausencias .badge')?.textContent.includes('Aprobada')");
   await select('horarios');await select('ausencias');assert.equal(await value('#attendance-panel-ausencias select'),'aprobada');
   await fill('#attendance-panel-ausencias select','rechazada');await wait("document.querySelector('#attendance-panel-ausencias .badge')?.textContent.includes('Rechazada')");
   await fill('#attendance-panel-ausencias select','pendiente');await wait("!!document.querySelector('#attendance-panel-ausencias textarea')");
   assert.equal(await value('#attendance-panel-ausencias textarea'),'Conservar comentario de revisión');
   await evaluate("document.getElementById('attendance-tab-asistencia').focus()");
   await c('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
   assert.equal(await evaluate("document.activeElement.id"),'attendance-tab-ausencias');
   await c('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End'});
   assert.equal(await evaluate("document.activeElement.id"),'attendance-tab-horarios');
  });
  await t.test('móvil: pestañas desplazables, una columna, controles cómodos y sin desborde',async()=>{
   await c('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await select('asistencia');
   assert.equal(await evaluate("document.querySelector('.attendance-tabs').scrollWidth>document.querySelector('.attendance-tabs').clientWidth"),true);
   assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
   await screenshot('mobile-asistencia');
   for(const tab of ['descansos','horarios']) {
    await select(tab);
    assert.equal(await evaluate(`(()=>{const f=document.querySelector('#attendance-panel-${tab} form');return getComputedStyle(f).gridTemplateColumns.split(' ').length===1;})()`),true);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('#attendance-panel-${tab} form .field-input')).filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)`),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await screenshot('mobile-'+tab);
   }
   await select('asistencia');await select('horarios');
   assert.equal(await value('#attendance-panel-horarios input[type=time]'),'14:00');
  });
  await t.test('Configuración exclusiva SUPERADMIN; navegar no envía escrituras',async()=>{
   await evaluate("document.querySelector('button[aria-controls=attendance-settings]').click()");await wait("document.getElementById('attendance-settings').getClientRects().length>0");
   await evaluate("document.querySelector('button[aria-controls=attendance-settings]').click()");
   await navigate('ADMIN');await select('horarios');
   assert.equal(await evaluate("!!document.querySelector('button[aria-controls=attendance-settings]')"),false);
   assert.equal(await evaluate("Array.from(document.querySelectorAll('form')).filter(e=>e.getClientRects().length).length"),0);
   assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  });
 }finally{if(ws)ws.close();if(chrome)chrome.kill();vite.kill();await new Promise(r=>setTimeout(r,500));if(path.dirname(path.resolve(profile))!==path.resolve(tmpdir()) || !path.basename(profile).startsWith('attendance-tabs-'))throw Error('Directorio temporal no válido');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
