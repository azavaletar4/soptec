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
  const until=async expression=>{for(let n=0;n<70;n++){const v=await evaluate(expression);if(v)return v;await new Promise(r=>setTimeout(r,150));}console.log(await evaluate('JSON.stringify({path:location.pathname,body:document.body.innerText.slice(0,2500),calls:window.__calls})'));console.log(JSON.stringify(errors));throw Error('UI_TIMEOUT: '+expression);};
  function fixture(){
    const uid='00000000-0000-4000-8000-000000000003';
    const jobId='10000000-0000-4000-8000-000000000001';
    const role=sessionStorage.getItem('test-role')||'TECNICO_RED';
    const now=Math.floor(Date.now()/1000),enc=o=>btoa(JSON.stringify(o)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
    const user={id:uid,aud:'authenticated',role:'authenticated',email:'local@example.invalid',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
    localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:uid,aud:'authenticated',role:'authenticated',exp:now+3600,iat:now})+'.synthetic',refresh_token:'synthetic',token_type:'bearer',expires_at:now+3600,expires_in:3600,user}));
    window.__calls=[]; window.__mode='ready';window.__custody='ready';window.__rankingMode='ready';
    const realFetch=window.fetch.bind(window);
    window.fetch=async(input,init={})=>{
      const u=new URL(typeof input==='string'?input:input.url,location.href);
      if(!u.hostname.endsWith('.supabase.co')&&!u.pathname.startsWith('/api/'))return realFetch(input,init);
      const method=init.method||(input instanceof Request?input.method:'GET');
      window.__calls.push({path:u.pathname,method,query:u.search});
      const table=u.pathname.split('/').at(-1);
      const reads=['my_field_progress','my_field_job_points','my_inventory_custody'];
      if(!['GET','HEAD'].includes(method)&&!reads.includes(table))return new Response('{}',{status:403});
      const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Content-Range':'0-0/1'}});
      const profile={id:uid,full_name:'Técnico local',role,active:true,must_change_password:false};
      const job={id:jobId,routine_number:'RUT-LOCAL',status:'completed',assigned_to:uid,title:'Mantenimiento de caja NAP con nombre largo para comprobar el ajuste móvil',completed_at:'2026-10-20T18:00:00Z',created_at:'2026-10-20T12:00:00Z',points:10,priority:'medium',client_id:null,contract_id:null,scheduled_date:'2026-10-20',tipo_rutina:'mantenimiento_preventivo',subtipo:null,routine_returns:[]};
      let data=[];
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
        data=window.__custody==='empty'?{units:[],materials:[],pendingReturnRequests:[]}:{units:[{id:'unit',product:{id:'ont',name:'ONT de prueba con descripción larga'},serial_number:'SERIE-LARGA-123456789012345678901234567890',mac_address:'00:11:22:33:44:55',status:'with_technician'}],materials:[{product:{id:'drop',name:'Cable Drop de fibra óptica para instalación',unit:'metros'},quantity:120.5}],pendingReturnRequests:[]};
      }
      return response(data);
    };
  }
  const layoutOnly=process.argv.includes('--layout-only');
  await c('Page.addScriptToEvaluateOnNewDocument',{source:(layoutOnly?'window.__layoutAudit=true;':'')+'('+fixture.toString()+')();'});
  await c('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  await c('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; Mobile; wv) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36 SmartRaycoApp/1.0'});
  await c('Page.navigate',{url:'http://127.0.0.1:5193/'+(layoutOnly?'campo':'soporte/')});
  await until('location.pathname==="/campo" && document.body.innerText.includes("12.5")');
  if(layoutOnly){
    await until('document.body.innerText.includes("AV-LOCAL") && document.body.innerText.includes("RUT-PENDIENTE")');
    const widths=[];
    for(const width of [320,360,390,412,1280]){
      await c('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<500});
      const audit=await evaluate(`(()=>{
        const main=document.querySelector('main');
        const find=(selector,text)=>[...main.querySelectorAll(selector)].find(e=>e.textContent.trim()===text);
        const positions={points:find('h2','Mi Avance').getBoundingClientRect().top,
          ranking:main.querySelector('a[href="/soporte/ranking"]').getBoundingClientRect().top,
          custody:main.querySelector('a[href="/campo/mi-custodia"]').getBoundingClientRect().top,
          orders:find('h2','Mis órdenes').getBoundingClientRect().top,
          firstOrder:main.querySelector(':scope > ul > li').getBoundingClientRect().top,
          secondary:find('summary','Asistencia y accesos secundarios').getBoundingClientRect().top};
        return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,positions,
          orders:main.querySelectorAll(':scope > ul > li').length,
          clipped:[...main.querySelectorAll('p,h2,a,button,summary')].filter(e=>e.checkVisibility()&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent.trim()),
          forbiddenLinks:[...main.querySelectorAll('a')].filter(a=>/^\\/(admin|facturacion|clientes|contratos|usuarios)(\\/|$)/.test(a.getAttribute('href'))).map(a=>a.getAttribute('href')),
          adminControls:/Operaciones de Hoy|Técnicos Activos|Gestión de usuarios|Facturación|Salarios/.test(main.innerText)};
      })()`);
      assert(audit.scrollWidth<=audit.viewport,'layout overflow '+JSON.stringify(audit));
      assert.equal(audit.clipped.length,0,JSON.stringify(audit.clipped));
      assert.equal(audit.forbiddenLinks.length,0);assert.equal(audit.adminControls,false);
      const p=Object.values(audit.positions);assert(p.every((v,i)=>!i||v>p[i-1]),'layout order '+JSON.stringify(audit.positions));
      assert.equal(audit.orders,3);widths.push({width,...audit});
    }
    await c('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
    await writeFile('docs/MI-AVANCE-MOVIL-REVISION.png',Buffer.from((await c('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const metrics=await c('Page.getLayoutMetrics');
    await writeFile('docs/MI-AVANCE-MOVIL-COMPLETA.png',Buffer.from((await c('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:360,height:metrics.cssContentSize.height,scale:1}})).data,'base64'));
    await evaluate('Array.from(document.links).find(a=>a.getAttribute("href")==="/soporte/ranking").click()');
    await until('document.body.innerText.includes("Compañero de prueba")');
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await writeFile('docs/MI-AVANCE-RANKING-REVISION.png',Buffer.from((await c('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await c('Page.navigate',{url:'http://127.0.0.1:5193/campo/mi-custodia'});
    await until('document.body.innerText.includes("SERIE-LARGA")');
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    assert(!/Devolver|Transferir|Ajustar|Entregar/.test(await evaluate('document.body.innerText')));
    await writeFile('docs/MI-AVANCE-CUSTODIA-REVISION.png',Buffer.from((await c('Page.captureScreenshot',{format:'png'})).data,'base64'));
    assert.equal(errors.length,0,JSON.stringify(errors));
    const report={synthetic:true,productionAccess:false,androidUA:true,realAndroid:false,widths,rankingAccessible:true,custodyReadOnly:true,exceptions:errors.length};
    await writeFile('docs/MI-AVANCE-REVISION-VISUAL.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } else {
  const clickText=async text=>evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.includes('+JSON.stringify(text)+'));if(!b)return false;b.click();return true;})()');
  await until('document.body.innerText.includes("Atendidos")');
  assert(await clickText('Atendidos'));
  await until('document.body.innerText.includes("Mantenimiento de caja")');
  assert((await evaluate('document.body.innerText')).includes('12.5 pts'));
  checks.push('TECH_HOME_REDIRECT','ORDER_POINTS');
  for(const width of [360,390,1280]){
    await c('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<500});
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'overflow '+width);
    checks.push('NO_HORIZONTAL_OVERFLOW_'+width);
  }
  await c('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  const homeScreenshot=await c('Page.captureScreenshot',{format:'png'});
  await writeFile('docs/MI-AVANCE-MOVIL-LOCAL.png',Buffer.from(homeScreenshot.data,'base64'));
  await evaluate('window.__mode="loading"');assert(await clickText('Actualizar'));
  await until('document.body.innerText.includes("Consultando tus puntos")');
  assert(!(await evaluate('document.body.innerText')).includes('12.5 pts'));
  await until('document.body.innerText.includes("12.5 pts")');
  await evaluate('window.__mode="error"');assert(await clickText('Actualizar'));
  await until('document.body.innerText.includes("No se pudieron consultar tus puntos")');
  assert(!(await evaluate('document.body.innerText')).includes('12.5 pts'));
  await evaluate('window.__mode="ready"');assert(await clickText('Actualizar'));
  await until('document.body.innerText.includes("12.5 pts")');
  checks.push('POINT_LOADING_ERROR_RETRY');
  await evaluate('Array.from(document.links).find(a=>a.getAttribute("href")==="/campo/mi-custodia").click()');
  await until('document.body.innerText.includes("SERIE-LARGA")');
  assert((await evaluate('document.body.innerText')).includes('00:11:22:33:44:55'));
  assert((await evaluate('document.body.innerText')).includes('120.5 metros'));
  assert(!/Devolver|Transferir|Ajustar|Entregar/.test(await evaluate('document.body.innerText')));
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  const screenshot=await c('Page.captureScreenshot',{format:'png'});
  await writeFile('docs/MI-AVANCE-CUSTODIA-LOCAL.png',Buffer.from(screenshot.data,'base64'));
  await evaluate('window.__custody="empty"');assert(await clickText('Actualizar'));
  await until('document.body.innerText.includes("No tienes materiales disponibles")');
  assert((await evaluate('document.body.innerText')).includes('No tienes equipos en custodia'));
  await evaluate('window.__custody="error"');assert(await clickText('Actualizar'));
  await until('document.body.innerText.includes("No se pudo consultar tu custodia")');
  await evaluate('window.__custody="loading"');assert(await clickText('Actualizar'));
  await until('document.body.innerText.includes("Consultando tu custodia")');
  await until('document.body.innerText.includes("SERIE-LARGA")');
  checks.push('CUSTODY_SERIAL_MAC_UNIT','CUSTODY_READ_ONLY','CUSTODY_LOADING_EMPTY_ERROR_RETRY');
  await c('Page.navigate',{url:'http://127.0.0.1:5193/campo'});
  await until('document.body.innerText.includes("Ver ranking de técnicos")');
  await evaluate('Array.from(document.links).find(a=>a.getAttribute("href")==="/soporte/ranking").click()');
  await until('location.pathname==="/soporte/ranking" && document.body.innerText.includes("Compañero de prueba")');
  for(const period of ['day','week','month']){
    await evaluate('(()=>{const s=document.querySelector("#ranking-period");s.value='+JSON.stringify(period)+';s.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await until('document.body.innerText.includes("Compañero de prueba") && !document.body.innerText.includes("Calculando")');
  }
  await evaluate('window.__slowRankPeriod="day"');
  await evaluate('(()=>{const s=document.querySelector("#ranking-period");s.value="day";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await evaluate('(()=>{const s=document.querySelector("#ranking-period");s.value="week";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await until('document.body.innerText.includes("19-oct.") && document.body.innerText.includes("Compañero de prueba")');
  await new Promise(r=>setTimeout(r,1000));
  assert((await evaluate('document.body.innerText')).includes('19-oct.'));
  await evaluate('window.__slowRankPeriod=null; const s=document.querySelector("#ranking-period");s.value="month";s.dispatchEvent(new Event("change",{bubbles:true}));');
  await until('document.body.innerText.includes("01-oct.") && document.body.innerText.includes("Compañero de prueba")');
  checks.push('RANKING_STALE_PERIOD_DISCARDED');
  for(const width of [360,390,1280]){
    await c('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:width<500});
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'ranking overflow '+width);
  }
  await c('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  const rankingShot=await c('Page.captureScreenshot',{format:'png'});
  await writeFile('docs/MI-AVANCE-RANKING-LOCAL.png',Buffer.from(rankingShot.data,'base64'));
  await evaluate('window.__rankingMode="error"');assert(await clickText('Actualizar'));
  await until('!document.body.innerText.includes("Compañero de prueba") && !document.body.innerText.includes("Calculando")');
  await evaluate('window.__rankingMode="ready"');assert(await clickText('Actualizar'));
  await until('document.body.innerText.includes("Compañero de prueba")');
  checks.push('TECHNICIAN_RANKING_ALL_PERIODS','RANKING_TIED_WINNERS_VISIBLE','RANKING_MOBILE_DESKTOP','RANKING_ERROR_RETRY');
  await c('Page.navigate',{url:'http://127.0.0.1:5193/campo/routine/10000000-0000-4000-8000-000000000001'});
  await until('document.body.innerText.includes("Mi aporte en puntos") && document.body.innerText.includes("12.5 pts")');
  checks.push('HISTORIC_JOB_DETAIL');
  const calls=await evaluate('window.__calls');
  // Existing app telemetry is rejected by the fixture; no business mutation runs.
  assert(!calls.some(r=>!['GET','HEAD'].includes(r.method)&&!['my_field_progress','my_field_job_points','my_inventory_custody','update_own_telemetry'].some(name=>r.path.endsWith('/'+name))));
  checks.push('BUSINESS_WRITES_ZERO');
  await evaluate('sessionStorage.setItem("test-role","ADMIN")');
  await c('Page.navigate',{url:'http://127.0.0.1:5193/soporte'});
  await until('location.pathname==="/soporte" && document.body.innerText.includes("Operaciones de Hoy")');
  assert(!(await evaluate('document.body.innerText')).includes('Mi Avance'));
  checks.push('ADMIN_OPERATIONS_RETAINED');
  for(const role of ['ADMIN','SUPERADMIN']){
    await evaluate('sessionStorage.setItem("test-role",'+JSON.stringify(role)+')');
    await c('Page.navigate',{url:'http://127.0.0.1:5193/soporte/ranking'});
    await until('document.body.innerText.includes("Compañero de prueba")');
    checks.push(role+'_RANKING_RETAINED');
  }
  assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile('docs/MI-AVANCE-NAVEGADOR-LOCAL.json',JSON.stringify({synthetic:true,productionAccess:false,checks,errors},null,2));
  console.log(JSON.stringify({checks,exceptions:errors.length}));
  }
  await send('Browser.close');
} finally {if(ws)ws.close();chrome.kill();}
