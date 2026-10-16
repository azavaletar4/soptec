// Ensayo real del transporte nuevo; no repite suites transaccionales anteriores.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {config,sql,runtime,root,gateway,wait} from './common.mjs';
const c=config(),f=JSON.parse(readFileSync(runtime+'sse-fixture.json','utf8'));
if(existsSync(runtime+'sse-validation-started.json')){
 if(!process.argv.includes('--resume-handshake'))throw Error('Ensayo SSE ya iniciado; conservar journal y no repetir automáticamente');
 const prior=JSON.parse(readFileSync(root+'docs/INVENTARIO-LAB-SSE-RESULTADOS.json','utf8'));
 assert.equal(prior.status,'INCOMPLETE');assert.equal(prior.error,'fetch failed');assert.equal(prior.results.length,0);
 assert(!existsSync(runtime+'sse-fault-checkpoint.json'));
 assert.equal(sql('select max(revision) from lab_sse.scopes'),'0');
 for(const job of f.jobs)assert.equal(sql(`select count(*) from job_assignees where job_type='${job.type}' and job_id='${job.id}'`),'3');
 writeFileSync(runtime+'sse-handshake-attempt.json',JSON.stringify(prior,null,2));
}
writeFileSync(runtime+'sse-validation-started.json',JSON.stringify({at:new Date().toISOString()}));
const report={at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',authentication:'REAL_GOTRUE_ES256',status:'INCOMPLETE',results:[],productionAccess:false};
const save=()=>writeFileSync(root+'docs/INVENTARIO-LAB-SSE-RESULTADOS.json',JSON.stringify(report,null,2)+'\n');
const record=(test,status,detail)=>{report.results.push({test,status,detail});console.log(status+' '+test);save();};
const tokens={},streams=[];
const audit=()=>existsSync(runtime+'sse-audit.jsonl')?readFileSync(runtime+'sse-audit.jsonl','utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const pauses=ms=>new Promise(r=>setTimeout(r,ms));
const login=async account=>{
 const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await auth.auth.signInWithPassword({email:account.email,password:account.password});
 assert(!error,error?.message);return data.session.access_token;
};
let worker;
async function open(role,job){
 const abort=new AbortController();
 const response=await fetch(`http://127.0.0.1:54387/events/${job.type}/${job.id}`,{headers:{Authorization:'Bearer '+tokens[role]},signal:abort.signal});
 const s={role,job,status:response.status,events:[],closed:false,abort};streams.push(s);
 if(!response.ok){assert.deepEqual(Object.keys(await response.json()),['error']);s.closed=true;return s;}
 assert.match(response.headers.get('Content-Type'),/text\/event-stream/);
 const reader=response.body.getReader();
 s.done=(async()=>{
  let buffer='';const dec=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=dec.decode(value,{stream:true});let pos;
   while((pos=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,pos);buffer=buffer.slice(pos+2);
    const lines=block.split('\n');const payload=JSON.parse(lines.find(l=>l.startsWith('data: ')).slice(6));
    assert.deepEqual(payload,{v:1});assert(lines.includes('event: invalidate'));
    const id=Number(lines.find(l=>l.startsWith('id: ')).slice(4));
    assert(Number.isInteger(id));assert(!s.events.some(e=>e.id===id),'Aviso duplicado');s.events.push({id,payload,at:Date.now()});
   }
  }}catch(e){if(e instanceof assert.AssertionError){report.streamError=e.message;save();}}
  finally{s.closed=true;}
 })();
 return s;
}
const control=async(path,body)=>{
 const r=await fetch('http://127.0.0.1:54387'+path,{method:'POST',headers:{Authorization:'Bearer '+tokens.admin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal(r.status,200,await r.clone().text());return r.json();
};
const emit=job=>control('/emit',{type:job.type,job:job.id});
const crew=async(job,roles)=>{
 const expected=JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('technician_id',technician_id,'role',role) order by technician_id),'[]') from job_assignees where job_type='${job.type}' and job_id='${job.id}'`));
 const r=await fetch('http://127.0.0.1:54383/rpc/set_current_job_crew',{method:'POST',headers:{Authorization:'Bearer '+tokens.admin,apikey:c.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_job_type:job.type,p_job_id:job.id,p_expected:expected,p_members:roles.map(([role,kind])=>({technician_id:f.users[role],role:kind}))})});
 assert(r.ok,'Reasignación ADMIN ficticio rechazada: '+await r.text());
};
const digest=()=>sql(`select jsonb_build_object(
 'products',(select jsonb_agg(to_jsonb(t) order by id) from inventory_products t),
 'units',(select jsonb_agg(to_jsonb(t) order by id) from inventory_units t),
 'movements',(select jsonb_agg(to_jsonb(t) order by id) from inventory_movements t),
 'events',(select jsonb_agg(to_jsonb(t) order by id) from inventory_unit_events t),
 'receipts',(select jsonb_agg(to_jsonb(t) order by id) from campo_inventory_operations t))`);
try{
 assert.equal(digest(),readFileSync(runtime+'sse-baseline.json','utf8').trim());
 for(const a of c.accounts)tokens[a.role]=await login(a);
 tokens.admin=await login(JSON.parse(readFileSync(runtime+'transactions-admin.json','utf8')));
 worker=spawn(process.execPath,['scripts/inventory-auth-lab/sse-server.mjs'],{cwd:root,env:{...process.env,LAB_SSE_ENABLE:'1',LAB_SSE_TEST_FAULTS:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 worker.stdout.on('data',b=>process.stdout.write(b));worker.stderr.on('data',()=>console.log('SSE_WORKER_DIAGNOSTIC: revisar runtime, sin imprimir credenciales'));
 await wait(async()=>{try{return (await fetch('http://127.0.0.1:54387/health')).ok;}catch{return false;}});
 const [alta,ticket]=f.jobs;
 const lead=await open('leader',alta),support=await open('support',alta),removed=await open('removed',alta);
 assert.equal(lead.status,200);assert.equal(support.status,200);assert.equal(removed.status,200);
 assert.equal((await open('outsider',alta)).status,403);
 await wait(()=>[lead,support,removed].every(s=>s.events.length===1));
 record('Autorización SSE real de cuatro roles','PASS','Líder/apoyo/futuro retirado 200; ajeno 403 sin contexto. JWT GoTrue verificados por backend, sin service_role.');
 const revision1=(await emit(alta)).revision;
 await wait(()=>[lead,support,removed].every(s=>s.events.at(-1)?.id===revision1));await pauses(600);
 assert([lead,support,removed].every(s=>s.events.length===2));
 record('Señal mínima y deduplicación por revisión','PASS','Cada conexión recibió una única señal {v:1} por revisión; sin filas de negocio.');
 await crew(alta,[['leader','leader'],['support','support']]);
 const revokedCount=removed.events.length;
 const revision2=(await emit(alta)).revision;
 await wait(()=>lead.events.at(-1)?.id===revision2&&support.events.at(-1)?.id===revision2&&removed.closed);
 assert.equal(removed.events.length,revokedCount);
 record('Retirado con conexión abierta','PASS','RPC de cuadrilla con JWT ADMIN real; tras commit no recibe la nueva revisión y servidor cierra stream.');
 assert.equal((await open('removed',alta)).status,403);
 tokens.removed=await login(c.accounts.find(a=>a.role==='removed'));
 assert.equal((await open('removed',alta)).status,403);
 record('Reconexión del retirado con JWT viejo y nuevo','PASS','Ambas conexiones rechazadas por asignación vigente, sin datos.');
 const ticketLead=await open('leader',ticket),ticketSupport=await open('support',ticket);
 assert.equal(ticketLead.status,200);assert.equal(ticketSupport.status,200);
 assert.equal((await open('outsider',ticket)).status,403);
 record('Cambio de identidad de conexión','PASS','Sesiones SSE distintas no heredan identidad; socket anterior sigue ligado a su JWT. No certifica UI completa de cambio de sesión.');
 await crew(ticket,[['outsider','leader']]);
 const reassigned=(await emit(ticket)).revision;
 await wait(()=>ticketLead.closed&&ticketSupport.closed);
 assert(!ticketLead.events.some(e=>e.id===reassigned));assert(!ticketSupport.events.some(e=>e.id===reassigned));
 const nowAssigned=await open('outsider',ticket);assert.equal(nowAssigned.status,200);
 await wait(()=>nowAssigned.events.at(-1)?.id===reassigned);
 record('Reasignación de Avería con JWT ADMIN real','PASS','Antiguo líder/apoyo dejan de recibir; técnico anteriormente ajeno recibe al estar asignado.');
 const close=await fetch(`http://127.0.0.1:54383/tickets?id=eq.${ticket.id}`,{method:'PATCH',headers:{Authorization:'Bearer '+tokens.admin,apikey:c.anonKey,'Content-Type':'application/json'},body:JSON.stringify({status:'closed'})});
 assert(close.ok,'Cierre ADMIN local rechazado: '+await close.text());
 const closedRevision=(await emit(ticket)).revision;
 await wait(()=>nowAssigned.closed);assert(!nowAssigned.events.some(e=>e.id===closedRevision));
 assert.equal((await open('outsider',ticket)).status,403);
 record('Cierre de orden con conexión abierta','PASS','PATCH con JWT ADMIN real; el técnico ya no recibe señales ni puede reconectar.');
 support.abort.abort();await wait(()=>support.closed);
 const offlineRevision=(await emit(alta)).revision;
 const reconnected=await open('support',alta);assert.equal(reconnected.status,200);
 await wait(()=>reconnected.events.length===1);assert.equal(reconnected.events[0].id,offlineRevision);
 const refresh=await fetch(`${gateway}/api/campo-inventory/${alta.type}/${alta.id}/materials?page=0`,{headers:{Authorization:'Bearer '+tokens.support}});
 assert.equal(refresh.status,200);const data=await refresh.json();assert.equal(data.context.jobId,alta.id);assert.deepEqual(data.items,[]);
 record('Corte temporal y recuperación contextual','PASS','Reconecta en revisión vigente, sin replay duplicado; reconsulta real de su orden sin materiales ajenos.');

 // Punto crítico nuevo: pausa del event loop mientras PostgreSQL vence la
 // transacción para evitar locks indefinidos. Se usa un proceso servidor real.
 await control('/arm-fault',{type:alta.type,job:alta.id,actor:f.users.leader});
 const faultRevision=(await emit(alta)).revision;
 await wait(()=>existsSync(runtime+'sse-fault-checkpoint.json'));
 const checkpoint=JSON.parse(readFileSync(runtime+'sse-fault-checkpoint.json','utf8'));
 assert.equal(checkpoint.actor,f.users.leader);
 await wait(()=>sql(`select count(*) from pg_stat_activity where pid=${Number(checkpoint.pid)}`)==='0');
 // PostgreSQL ya liberó locks, pero el event loop pausado aún no procesó FATAL.
 await crew(alta,[['support','leader']]);
 writeFileSync(runtime+'sse-fault-revoked.json',JSON.stringify({at:Date.now(),job:alta.id,actor:f.users.leader,committed:true,adminJwt:true}));
 await wait(()=>audit().some(a=>a.phase==='enqueued'&&a.actor===f.users.leader&&a.revision===faultRevision)||lead.closed);
 const stale=audit().find(a=>a.phase==='enqueued'&&a.actor===f.users.leader&&a.revision===faultRevision&&a.afterFaultRevocation);
 report.barrierFault={sqlSessionEnded:true,revocationCommitted:true,serverEnqueuedAfterCommit:!!stale,clientObservedFrame:lead.events.some(e=>e.id===faultRevision)};
 if(stale){
  report.status='BLOCKED';record('Pérdida de barrera SQL durante pausa del backend','FAIL','Timeout de sesión SQL libera locks; revocación confirma; proceso reanuda antes de procesar FATAL y encola un aviso posterior al commit. Parada obligatoria.');process.exitCode=2;
 }else{
  report.status='PENDING_ADDITIONAL_VALIDATION';record('Pérdida de barrera SQL durante pausa del backend','PASS','No se observó encolado tardío en este ensayo. Requiere más validación antes de aprobar.');
 }
 assert(!report.streamError,report.streamError);
}catch(e){report.status='INCOMPLETE';report.error=e instanceof Error?e.message:'Error de ensayo';save();throw e;}
finally{
 for(const s of streams)s.abort.abort();
 if(worker){worker.kill('SIGTERM');await Promise.race([new Promise(r=>worker.once('exit',r)),pauses(3000)]);}
 report.inventoryUnchanged=digest()===readFileSync(runtime+'sse-baseline.json','utf8').trim();save();
 assert(report.inventoryUnchanged,'Inventario alterado inesperadamente');
 console.log('SSE_RESULT '+report.status+'; inventario conservado');
}
process.exit(process.exitCode??0);
