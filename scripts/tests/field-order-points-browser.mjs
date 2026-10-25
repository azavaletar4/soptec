// Only loopback Vite. Every external request is blocked; API responses synthetic.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://points.invalid';
process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});
await server.listen();
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-field-points-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;let seq=0;const pending=new Map();const errors=[];let checks=0;
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
    if(request.url.startsWith(base))await c('Fetch.continueRequest',{requestId});
    else await c('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
  });
  await c('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.calls=[];window.points=10;window.denied=false;window.readfail=false;
    window.existingSignature=null;window.closureFail=false;window.savedClosures=[];
    const real=window.fetch.bind(window);window.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin)return real(input,init);
      const table=url.pathname.split('/').at(-1),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
      window.calls.push({table,method,body});
      const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
      if(table==='work_order_is_final')return json(!!window.finalOrder);
      if(table==='my_field_order_points'){
        if(window.readfail)return json({message:'Prueba de error de lectura'},400);
        return json(window.denied?null:{jobPoints:window.points,configuredPoints:window.points,personalPoints:window.points/2,crewSize:2,status:'in_progress',asOf:new Date().toISOString()});
      }
      if(table==='assert_material_closure_ready')return json(null);
      if(table==='work_order_closures'){
        if(method==='GET'){
          if(window.closureFail)return json({message:'No se pudo leer la firma anterior'},400);
          return json(window.existingSignature?[{signature_path:window.existingSignature}]:[]);
        }
        if(method==='POST'){window.savedClosures.push(body);return new Response(null,{status:204});}
      }
      if(['tickets','installations','routines'].includes(table))return json({id:'10000000-0000-0000-0000-000000000001',...body});
      if(table==='work_order_photos')return json([]);
      throw Error('External or unexpected operation blocked: '+url.pathname);
    };
  `});
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let n=0;n<220;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);};
  await c('Page.navigate',{url:base+'scripts/tests/field-order-points-browser.html'});
  await wait('window.ready && document.body.innerText.includes("10 pts")');
  if(process.argv.includes('--offline-only')) {
    await evaluate('offline.clear();offline.online(false)');
    for(const type of ['ticket','installation','routine']) {
      const writes=await evaluate('calls.filter(c=>["PATCH","DELETE"].includes(c.method)||c.table==="work_order_closures").length');
      assert.equal((await evaluate(`closeWithoutSignature('${type}',{latitude:-12.04,longitude:-77.03})`)).queued,true);checks++;
      assert.equal(await evaluate('calls.filter(c=>["PATCH","DELETE"].includes(c.method)||c.table==="work_order_closures").length'),writes);checks++;
    }
    assert.equal(await evaluate('offline.read().then(rows=>rows.length)'),3);checks++;
    // A fresh page recreates the real store; IndexedDB is retained by the profile.
    await c('Page.reload');await wait('window.ready && !!window.offline');
    assert.equal(await evaluate('offline.read().then(rows=>rows.length)'),3);checks++;
    await evaluate('offline.online(true);window.existingSignature="historical/signature.png"');
    const synced=await evaluate('offline.flush()');assert.deepEqual(synced,{synced:3,remaining:0});checks++;
    assert.ok(await evaluate('savedClosures.every(row=>row.signature_path==="historical/signature.png" && row.latitude===-12.04 && row.longitude===-77.03)'));checks++;
    assert.equal((await evaluate('offline.flush()')).synced,0);checks++;
    await evaluate('offline.online(false)');
    await evaluate(`closeWithoutSignature('ticket',{photos:[{category:'service_sheet',file:new File(['synthetic photo'],'sheet.jpg',{type:'image/jpeg'})}],latitude:-12.04,longitude:-77.03})`);
    assert.equal(await evaluate('offline.read().then(rows=>rows[0].photos[0].blob.size)'),15);checks++;
    await evaluate('offline.online(true);window.finalOrder=true');
    const writes=await evaluate('calls.filter(c=>["PATCH","DELETE"].includes(c.method)||c.table==="work_order_closures").length');
    assert.deepEqual(await evaluate('offline.flush()'),{synced:0,remaining:1});checks++;
    assert.ok(await evaluate('offline.read().then(rows=>rows[0].lastError.includes("Cierre administrativo definitivo") && rows[0].photos[0].blob.size===15)'));checks++;
    assert.equal(await evaluate('calls.filter(c=>["PATCH","DELETE"].includes(c.method)||c.table==="work_order_closures").length'),writes);checks++;
    await evaluate('offline.clear()');
    assert.deepEqual(errors,[]);checks++;
    console.log(`FIELD_OFFLINE_BROWSER_OK: ${checks} checks; real IndexedDB/store, synthetic API, no external network`);
  } else {
  for(const type of ['ticket','installation','routine']) {
    await evaluate(`window.points=10;setCase('${type}')`);
    await wait('document.body.innerText.includes("10 pts")');
    assert.equal(await evaluate('!!document.querySelector("input,textarea,select")'),false);checks++;
    assert.equal(await evaluate('document.body.innerText.includes("5 pts")'),true);checks++;
    await evaluate('window.points=18;emitOrderChange()');
    await wait('document.body.innerText.includes("18 pts")');
    assert.equal(await evaluate('document.body.innerText.includes("9 pts")'),true);checks++;
    await evaluate(`setCase('${type}','00000000-0000-0000-0000-000000000004')`);
    await wait('document.body.innerText.includes("18 pts")');checks++;
    const result=await evaluate(`closeWithoutSignature('${type}')`);
    assert.equal(result.queued,false);checks++;
    assert.equal(await evaluate('savedClosures.at(-1).signature_path'),null);checks++;
    assert.equal(await evaluate(`calls.some(c=>c.table==='${{ticket:'tickets',installation:'installations',routine:'routines'}[type]}' && c.method==='PATCH' && c.body.status==='${type==='ticket'?'resolved':'completed'}')`),true);checks++;
  }
  await evaluate('window.points=24;window.dispatchEvent(new Event("focus"))');
  await wait('document.body.innerText.includes("24 pts")');checks++;
  await evaluate('window.points=30');
  await wait('document.body.innerText.includes("30 pts")');checks++; // polling fallback, <=15s
  await evaluate('window.denied=true;emitOrderChange()');
  await wait('document.body.innerText.includes("no disponible")');
  assert.equal(await evaluate('document.body.innerText.includes("30 pts")'),false);checks++;
  await evaluate('window.denied=false;window.readfail=true;emitOrderChange()');
  await wait('document.body.innerText.includes("No se pudieron")');checks++;
  await evaluate('window.readfail=false;window.points=12;window.dispatchEvent(new Event("online"))');
  await wait('document.body.innerText.includes("12 pts")');checks++;
  for(const type of ['ticket','installation','routine']) {
    await evaluate(`window.existingSignature='${type}/historical-signature.png'`);
    await evaluate(`closeWithoutSignature('${type}')`);
    assert.equal(await evaluate('savedClosures.at(-1).signature_path'),type+'/historical-signature.png');checks++;
  }
  const count=await evaluate('savedClosures.length');
  await evaluate('window.closureFail=true');
  assert.equal(await evaluate('closeWithoutSignature("ticket").then(()=>false,()=>true)'),true);checks++;
  assert.equal(await evaluate('savedClosures.length'),count);checks++;
  await evaluate('setCase("ticket","00000000-0000-0000-0000-000000000003","ADMIN")');
  await wait('!document.querySelector("section")');checks++;
  assert.equal(await evaluate('calls.some(c=>c.table==="adjust_work_order_points")'),false);checks++;
  await evaluate('window.finalOrder=true');
  for(const type of ['ticket','installation','routine']) {
    const before=await evaluate('calls.filter(c=>["PATCH","DELETE"].includes(c.method)).length');
    for(const action of ['reopen','delete']) {
      assert.equal(await evaluate(`tryOrdinaryMutation('${type}','${action}').then(()=>false,e=>e.message.includes('Cierre administrativo definitivo'))`),true);checks++;
    }
    assert.equal(await evaluate('calls.filter(c=>["PATCH","DELETE"].includes(c.method)).length'),before);checks++;
    const saved=await evaluate('savedClosures.length');
    assert.equal(await evaluate(`closeWithoutSignature('${type}').then(()=>false,e=>e.message.includes('Cierre administrativo definitivo'))`),true);checks++;
    assert.equal(await evaluate('savedClosures.length'),saved);checks++;
  }
  await evaluate('dispose()');
  assert.ok(await evaluate('removed>=4'));checks++;
  assert.deepEqual(errors,[]);checks++;
  console.log(`FIELD_ORDER_POINTS_BROWSER_OK: ${checks} checks; synthetic API; no external network; signatureless closure pipeline only`);
  }
} finally {if(ws)ws.close();chrome.kill();await server.close();}
