// Synthetic browser regression. All business requests are intercepted; only
// static GETs reach --base. No production inventory/custody writes are possible.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const base=arg('--base','http://127.0.0.1:5197'),expected=arg('--expected','returns');
assert.ok(['returns','readonly'].includes(expected));
const profile=await mkdtemp(path.join(tmpdir(),'rayco-custody-returns-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws,seq=0;const pending=new Map(),errors=[];
try {
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Chrome timeout')),20000);chrome.stderr.on('data',b=>{log+=b;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});chrome.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('CDP timeout '+method)),30000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),c=(m,p={})=>send(m,p,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Network.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 ws.addEventListener('message',async e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;const u=new URL(request.url);const staticRead=u.origin===base&&['GET','HEAD'].includes(request.method)&&!u.pathname.startsWith('/api/');await c(staticRead?'Fetch.continueRequest':'Fetch.failRequest',staticRead?{requestId}:{requestId,errorReason:'BlockedByClient'});}});
 await c('Page.addScriptToEvaluateOnNewDocument',{source:String.raw`
  const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',unit='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',product='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  window.fixtureCalls=[];window.forbiddenCalls=[];window.fixtureCustody={units:[{id:unit,product:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'Equipo LAB'},serial_number:'SERIE-FICTICIA',mac_address:'00:00:00:00:00:01',status:'with_technician'}],materials:[{product:{id:product,name:'Material LAB',unit:'m'},quantity:10}],pendingReturnRequests:[]};
  const user={id:actor,email:'technician@example.invalid',role:'authenticated',aud:'authenticated',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:'2026-10-26T00:00:00Z'};
  const enc=o=>btoa(JSON.stringify(o)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:actor,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),iss:'https://mzupdnjegfwmpajywckd.supabase.co/auth/v1'})+'.synthetic';
  localStorage.setItem('sb-mzupdnjegfwmpajywckd-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));
  const person={id:actor,full_name:'Técnico ficticio',role:'TECNICO_RED',active:true,must_change_password:false,email:user.email};const real=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.href),method=init.method||(typeof input==='string'?'GET':input.method),headers=new Headers(init.headers),body=init.body?JSON.parse(init.body):null;
   if(u.origin===location.origin&&!u.pathname.startsWith('/api/'))return real(input,init);
   const name=u.pathname.split('/').at(-1);fixtureCalls.push({name,method,body});const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json','content-range':'0-0/1'}});
   if(u.pathname.startsWith('/auth/v1/'))return json(u.pathname.endsWith('/user')?user:{access_token:token,refresh_token:'synthetic',user});
   if(u.pathname.includes('/rpc/')){
    if(name==='my_inventory_custody')return json(fixtureCustody);
    if(name==='request_unit_return'){if(body.p_unit_id!==unit)throw Error('Wrong synthetic unit');fixtureCustody.units[0].status='pending_return';return json(null);}
    if(name==='request_material_return'){if(body.p_product_id!==product||body.p_quantity!==4)throw Error('Wrong synthetic partial return');fixtureCustody.pendingReturnRequests.push({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',product:{id:product,name:'Material LAB'},quantity:4,status:'pending',requested_at:'2026-10-26T00:00:00Z'});return json('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');}
    if(/receive|confirm|deliver|adjust|inventory_operation/i.test(name)){forbiddenCalls.push(name);throw Error('Administrative/stock mutation forbidden');}return json([]);
   }
   if(!['GET','HEAD'].includes(method)){forbiddenCalls.push(name);throw Error('Direct write forbidden');}
   if(u.pathname.startsWith('/api/'))return json({items:[],data:[]});
   return json(name==='profiles'?((headers.get('accept')||'').includes('vnd.pgrst.object')?person:[person]):[]);
  };
  class FakeSocket extends EventTarget {constructor(){super();this.readyState=1;}send(){}close(){this.readyState=3;}}window.WebSocket=FakeSocket;
 `});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Screen timeout: '+await evaluate('document.body.innerText.slice(0,700)'));};
 await c('Page.navigate',{url:base+'/campo/mi-custodia'});await wait('document.body.innerText.includes("Material LAB") && document.body.innerText.includes("SERIE-FICTICIA")');
 const before=await evaluate('[...document.querySelectorAll("button")].filter(b=>b.textContent.includes("Solicitar devolución")).length');
 if(expected==='readonly'){assert.equal(before,0);assert.equal(await evaluate('document.body.innerText.includes("Solo consulta")'),true);}
 else {
  assert.equal(before,2);
  await evaluate('[...document.querySelectorAll("button")].filter(b=>b.textContent.includes("Solicitar devolución"))[0].click()');
  await evaluate('(()=>{const e=document.querySelector("textarea");e.value="Equipo sin usar";e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Confirmar solicitud de devolución")).click()');
  await wait('document.body.innerText.includes("Devolución en espera de recepción")');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Solicitar devolución")).click()');
  await evaluate('(()=>{const e=document.querySelector("input[type=number]");e.value="4";e.dispatchEvent(new Event("input",{bubbles:true}));const t=document.querySelector("textarea");t.value="Sobrante parcial";t.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Confirmar solicitud de devolución")).click()');
  await wait('document.body.innerText.includes("Pendiente de recepción administrativa")');
  assert.equal(await evaluate('window.fixtureCustody.materials[0].quantity'),10);
  assert.equal(await evaluate('window.fixtureCalls.filter(c=>c.name==="request_unit_return").length'),1);
  assert.equal(await evaluate('window.fixtureCalls.filter(c=>c.name==="request_material_return").length'),1);
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Solicitar devolución"))?.disabled'),true);
 }
 assert.equal(await evaluate('window.forbiddenCalls.length'),0);assert.deepEqual(errors,[]);
 const result={passed:true,base,expected,returnButtonsInitially:before,unitAndPartialMaterialRequest:expected==='returns',noAdministrativeApproval:true,noRealDataOrWrites:true,exceptions:0,at:new Date().toISOString()};
 fs.writeFileSync('scripts/inventory-auth-lab/runtime/campo-returns-browser-'+expected+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{ws?.close();chrome.kill();}
