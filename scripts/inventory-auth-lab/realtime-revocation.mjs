// Prueba de bloqueo previa a integrar Campo. Solo fixture aditiva y JWT GoTrue.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {RealtimeClient} from '@supabase/realtime-js';
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {config,sql,runtime,gateway,root,wait} from './common.mjs';
const c=config(),m=JSON.parse(readFileSync(runtime+'manifest.json','utf8'));
let resumedJobs,fixtureExists=false;
if(existsSync(runtime+'realtime-probe.json')){
 if(!process.argv.includes('--resume-rolled-back-fixture')&&!process.argv.includes('--resume-channel-initialization'))throw Error('Ensayo ya iniciado: conservar fixture y evidencia, no repetir automáticamente');
 const prior=JSON.parse(readFileSync(root+'docs/INVENTARIO-LAB-REALTIME-RESULTADOS.json','utf8'));
 assert.equal(prior.status,'INCOMPLETE');
 resumedJobs=JSON.parse(readFileSync(runtime+'realtime-probe.json','utf8')).jobs;
 fixtureExists=process.argv.includes('--resume-channel-initialization');
 assert(fixtureExists?prior.error.includes('CHANNEL_ERROR'):prior.error.includes('Este técnico ya tiene un trabajo'));
 for(const j of resumedJobs){assert.equal(sql(`select count(*) from ${j.type==='installation'?'installations':'tickets'} where id='${j.id}'`),fixtureExists?'1':'0');assert.equal(sql(`select count(*) from job_assignees where job_id='${j.id}'`),fixtureExists?'3':'0');}
 writeFileSync(runtime+`realtime-attempt-${Date.now()}.json`,JSON.stringify(prior,null,2));
}
const report={at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',status:'INCOMPLETE',results:[],productionAccess:false};
const save=()=>writeFileSync(root+'docs/INVENTARIO-LAB-REALTIME-RESULTADOS.json',JSON.stringify(report,null,2)+'\n');
const record=(test,status,detail)=>{report.results.push({test,status,detail});console.log(status+' '+test);save();};
const clients=[];
const tokens={},received={},channels={};
const jwks=createRemoteJWKSet(new URL(gateway+'/auth/v1/.well-known/jwks.json'));
const baseline=readFileSync(runtime+'realtime-baseline.json','utf8').trim();
const digest=()=>sql(`select jsonb_object_agg(t,h) from (
 select 'units' t, md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) h from inventory_units u union all
 select 'movements', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from inventory_movements u union all
 select 'products', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from inventory_products u union all
 select 'events', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from inventory_unit_events u union all
 select 'receipts', md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from campo_inventory_operations u) b`);
const join=async(role,job)=>{
 const rt=new RealtimeClient('ws://127.0.0.1:54385/socket',{params:{apikey:c.anonKey},accessToken:async()=>tokens[role]});
 clients.push(rt);
 await rt.setAuth(tokens[role]); // Antes del JOIN: no competir con el bootstrap asíncrono del SDK.
 const key=role+':'+job.type;received[key]=[];
 const ch=rt.channel(`campo-inventory:v1:${job.type}:${job.id}`,{config:{private:true,broadcast:{ack:true}}})
  .on('broadcast',{event:'invalidate'},msg=>{received[key].push(msg.payload);});
 channels[key]=ch;
 const status=await new Promise(resolve=>{
  const timeout=setTimeout(()=>resolve('TIMED_OUT'),15000);
  ch.subscribe((s,error)=>{if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(s)){if(error)console.log('JOIN_STATUS',role,job.type,s,error.message);clearTimeout(timeout);resolve(s);}});
 });
 return status;
};
const emit=async job=>{
 const r=await fetch('http://127.0.0.1:54385/api/broadcast',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.serviceKey,apikey:c.anonKey},body:JSON.stringify({messages:[{topic:`campo-inventory:v1:${job.type}:${job.id}`,event:'invalidate',payload:{v:1},private:true}]})});
 assert(r.ok,'Emisión local rechazó '+r.status);
};
try{
 assert.equal(digest(),baseline,'Inventario cambió desde preparación; detener antes de probar');
 for(const a of c.accounts){
  const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.signInWithPassword({email:a.email,password:a.password});assert(!error,error?.message);
  tokens[a.role]=data.session.access_token;
  const verified=await jwtVerify(tokens[a.role],jwks,{issuer:gateway+'/auth/v1',audience:'authenticated'});
  assert.equal(verified.payload.sub,m.users[a.role]);assert.equal(verified.protectedHeader.alg,'ES256');
  record('JWT real '+a.role,'PASS','GoTrue login, firma ES256 y sub/issuer/aud verificados. Token solo en memoria.');
 }
 const jobs=resumedJobs??m.jobs.slice(0,2).map(j=>({...j,id:randomUUID()}));
 writeFileSync(runtime+'realtime-probe.json',JSON.stringify({at:report.at,jobs,users:m.users},null,2));
 if(!fixtureExists)sql(`begin; ${jobs.map(j=>`insert into ${j.type==='installation'?'installations':'tickets'}(id,status,assigned_to,client_id,contract_id) values('${j.id}','${j.type==='installation'?'scheduled':'open'}','${m.users.leader}','${j.clientId}','${j.contractId}');
 insert into job_assignees(job_type,job_id,technician_id,role) values
 ('${j.type}','${j.id}','${m.users.leader}','leader'),('${j.type}','${j.id}','${m.users.support}','support'),('${j.type}','${j.id}','${m.users.removed}','support');`).join('\n')} commit;`);
 record('Fixture aditiva Alta y Avería','PASS','Solo órdenes nuevas y cuadrillas ficticias; sin movimientos ni equipos nuevos.');
 for(const job of jobs){
  for(const role of ['leader','support','removed'])assert.equal(await join(role,job),'SUBSCRIBED');
  assert.equal(await join('outsider',job),'CHANNEL_ERROR');
  record('JOIN autorizado/ajeno '+job.type,'PASS','Líder/apoyo/futuro retirado aceptados; ajeno rechazado por policy contextual.');
  await emit(job);
  await wait(()=>['leader','support','removed'].every(role=>received[role+':'+job.type].length===1));
  assert.equal(received['outsider:'+job.type].length,0);
  for(const role of ['leader','support','removed'])assert.deepEqual(received[role+':'+job.type],[{v:1}]);
  const r=await fetch(`${gateway}/api/campo-inventory/${job.type}/${job.id}/materials?page=0`,{headers:{Authorization:'Bearer '+tokens.leader}});
  assert.equal(r.status,200);const body=await r.json();assert.equal(body.context.jobId,job.id);assert.deepEqual(body.items,[]);
  record('Aviso mínimo y reconsulta '+job.type,'PASS','Payload exactamente {v:1}; reconsulta contextual real 200, sin filas de otra orden.');
 }
 const job=jobs[0],key='removed:'+job.type;
 const before=received[key].length;
 assert.equal(channels[key].state,'joined');
 sql(`delete from job_assignees where job_type='${job.type}' and job_id='${job.id}' and technician_id='${m.users.removed}'`);
 assert.equal(sql(`select count(*) from job_assignees where job_type='${job.type}' and job_id='${job.id}' and technician_id='${m.users.removed}'`),'0');
 const denied=await fetch(`${gateway}/api/campo-inventory/${job.type}/${job.id}/materials?page=0`,{headers:{Authorization:'Bearer '+tokens.removed}});
 assert.equal(denied.status,403);assert.deepEqual(Object.keys(await denied.json()),['error']);
 record('Retirado: reconsulta mismo JWT','PASS','403 sin datos tras retirar de la orden ficticia; socket permanece abierto.');
 await emit(job);
 await wait(()=>received['leader:'+job.type].length===2&&received['support:'+job.type].length===2);
 await new Promise(r=>setTimeout(r,1200));
 report.revocation={membershipRemoved:true,sameJwt:true,channelState:channels[key].state,before,after:received[key].length,protectedRowsTransmitted:0};
 if(received[key].length>before){
  report.status='BLOCKED';
  record('Revocación de conexión abierta','FAIL','El técnico retirado recibió otro aviso {v:1} tras confirmar DELETE y 403 contextual. Permiso Broadcast cacheado. Parada obligatoria.');
  process.exitCode=2;
 }else{
  report.status='PENDING_ADDITIONAL_VALIDATION';
  record('Revocación de conexión abierta','PASS','No recibió el aviso durante la ventana; no certifica por sí sola revocación completa.');
 }
}catch(e){report.status='INCOMPLETE';report.error=e instanceof Error?e.message:'Error de ensayo';save();throw e;}
finally{
 for(const rt of clients){await rt.removeAllChannels();rt.disconnect();}
 report.inventoryUnchanged=digest()===baseline;save();
 if(!report.inventoryUnchanged)throw Error('Inventario del laboratorio cambió inesperadamente');
 console.log('INVENTORY_UNCHANGED; resultado '+report.status);
}
// Algunos canales rechazados dejan timers de rejoin en el SDK Node: finalizar
// solo después de cerrar todos los sockets, guardar evidencia y auditar hashes.
process.exit(process.exitCode??0);
