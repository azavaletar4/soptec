// Only loopback Vite. Every external request is blocked; API responses synthetic.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL='https://field-address.invalid';
process.env.VITE_SUPABASE_ANON_KEY='synthetic';
const server=await createServer({server:{host:'127.0.0.1',port:0,strictPort:false}});
await server.listen();
const base=server.resolvedUrls.local[0];
const profile=await mkdtemp(join(tmpdir(),'rayco-field-address-'));
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
  const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=async expression=>{for(let n=0;n<200;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+expression);};
  await c('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await mkdir('.env.a3-recovery/field-address-captures',{recursive:true});
  for(const type of ['installation','ticket','routine']) {
    for(const scenario of ['second','third','fallback','no-gps','missing','wrong-client','failed','no-contract','delayed']) {
      await c('Page.navigate',{url:base+`scripts/tests/field-address-browser.html?type=${type}&case=${scenario}`});
      await wait('window.__ready && !!document.querySelector("[data-field-order-location]")');
      if(scenario==='delayed') {
        await wait('!!window.__release');
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("a")).filter(a=>a.href.includes("google.com/maps")||a.href.includes("waze.com")).map(a=>a.href)'),[]);checks++;
        await evaluate('window.__release()');
      }
      await wait('!document.body.innerText.includes("Cargando ficha del cliente")');
      const text=await evaluate('document.querySelector("[data-field-order-location]").innerText');
      const links=await evaluate('Array.from(document.querySelectorAll("a")).filter(a=>a.href.includes("google.com/maps")||a.href.includes("waze.com")).map(a=>a.href)');
      if(['missing','wrong-client','failed'].includes(scenario)) {
        assert.ok(text.includes('No se pudo verificar'));checks++;
        assert.equal(links.length,0);checks++;
        assert.equal(text.includes('Primer domicilio'),false);checks++;
        assert.equal(text.includes('CTR-TEST-001'),false);checks++;
      } else if(scenario==='no-contract') {
        const old={installation:'Domicilio general ficticio',ticket:'',routine:'Destino original de rutina'}[type];
        assert.equal(text,old);checks++;
        assert.ok(links.some(href=>href.includes('destination=-12,-77')));checks++;
      } else {
        const third=scenario==='third';
        assert.ok(text.includes(third?'CTR-TEST-003':'CTR-TEST-002'));checks++;
        assert.ok(text.includes(scenario==='fallback'?'Domicilio general ficticio':third?'Tercer domicilio ficticio':'Segundo domicilio ficticio'));checks++;
        assert.ok(text.includes(scenario==='fallback'?'Dirección general del cliente':'Dirección del contrato seleccionado'));checks++;
        assert.equal(text.includes('Primer domicilio'),false);checks++;
        if(scenario==='no-gps') {assert.equal(links.length,0);assert.ok(text.includes('Sin GPS completo'));checks+=2;}
        else {
          const coords=third?'-12.2,-77.2':'-12.1,-77.1';
          assert.ok(links.some(href=>href.includes('destination='+coords)));checks++;
          assert.ok(links.some(href=>href.includes('waze.com/ul?ll='+coords)));checks++;
          assert.equal(links.some(href=>href.includes('-11,-76')),false);checks++;
        }
      }
      const calls=await evaluate('window.__calls');
      assert.ok(calls.some(c=>c.path.endsWith('/service_contracts')&&new URLSearchParams(c.query).get('client_id')==='eq.00000000-0000-4000-8000-000000000003'));checks++;
      assert.deepEqual(await evaluate('window.__writes'),[]);checks++;
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Sin desborde móvil');checks++;
      if(['third','fallback'].includes(scenario)) {
        const png=await c('Page.captureScreenshot',{format:'png'});
        await writeFile(`.env.a3-recovery/field-address-captures/${type}-${scenario}.png`,Buffer.from(png.data,'base64'));
      }
      await evaluate('window.__unmount()');
    }
  }
  assert.deepEqual(errors,[]);checks++;
  console.log(`FIELD_ADDRESS_BROWSER_OK: ${checks} checks; 27 scenarios; mobile 390x844; no writes; external network blocked`);
} finally {if(ws)ws.close();chrome.kill();await server.close();}
