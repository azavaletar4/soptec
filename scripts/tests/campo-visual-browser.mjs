// Local Vite only. Synthetic auth/data, external network blocked, no business writes.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(tmpdir(),'mi-avance-browser-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws; let seq=0; const pending=new Map(); const errors=[]; const checks=[];
try {
  const endpoint=await new Promise((resolve,reject)=>{
    let log=''; const timeout=setTimeout(()=>reject(Error('CHROME_TIMEOUT')),20000);
    chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});
    chrome.on('error',reject);
  });
  ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const c=(method,params={})=>send(method,params,sessionId);
  await c('Page.enable');await c('Runtime.enable');await c('Network.enable');
  await c('Network.setBlockedURLs',{urls:['*supabase.co/*','*/api/*']});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let n=0;n<70;n++){const v=await evaluate('document.body && ('+expression+')');if(v)return v;await new Promise(r=>setTimeout(r,150));}console.log(await evaluate('JSON.stringify({path:location.pathname,body:document.body.innerText.slice(0,2500),calls:window.__calls})'));console.log(JSON.stringify(errors));throw Error('UI_TIMEOUT: '+expression);};
  function fixture(){
    const uid='00000000-0000-4000-8000-000000000003';
    const jobId='10000000-0000-4000-8000-000000000001';
    const role=sessionStorage.getItem('test-role')||'TECNICO_RED';
    const now=Math.floor(Date.now()/1000),enc=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
    const user={id:uid,aud:'authenticated',role:'authenticated',email:'local@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
    localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_at:now+3600,expires_in:3600,user}));
    window.__loads=Number(sessionStorage.getItem('lab-loads')||0)+1;sessionStorage.setItem('lab-loads',String(window.__loads));window.__payloads={};window.__calls=[]; window.__mode='ready';window.__custody='ready';window.__rankingMode='ready';
    const realFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const u=new URL(typeof input==='string'?input:input.url,location.href);
      if(!u.hostname.endsWith('.supabase.co')&&!u.pathname.startsWith('/api/'))return realFetch(input,init);
      const method=init.method||(input instanceof Request?input.method:'GET');
      window.__calls.push({path:u.pathname,method,query:u.search});
      const table=u.pathname.split('/').at(-1);
      const reads=['my_field_progress','my_field_job_points','my_inventory_custody','logout'];
      if(!['GET','HEAD'].includes(method)&&!reads.includes(table))return new Response('{}',{status:403});
      const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Content-Range':'0-0/1'}});
      const profile={id:uid,full_name:'Técnico local',role,active:true,must_change_password:false};
      const job={id:jobId,routine_number:'RUT-LOCAL',status:'completed',assigned_to:uid,title:'Mantenimiento de caja NAP con nombre largo para comprobar el ajuste móvil',completed_at:'2026-10-20T18:00:00Z',created_at:'2026-10-20T12:00:00Z',points:10,priority:'medium',client_id:null,contract_id:null,scheduled_date:'2026-10-20',tipo_rutina:'mantenimiento_preventivo',subtipo:null,routine_returns:[]};
      let data=[]; if(table==='logout')return response({});
      if(table==='user')data=user;
      if(table==='profiles')data=u.searchParams.has('id')?profile:[profile];
      if(table==='asistencia_registros')data=null;
      if(table==='company_settings')data={id:1,lunes_hora_ingreso:'07:30:00',resto_hora_ingreso:'08:00:00',tolerancia_minutos:10};
      if(table==='routines')data=[job];
      if(window.__layoutAudit){
        const client={first_name:'Cliente ficticio con nombre extenso',last_name:'para validar lectura en pantalla móvil',phone:'999000000',address:'Avenida de prueba, referencia extensa para comprobar el ajuste de texto en móvil'};
        if(table==='tickets')data=[{...job,id:'10000000-0000-4000-8000-000000000002',ticket_number:'AV-LOCAL',status:'open',category:'averia',title:'Avería ficticia asignada',points:null,clients:client}];
        if(table==='installations')data=[{...job,id:'10000000-0000-4000-8000-000000000003',status:'scheduled',clients:client}];
        if(table==='routines')data.push({...job,id:'10000000-0000-4000-8000-000000000004',routine_number:'RUT-PENDIENTE',status:'pending',title:'Rutina ficticia asignada con referencia extensa para verificar lectura móvil'});
      }
      if(table==='job_assignees')data=[{job_type:'routine',job_id:jobId,technician_id:uid,role:'leader',profile}];
      if(table==='my_field_progress'){
        if(window.__mode==='loading')await new Promise(r=>setTimeout(r,900));
        if(window.__mode==='error')return response({message:'Fallo sintético'},503);
        const p={start:'2026-10-01T05:00:00Z',end:'2026-11-01T05:00:00Z',points:12.5};
        data={asOf:'2026-10-20T20:00:00Z',timezone:'America/Lima',periods:{today:{...p,start:'2026-10-20T05:00:00Z',end:'2026-10-21T05:00:00Z'},week:{...p,start:'2026-10-19T05:00:00Z',end:'2026-10-26T05:00:00Z'},month:p},contributions:[{jobType:'routine',jobId,occurredAt:job.completed_at,kind:'work',crewSize:2,points:12.5}]};
      }
      if(table==='my_field_job_points')data=[{kind:'work',crewSize:2,points:12.5,occurredAt:job.completed_at}];
      if(table==='ranking-tecnicos'){
        if(window.__slowRankPeriod===u.searchParams.get('periodo'))await new Promise(r=>setTimeout(r,900));
        if(window.__rankingMode==='error')return response({error:'Error simulado de ranking'},503);
        const base={installations_count:1,averias_count:1,reconexiones_count:0,rutinas_count:2,reincidencias_count:0,total_points:12.5,ranking:1};
        const period=u.searchParams.get('periodo');
        const bounds=period==='month'?['2026-10-01T05:00:00Z','2026-11-01T05:00:00Z']:period==='day'?['2026-10-20T05:00:00Z','2026-10-21T05:00:00Z']:['2026-10-19T05:00:00Z','2026-10-26T05:00:00Z'];
        data={period,start:bounds[0],end:bounds[1],timezone:'America/Lima',asOf:'2026-10-20T20:00:00Z',ranking:[
          {...base,technician_id:uid,technician_name:'Técnico local'},
          {...base,technician_id:'tech-other',technician_name:'Compañero de prueba'},
        ]};
      }
      if(table==='my_inventory_custody'){
        if(window.__custody==='loading')await new Promise(r=>setTimeout(r,900));
        if(window.__custody==='error')return response({message:'Fallo sintético'},503);
        data=window.__custody==='empty'?{units:[],materials:[],pendingReturnRequests:[]}:{"units":[{"id":"unit","product":{"id":"ont","name":"ONT de prueba"},"serial_number":"SERIE-LARGA-123456789012345678901234567890","mac_address":"00:11:22:33:44:55","status":"with_technician"},{"id":"unit-2","product":{"id":"ont","name":"ONT de prueba"},"serial_number":"SERIE-2","mac_address":null,"status":"with_technician"},{"id":"unit-3","product":{"id":"ont","name":"ONT en devolución"},"serial_number":"SERIE-3","mac_address":null,"status":"pending_return"}],"materials":[{"product":{"id":"drop","name":"Cable Drop","unit":"metros"},"quantity":120.5},{"product":{"id":"utp","name":"Cable UTP","unit":"metros"},"quantity":30},{"product":{"id":"connector","name":"Conector","unit":"unidades"},"quantity":4},{"product":{"id":"clamps","name":"Grapas","unit":"unidades"},"quantity":3},{"product":{"id":"other","name":"Otro material","unit":"rollos"},"quantity":2.25}],"pendingReturnRequests":[]};
      }
      if(['my_field_progress','my_inventory_custody','tickets','installations','routines','ranking-tecnicos'].includes(table))window.__payloads[table]=data;return response(data);
    };
  }
  const before=process.argv.includes('--before');
  const stage=before?'ANTES':'DESPUES';const origin='http://127.0.0.1:5194';
  const outputs={};const widths=[];const payloads={};
  const savePayloads=async()=>Object.assign(payloads,await evaluate('window.__payloads'));
  await c('Page.addScriptToEvaluateOnNewDocument',{source:'window.__layoutAudit=true;('+fixture.toString()+')();'});
  await c('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; Mobile; wv) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36 SmartRaycoApp/1.0'});
  await c('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  const home=async()=>{await c('Page.navigate',{url:origin+'/campo'});await until('document.body.innerText.includes("AV-LOCAL") && document.body.innerText.includes("12.5")');};
  await home();
  for(const width of [320,360,390,412,1280]){
    await c('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<500});
    const audit=await evaluate(`(()=>{const main=document.querySelector('main');return {
      viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      firstOrder:main.querySelector(':scope > ul > li').getBoundingClientRect().top,
      orders:main.querySelectorAll(':scope > ul > li').length,
      clipped:[...document.querySelectorAll('header h1,header a,header button,header summary,main p,main h2,main a,main button,main summary')].filter(e=>e.checkVisibility()&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent.trim()),
      headerTargets:[...document.querySelectorAll('header button,header a,header summary')].filter(e=>e.checkVisibility()).map(e=>({label:e.getAttribute('aria-label'),height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})),
      pointValues:[...main.querySelectorAll('[aria-labelledby="mi-avance-title"] .grid > div')].map(e=>e.querySelector('p.font-bold')?.textContent.trim()),
      adminControls:/Operaciones de Hoy|Técnicos Activos|Gestión de usuarios|Facturación|Salarios/.test(main.innerText)
    }})()`);
    assert(audit.scrollWidth<=audit.viewport);assert.equal(audit.adminControls,false);assert.equal(audit.orders,3);
    assert.deepEqual(audit.pointValues,['12.5 pts','12.5 pts','12.5 pts']);
    if(!before){assert.equal(audit.clipped.length,0,JSON.stringify(audit.clipped));assert(audit.headerTargets.every(e=>e.height>=44&&e.width>=44),JSON.stringify(audit.headerTargets));}
    widths.push({width,...audit});
  }
  await c('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  const screenshot=async name=>{const path='docs/CAMPO-VISUAL-'+stage+'-'+name+'.png';await writeFile(path,Buffer.from((await c('Page.captureScreenshot',{format:'png'})).data,'base64'));outputs[name]=path;};
  await screenshot('INICIO');await savePayloads();
  if(!before){
    await until('document.body.innerText.includes("150.5 metros") && document.body.innerText.includes("7 unidades")');
    assert((await evaluate('document.body.innerText')).includes('2 equipos disponibles'));
    assert((await evaluate('document.body.innerText')).includes('1 en devolución'));
    assert((await evaluate('document.body.innerText')).includes('2.25 rollos'));
    await evaluate('document.querySelector("header summary").focus();document.querySelector("header summary").click()');
    await until('document.querySelector("header details").open');await screenshot('CUENTA');
    assert(await evaluate(`document.querySelector('header details a[href="/cambiar-password"]').textContent.includes('Cambiar contraseña')`));
    await c('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    assert(await evaluate('!document.querySelector("header details").open'));
    assert(await evaluate('document.activeElement===document.querySelector("header summary")'));
    await evaluate('document.querySelector("header summary").click();document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
    assert(await evaluate('!document.querySelector("header details").open'));
    await evaluate(`document.querySelector('header summary').click();document.querySelector('header a[href="/cambiar-password"]').click()`);
    await until('location.pathname==="/cambiar-password" && document.querySelectorAll("input[type=password]").length>=2');checks.push('ACCOUNT_ESCAPE_OUTSIDE_PASSWORD_ROUTE');
    await home();
    await evaluate('document.querySelector("main details[data-progress-info] summary").click()');
    assert((await evaluate('document.body.innerText')).includes('Consultado:'));
    await evaluate('document.querySelector("main details[data-progress-info] summary").click()');
    await evaluate('Array.from(document.querySelectorAll("main details summary")).find(e=>e.textContent.includes("Historial")).click()');
    assert((await evaluate('document.body.innerText')).includes('Aporte del trabajo'));
    checks.push('PERIOD_VALUES_UNCHANGED','INFO_AND_HISTORY_DISCLOSURES');
    await home();
    const filter=async label=>evaluate(`Array.from(document.querySelectorAll('main button')).find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`);
    await filter('Atendidos');await until('document.body.innerText.includes("Orden RUT-LOCAL")');
    await filter('Disponibles');await until('document.body.innerText.includes("No hay trabajos en este filtro")');
    await filter('Pendientes');await until('document.body.innerText.includes("AV-LOCAL")');
    checks.push('PENDING_COMPLETED_AVAILABLE_FILTERS');
    await evaluate('window.dispatchEvent(new Event("offline"))');
    assert((await evaluate('document.body.innerText')).includes('Sin señal'));
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await evaluate('window.dispatchEvent(new Event("online"))');checks.push('OFFLINE_HEADER_NO_OVERFLOW');
  }
  await evaluate('Array.from(document.links).find(a=>a.getAttribute("href")==="/soporte/ranking").click()');
  await until('document.body.innerText.includes("Compañero de prueba")');await screenshot('RANKING');await savePayloads();
  await c('Page.navigate',{url:origin+'/campo/mi-custodia'});
  await until('document.body.innerText.includes("SERIE-LARGA")');await screenshot('CUSTODIA');await savePayloads();
  assert(!/Devolver|Transferir|Ajustar|Entregar/.test(await evaluate('document.body.innerText')));
  if(!before){
    // The same read RPC fails/loads/retries; no invented zero or stale totals.
    await evaluate('window.__custody="error";document.querySelector("header a[aria-label=Inicio]").click()');
    await until('document.body.innerText.includes("No se pudo consultar el resumen")');
    assert(!(await evaluate('document.body.innerText')).includes('2 equipos disponibles'));
    await evaluate(`window.__custody='loading';document.querySelector('button[aria-label="Reintentar resumen de custodia"]').click()`);
    await until('document.body.innerText.includes("Consultando tu custodia")');
    await until('document.body.innerText.includes("2 equipos disponibles")');checks.push('CUSTODY_LOADING_ERROR_RETRY');
    const loads=await evaluate('window.__loads');
    await evaluate('document.querySelector("header button[aria-label=Recargar]").click()');
    await until('document.body.innerText.includes("Los cambios sin guardar")');
    await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(e=>e.textContent.includes("Actualizar")).click()');
    await until('window.__loads>'+loads+' && document.body.innerText.includes("AV-LOCAL")');checks.push('WEBVIEW_RELOAD_WITH_CONFIRMATION');
    await evaluate('document.querySelector("header summary").click();[...document.querySelectorAll("header details button")].find(e=>e.textContent.includes("Cerrar sesión")).click()');
    await until('location.pathname==="/login"');
    assert(await evaluate('!localStorage.getItem("sb-mzupdnjegfwmpajywckd-auth-token")'));
    assert(await evaluate('window.__calls.some(c=>c.path.endsWith("/logout")&&c.method==="POST")'));checks.push('LOGOUT_RPC_AND_LOCAL_SESSION_CLEARED');
    await c('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36'});
    await c('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await home();assert(await evaluate('!document.querySelector("header button[aria-label=Recargar]")'));
    assert(await evaluate('!!document.querySelector("header summary") && document.documentElement.scrollWidth<=innerWidth'));
    checks.push('DESKTOP_NON_NATIVE_HEADER');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  const report={stage,synthetic:true,productionAccess:false,androidUA:true,physicalAndroid:false,widths,payloads,checks,outputs,exceptions:errors.length};
  await writeFile('docs/CAMPO-VISUAL-'+stage+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({stage,widths,checks,outputs,exceptions:errors.length}));
  await send('Browser.close');
}finally{if(ws)ws.close();chrome.kill();}
