// Real views/forms/stores, synthetic REST, local Vite. All external requests blocked.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './work-order-schedule.fixture.mjs';
process.env.VITE_SUPABASE_URL='https://schedule.invalid';
process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});
await server.listen();
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-schedule-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank',
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,seq=0;const pending=new Map(),errors=[];let checks=0;
try {
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Chrome timeout')),20000);let log='';
    chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    chrome.on('error',reject);
  });
  ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const c=(method,params={})=>send(method,params,sessionId);
  await c('Page.enable');await c('Runtime.enable');
  await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  ws.addEventListener('message',async e=>{
    const m=JSON.parse(e.data);if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request}=m.params;
    await c(request.url.startsWith(base)?'Fetch.continueRequest':'Fetch.failRequest',request.url.startsWith(base)?{requestId}:{requestId,errorReason:'BlockedByClient'});
  });
  await c('Page.addScriptToEvaluateOnNewDocument',{source:`(${fixture.toString()})()`});
  await c('Emulation.setTimezoneOverride',{timezoneId:'Asia/Tokyo'});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression+'\n'+await evaluate('document.body.innerText.slice(-4500)'));};
  const page=async(route,role='ADMIN',mobile=false)=>{
    await c('Emulation.setDeviceMetricsOverride',{width:mobile?390:1366,height:900,deviceScaleFactor:1,mobile});
    await c('Page.navigate',{url:base+'scripts/tests/work-order-schedule.html?'+new URLSearchParams({route,role})});
    await until('window.ready===true');
  };
  const has=async text=>{await until(`document.querySelector('[data-work-order-schedule]') && [...document.querySelectorAll('[data-work-order-schedule]')].some(e=>e.textContent.includes(${JSON.stringify(text)}))`);checks++;};
  const click=async text=>{await evaluate(`clickText(${JSON.stringify(text)})`);};
  const field=async(label,value)=>{await evaluate(`setField(${JSON.stringify(label)},${JSON.stringify(value)})`);};
  const adminPaths={ticket:'/soporte',installation:'/soporte/instalaciones',routine:'/soporte/rutinas'};
  const detail=(type,id)=>type==='ticket'?'/soporte/'+id:adminPaths[type]+'/'+id;
  await page('/soporte');
  await evaluate('resetOrders()');
  const created={};
  for(const type of ['ticket','installation','routine']) {
    created[type]=[];
    for(const [time,end,assigned] of [['10:00','12:00',true],['14:00','16:00',false]]) {
      await page(adminPaths[type]+(type==='ticket'?'?schedule_date=2026-11-18&q=local':'?create=1&q=local'));
      await until('!!document.querySelector(".modal-overlay form")');
      if(type!=='routine')await field('Cliente',await evaluate('db.clients[0].id'));
      if(type==='installation') {
        await until('document.querySelector(".modal-overlay form").innerText.includes("CTR-LOCAL")');
        await field('Contrato',await evaluate('db.service_contracts[0].id'));
      }
      if(type!=='installation')await field('Título',type+' local '+time);
      await field(type==='routine'?'Puntaje':'Puntos de la orden',10);
      await field('Fecha programada','2026-11-18');
      await field(type==='installation'?'Hora':'Turno',type==='installation'?time:time+'-'+end);
      if(assigned)await field('Técnico',await evaluate('techId'));
      await evaluate('document.querySelector(".modal-overlay form").requestSubmit()');
      await until('!document.querySelector(".modal-overlay form")');
      const row=await evaluate(`db.${{ticket:'tickets',installation:'installations',routine:'routines'}[type]}.at(-1)`);
      assert.equal(row.scheduled_start_at,'2026-11-18T'+(time==='10:00'?'15':'19')+':00:00.000Z');checks++;
      assert.equal(row.assigned_to,assigned?await evaluate('techId'):null);checks++;
      assert.equal(row.scheduled_end_at,type==='installation'?null:'2026-11-18T'+(end==='12:00'?'17':'21')+':00:00.000Z');checks++;
      created[type].push(row.id);
      await page(adminPaths[type]); // recreate stores from persisted synthetic REST; default Peru day
      await has('18/11/2026 · '+time+(type==='installation'?'':'–'+end));
    }
    const id=created[type][0];
    if(type==='routine') {
      await page(adminPaths[type]+'?q=local');
      await until('!!document.querySelector("tbody tr")');
      await evaluate(`document.querySelectorAll('tbody tr')[0].click()`);
      await until('!!document.querySelector(".modal-overlay form")');
      assert.equal(await evaluate('document.querySelector(".modal-overlay form select option:checked[value=__existing]")!==null'),true);checks++;
      // An unrelated edit must not erase the saved turn.
      await field('Descripción','Cambio sintético sin tocar la cita');
      await evaluate('document.querySelector(".modal-overlay form").requestSubmit()');
      await until('!document.querySelector(".modal-overlay form")');
      assert.equal(await evaluate(`db.routines.find(r=>r.id==='${id}').scheduled_start_at`),'2026-11-18T15:00:00.000Z');checks++;
      await evaluate(`document.querySelectorAll('tbody tr')[0].click()`);
      await until('!!document.querySelector(".modal-overlay form")');
      await field('Turno','16:00-18:00');
      await evaluate('document.querySelector(".modal-overlay form").requestSubmit()');
      await until('!document.querySelector(".modal-overlay form")');
    } else {
      await page(detail(type,id));
      await until('!!document.querySelector("[data-schedule-editor] button")');
      await click('Editar programación');
      await field('Hora programada','16:00');
      if(type==='ticket')await field('Hora de fin','18:00');
      await click('Guardar programación');
      await until('!document.querySelector("[data-schedule-editor] form")');
      const writes=await evaluate(`calls.filter(r=>r.method==='PATCH').map(r=>r.body)`);
      assert.ok(writes.length>0);checks++;
      for(const payload of writes)for(const key of Object.keys(payload))assert.ok(key.startsWith('scheduled_'),key);
    }
    const label='18/11/2026 · 16:00'+(type==='installation'?'':'–18:00');
    await page(adminPaths[type]+'?q=local');await has(label);
    await page(detail(type,id));await has(label);
    await page('/campo','TECNICO_RED',true);await has(label);
    assert.equal(await evaluate(`campo.trabajos.some(r=>r.id==='${created[type][1]}')`),false);checks++;
    await page('/campo/'+type+'/'+id,'TECNICO_RED',true);await has(label);
    assert.equal(await evaluate('document.body.innerText.includes("Editar programación")'),false);checks++;
    // The unassigned pool keeps the schedule, without granting assignment.
    await page('/campo/'+type+'/'+created[type][1],'TECNICO_RED',true);
    await has('18/11/2026 · 14:00'+(type==='installation'?'':'–16:00'));
    assert.equal(await evaluate(`db.${{ticket:'tickets',installation:'installations',routine:'routines'}[type]}.find(r=>r.id==='${created[type][1]}').assigned_to`),null);checks++;
    const historic=await evaluate(`seedOrder('${type}',{title:'Histórica local',assigned_to:techId,status:'${type==='ticket'?'open':'pending'}'})`);
    await page('/campo/'+type+'/'+historic,'TECNICO_RED',true);await has('Sin programación');
    if(type!=='ticket') {
      const dateOnly=await evaluate(`seedOrder('${type}',{title:'Fecha sola local',assigned_to:techId,scheduled_date:'2026-11-18',status:'pending'})`);
      await page('/campo/'+type+'/'+dateOnly,'TECNICO_RED',true);await has('18/11/2026 · Sin horario programado');
    }
    console.log('SCHEDULE_BROWSER_OK '+type+': create morning/afternoon, edit, reload, admin/list/detail, field assigned/unassigned/historical');
  }
  // Permission and finality guards in the real views/stores.
  for(const type of ['ticket','installation']) {
    await page(detail(type,created[type][0]),'TECNICO_RED');await has('18/11/2026 · 16:00');
    assert.equal(await evaluate('!!document.querySelector("[data-schedule-editor] button")'),false);checks++;
    await page(detail(type,created[type][0]));await until('!!document.querySelector("[data-schedule-editor] button")');
    await click('Editar programación');await field('Hora programada','17:00');
    await evaluate('window.locked=true');
    const before=await evaluate('calls.filter(r=>r.method==="PATCH").length');
    await click('Guardar programación');
    await until('document.querySelector("[data-schedule-editor]").innerText.includes("Cierre administrativo definitivo")');
    assert.equal(await evaluate('calls.filter(r=>r.method==="PATCH").length'),before);checks++;
  }
  // Dispatch must synchronize legacy date/time with timestamps, including Peru day.
  await page('/soporte');await evaluate('resetOrders()');
  const dispatchIds={};
  for(const type of ['ticket','installation','routine'])dispatchIds[type]=await evaluate(`seedOrder('${type}',{assigned_to:techId,status:'${type==='ticket'?'open':'scheduled'}',scheduled_date:${type==='ticket'?'null':"'2026-11-17'"},scheduled_time:${type==='installation'?"'09:00'":'null'},scheduled_start_at:'2026-11-18T15:00:00Z'})`);
  await page('/soporte/agenda');await until('document.body.innerText.includes("Programación o asignación por completar (3)")');checks++;
  for(const [type,start,end] of [['ticket','08:00','09:00'],['installation','12:00','13:00'],['routine','14:00','15:00']]) {
    await click('🕐 Agendar');
    await until('document.querySelectorAll("input[type=time]").length===2');
    await evaluate(`document.querySelectorAll('input[type=time]').forEach((el,i)=>{el.value=i?'${end}':'${start}';el.dispatchEvent(new Event('input',{bubbles:true}));})`);
    await click('Confirmar');
    await until('document.querySelectorAll("input[type=time]").length===0');
    const row=await evaluate(`db.${{ticket:'tickets',installation:'installations',routine:'routines'}[type]}.find(r=>r.id==='${dispatchIds[type]}')`);
    if(type!=='ticket'){assert.equal(row.scheduled_date,'2026-11-18');checks++;}
    if(type==='installation'){assert.equal(row.scheduled_time,'12:00');checks++;}
    await page(detail(type,dispatchIds[type]));await has('18/11/2026 · '+start+'–'+end);
    await page('/campo/'+type+'/'+dispatchIds[type],'TECNICO_RED',true);await has('18/11/2026 · '+start+'–'+end);
    await page('/soporte/agenda');
  }
  // An unassigned routine retains its window in dispatch; no automatic assignment.
  await evaluate(`seedOrder('routine',{title:'Rutina libre de referencia sintética',scheduled_date:'2026-11-18',scheduled_start_at:'2026-11-18T15:00:00Z',scheduled_end_at:'2026-11-18T17:00:00Z'})`);
  await page('/soporte/agenda');await has('18/11/2026 · 10:00–12:00');
  assert.equal(await evaluate('document.body.innerText.includes("Sin asignar")'),true);checks++;
  // Reprogramming uses its current appointment rather than the earlier original turn.
  const rescheduled=await evaluate(`seedOrder('ticket',{status:'rescheduled',assigned_to:techId,scheduled_start_at:'2026-11-18T15:00:00Z',scheduled_end_at:'2026-11-18T17:00:00Z',rescheduled_to:'2026-11-19T21:00:00Z'})`);
  await page(detail('ticket',rescheduled));await has('19/11/2026 · 16:00');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='✏️ Editar' && b.closest('.surface')?.innerText.includes('Reprogramado — fecha editable')).click()`);
  await until('!!document.querySelector("input[type=datetime-local]")');
  assert.equal(await evaluate('document.querySelector("input[type=datetime-local]").value'),'2026-11-19T16:00');checks++;
  await evaluate(`const el=document.querySelector('input[type=datetime-local]');el.value='2026-11-19T14:30';el.dispatchEvent(new Event('input',{bubbles:true}));`);
  await click('Guardar');await has('19/11/2026 · 14:30');
  assert.equal(await evaluate(`db.tickets.find(r=>r.id==='${rescheduled}').rescheduled_to`),'2026-11-19T19:30:00.000Z');checks++;
  await page('/campo/ticket/'+rescheduled,'TECNICO_RED',true);await has('19/11/2026 · 14:30');
  await page(detail('ticket',rescheduled));await has('19/11/2026 · 14:30');
  await click('Editar programación');await field('Hora programada','14:00');await field('Hora de fin','16:00');
  await click('Guardar programación');await until('!document.querySelector("[data-schedule-editor] form")');await has('19/11/2026 · 14:00–16:00');
  await page('/campo/ticket/'+rescheduled,'TECNICO_RED',true);await has('19/11/2026 · 14:00–16:00');
  const absent=await evaluate(`seedOrder('ticket',{status:'in_progress',assigned_to:techId,scheduled_start_at:'2026-11-18T15:00:00Z',scheduled_end_at:'2026-11-18T17:00:00Z'})`);
  await evaluate(`db.job_assignees.push({job_type:'ticket',job_id:'${absent}',technician_id:techId,role:'leader',profile:db.profiles[0]});sessionStorage.setItem('schedule-fixture',JSON.stringify(db));`);
  await page('/campo/ticket/'+absent,'TECNICO_RED',true);await until('document.body.innerText.includes("🏠 Cliente Ausente")');
  await click('🏠 Cliente Ausente');await until('!!document.querySelector("input[type=datetime-local]")');
  assert.equal(await evaluate('document.querySelector("input[type=datetime-local]").value'),'2026-11-19T08:00');checks++;
  await click('Confirmar reprogramación');
  await until(`db.tickets.find(r=>r.id==='${absent}').status==='rescheduled'`);
  const absentRow=await evaluate(`db.tickets.find(r=>r.id==='${absent}')`);
  assert.equal(absentRow.scheduled_start_at,'2026-11-19T13:00:00.000Z');checks++;
  assert.equal(absentRow.scheduled_start_at,absentRow.rescheduled_to);checks++;
  assert.equal(absentRow.scheduled_end_at,null);checks++;
  assert.equal(absentRow.assigned_to,await evaluate('techId'));checks++;
  assert.equal(absentRow.priority,'urgent');checks++;
  await evaluate(`db.tickets.find(r=>r.id==='${absent}').status='in_progress';sessionStorage.setItem('schedule-fixture',JSON.stringify(db));`);
  await page('/campo/ticket/'+absent,'TECNICO_RED',true);await has('19/11/2026 · 08:00');
  console.log('SCHEDULE_DISPATCH_RESCHEDULE_OK all three types, legacy synchronization, unassigned reservation and Lima reschedule');
  assert.deepEqual(errors,[]);checks++;
  console.log(`WORK_ORDER_SCHEDULE_BROWSER_OK ${checks} checks; Asia/Tokyo browser, desktop/mobile, zero external network`);
} catch(error) { console.error(errors.map(e=>e.exception?.description||e.text));throw error; }
finally {if(ws)ws.close();chrome.kill();await server.close();}
