import { spawn,execFile } from 'node:child_process';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { root,runtime,sql,project } from './common.mjs';
const f=JSON.parse(await readFile(runtime+'transactions.json','utf8'));
const profile=await mkdtemp(join(tmpdir(),'inventory-tx-real-auth-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;const results=[];
const state=()=>JSON.parse(sql(`select jsonb_build_object('stock',(select current_stock from inventory_products where id='${f.material}'),'movements',(select count(*) from inventory_movements where product_id='${f.material}'),'receipts',(select count(*) from campo_inventory_operations))`));
const pass=test=>{results.push({test,status:'PASS'});console.log('PASS UI '+test);};
try{
 assert.equal(state().stock,20);
 const endpoint=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Chrome timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});});
 ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map(),external=[],exceptions=[];
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails?.text);if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url),allow=u.hostname==='127.0.0.1'&&['54381','54384'].includes(u.port);if(!allow)external.push(u.origin);void send(allow?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(allow?{}:{errorReason:'BlockedByClient'})},m.sessionId);}};
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true}),c=(method,params={})=>send(method,params,sessionId);
 await c('Page.enable');await c('Runtime.enable');await c('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const evaluate=async expression=>{const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{for(let n=0;n<120;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout UI; estado='+await evaluate('document.querySelector("#status")?.textContent'));};
 const change=async(id,value,event='change')=>evaluate(`document.querySelector('#${id}').value=${JSON.stringify(String(value))};document.querySelector('#${id}').dispatchEvent(new Event('${event}',{bubbles:true}))`);
 const click=async id=>evaluate(`document.querySelector('#${id}').click()`);
 const login=async role=>{await change('role',role);await click('login');await until(`document.querySelector('#status').textContent==='Sesión Auth real: ${role}'`);};
 const action=async(kind,qty)=>{await change('tx-action',kind);if(qty!==undefined)await change('tx-quantity',qty,'input');await click('tx-send');};
 const confirmed=()=>until(`document.querySelector('#status').textContent==='Operación confirmada'`);
 await c('Page.navigate',{url:'http://127.0.0.1:54384/'});await until('document.querySelector("#tx-send")');
 for(const [role,index] of [['leader',0],['support',1]]){
  await login(role);await change('tx-job',index);const before=state();
  await action('consume',1);await confirmed();assert.equal(state().stock,19);
  await action('correct',2);await confirmed();assert.equal(state().stock,18);
  await action('reverse');await confirmed();assert.equal(state().stock,20);assert.equal(state().movements,before.movements+4);
  pass(`${role} ${index===0?'Alta':'Avería'} consumo/corrección/reversión`);
 }
 await login('leader');await change('tx-job',0);await change('tx-unit',3);await action('assign');await confirmed();assert.equal(sql(`select status from inventory_units where id='${f.units[3].id}'`),'assigned');await action('unassign');await confirmed();assert.equal(sql(`select status from inventory_units where id='${f.units[3].id}'`),'in_stock');pass('Alta asignación/retiro mediante JWT real');
 await login('support');await change('tx-job',1);await change('tx-unit',4);await action('stage');await confirmed();assert.equal(sql(`select status from inventory_units where id='${f.units[4].id}'`),'pending_approval');await action('unlink');await confirmed();assert.equal(sql(`select status from inventory_units where id='${f.units[4].id}'`),'in_stock');pass('Avería entrante pendiente/desvinculación');
 for(const role of ['outsider','removed'])for(const index of [0,1]){
  await login(role);await change('tx-job',index);const before=state();await action('consume',1);await until(`document.querySelector('#status').textContent.includes('Asignación no vigente')`);assert.deepEqual(state(),before);pass(`${role} ${index===0?'Alta':'Avería'} denegación en español sin cambios`);
 }
 await login('leader');await change('tx-job',0);const beforeLoss=state();await click('tx-drop');await action('consume',1);await until(`document.querySelector('#status').textContent.includes('Respuesta de prueba no entregada')`);assert.equal(state().stock,19);
 const pendingOp=await evaluate(`Object.keys(localStorage).filter(k=>k.startsWith('campo-inventory:v1:')).map(k=>JSON.parse(localStorage.getItem(k))).find(r=>r.p_job_id==='${f.jobs[0].id}')?.p_operation_id`);assert(pendingOp);
 await click('tx-retry');await confirmed();assert.equal(state().stock,19);assert.equal(state().movements,beforeLoss.movements+1);assert.equal(state().receipts,beforeLoss.receipts+1);assert.equal(await evaluate(`JSON.parse(document.querySelector('#tx-receipt').textContent).operationId`),pendingOp);
 await action('reverse');await confirmed();assert.equal(state().stock,20);pass('Respuesta perdida después del commit / reintento UI sin duplicación');
 const beforeLock=state();
 const lock=new Promise(resolve=>{const p=execFile('docker',['exec','-i',project+'-db','psql','-U','postgres','-d','inventory_lab','-X','-q','-v','ON_ERROR_STOP=1'],{encoding:'utf8',windowsHide:true},(error)=>resolve(error));p.stdin.end(`set application_name='lab-ui-row-lock';begin;select technician_id from job_assignees where job_id='${f.jobs[0].id}' and role='leader' for update;select pg_sleep(2);rollback;`);});
 let sleeping=false;for(let n=0;n<40;n++){if(sql("select count(*) from pg_stat_activity where application_name='lab-ui-row-lock' and wait_event='PgSleep'")==='1'){sleeping=true;break;}await new Promise(r=>setTimeout(r,25));}assert(sleeping);
 await action('consume',1);await until(`document.querySelector('#status').textContent.includes('Hay otra operación en curso')`);const message=await evaluate(`document.querySelector('#status').textContent`);assert.match(message,/reintentarlo de forma segura/);assert.doesNotMatch(message,/could not obtain lock|job_assignees/);assert.deepEqual(state(),beforeLock);assert.equal(await lock,null);
 await action('consume',1);await confirmed();assert.equal(state().stock,19);await action('reverse');await confirmed();assert.equal(state().stock,20);pass('55P03 real en español, rollback y nuevo intento seguro');
 assert.equal(external.length,0);assert.equal(exceptions.length,0);assert.equal(state().stock,20);
 await writeFile(root+'docs/INVENTARIO-LAB-TRANSACCIONES-NAVEGADOR.json',JSON.stringify({at:new Date().toISOString(),status:'PASS',results,externalRequests:0,runtimeExceptions:0,finalStock:20,simulatedSessions:false},null,2)+'\n');
 await send('Browser.close');
}catch(error){await writeFile(root+'docs/INVENTARIO-LAB-TRANSACCIONES-NAVEGADOR.json',JSON.stringify({at:new Date().toISOString(),status:'BLOCKED_STOPPED',results,error:error.message},null,2)+'\n');throw error;}finally{ws?.close();chrome.kill();}
