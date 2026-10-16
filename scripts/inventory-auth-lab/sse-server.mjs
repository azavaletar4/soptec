// PROTOTIPO DE LABORATORIO. No importar desde la aplicación ni desplegar.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {config,runtime,gateway} from './common.mjs';
import {LabPgSession} from './sse-pg-session.mjs';
config();
if(process.env.LAB_SSE_ENABLE!=='1')throw Error('SSE experimental requiere activación explícita local');
const f=JSON.parse(readFileSync(runtime+'sse-fixture.json','utf8'));
const jwks=createRemoteJWKSet(new URL(gateway+'/auth/v1/.well-known/jwks.json'));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clients=new Set();let fault=null,stopping=false,polling=false;
const audit=data=>appendFileSync(runtime+'sse-audit.jsonl',JSON.stringify({at:Date.now(),...data})+'\n');
const auth=async token=>{
 const {payload,protectedHeader}=await jwtVerify(token,jwks,{issuer:gateway+'/auth/v1',audience:'authenticated',algorithms:['ES256']});
 if(protectedHeader.alg!=='ES256'||payload.role!=='authenticated'||!uuid.test(payload.sub??''))throw Error('JWT no autorizado');
 return payload;
};
const answer=(res,status,message)=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:message}));}else res.destroy();};
async function sendOne(c){
 if(c.busy||c.closed)return;
 c.busy=true;
 const close=()=>{if(c.closed)return;c.closed=true;clients.delete(c);clearTimeout(c.expiry);c.db.close();if(!c.res.writableEnded)c.res.destroy();};
 c.close=close;
 try{
  const claims=await auth(c.token);if(claims.sub!==c.actor)throw Error('Cambio de identidad');
  if(c.res.destroyed||c.res.writableNeedDrain||c.res.writableLength>0)throw Error('Salida ocupada');
  const data=JSON.parse(await c.db.run(`begin;set local statement_timeout='250ms';select lab_sse.guard('${c.actor}','${c.type}','${c.id}')`));
  if(data.revision<=c.last){await c.db.run('commit');return;}
  audit({phase:'authorized',actor:c.actor,type:c.type,job:c.id,revision:data.revision,pid:data.pid});
  if(process.env.LAB_SSE_TEST_FAULTS==='1'&&fault?.actor===c.actor&&fault?.job===c.id){
   fault=null;
   writeFileSync(runtime+'sse-fault-checkpoint.json',JSON.stringify({pid:data.pid,actor:c.actor,job:c.id,at:Date.now()}));
   // Simula pausa del proceso/GC: los eventos de error SQL no pueden ejecutarse.
   // Solo en el experimento de seguridad, nunca habilitado por defecto.
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1800);
  }
  if(!c.db.healthy||c.closed||c.res.destroyed||Date.now()>=claims.exp*1000)throw Error('Sesión terminada');
  if(!c.res.headersSent){
   c.res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Access-Control-Allow-Origin':'http://127.0.0.1:54384'});
   c.res.flushHeaders();
  }
  const accepted=c.res.write(`id: ${data.revision}\nevent: invalidate\ndata: {"v":1}\n\n`);
  audit({phase:'enqueued',actor:c.actor,type:c.type,job:c.id,revision:data.revision,pid:data.pid,
   afterFaultRevocation:existsSync(runtime+'sse-fault-revoked.json')});
  c.last=data.revision;
  // Liberar inmediatamente después de write, sin esperar drain/red/cliente.
  await c.db.run('commit');
  audit({phase:'committed',actor:c.actor,type:c.type,job:c.id,revision:data.revision});
  if(!accepted)close();
 }catch{
  answer(c.res,403,'La orden ya no está autorizada o existe otra operación en curso. Vuelve a conectar.');
  close();
 }finally{c.busy=false;}
}
const control=new LabPgSession();
const pollDb=new LabPgSession();
const server=createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://127.0.0.1:54387');
  if(u.pathname==='/health'&&req.method==='GET'){res.end('LAB_SSE_ONLY');return;}
  if(u.search){answer(res,400,'No se admiten credenciales ni parámetros en la URL');return;}
  const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
  let claims;try{claims=await auth(token);}catch{answer(res,401,'Sesión inválida o vencida');return;}
  const match=/^\/events\/(installation|ticket)\/([0-9a-f-]{36})$/.exec(u.pathname);
  if(match&&req.method==='GET'){
   const [,type,id]=match;
   if(!uuid.test(id)||!f.jobs.some(j=>j.type===type&&j.id===id)){answer(res,403,'Orden no autorizada');return;}
   if(clients.size>=16||[...clients].filter(c=>c.actor===claims.sub).length>=4){answer(res,429,'Demasiadas conexiones');return;}
   const db=new LabPgSession();
   const c={id,type,actor:claims.sub,token,db,res,last:-1,busy:false,closed:false,expiry:null};
   // El timeout evita mantener locks indefinidamente si el proceso queda detenido.
   await db.run("set idle_in_transaction_session_timeout='500ms'");
   db.onFailure=()=>{if(res.headersSent)c.close?.();};
   clients.add(c);
   res.on('close',()=>c.close?.());
   c.expiry=setTimeout(()=>c.close?.(),Math.max(1,claims.exp*1000-Date.now()));
   await sendOne(c);return;
  }
  if(req.method==='POST'&&['/emit','/arm-fault'].includes(u.pathname)){
   if(control.pending){answer(res,429,'Control ocupado');return;}
   const allowed=await control.run(`select lab_sse.is_admin('${claims.sub}')`);
   if(allowed!=='t'){answer(res,403,'Solo ADMIN ficticio');return;}
   let raw='';for await(const part of req){raw+=part;if(raw.length>2048)throw Error('Solicitud demasiado grande');}
   const b=JSON.parse(raw);
   const job=f.jobs.find(j=>j.type===b.type&&j.id===b.job);
   if(!job){answer(res,403,'Orden fuera de fixture');return;}
   if(u.pathname==='/arm-fault'){
    if(process.env.LAB_SSE_TEST_FAULTS!=='1'||!uuid.test(b.actor??'')){answer(res,403,'Control no habilitado');return;}
    fault={actor:b.actor,job:job.id};res.end('{}');return;
   }
   const revision=await control.run(`select lab_sse.bump('${claims.sub}','${job.type}','${job.id}')`);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({revision:Number(revision)}));return;
  }
  answer(res,404,'Ruta de laboratorio no disponible');
 }catch{answer(res,503,'Laboratorio ocupado o no disponible');}
});
const poll=setInterval(async()=>{
 if(polling||stopping)return;polling=true;
 try{
  const rows=JSON.parse(await pollDb.run('select lab_sse.revisions()'));
  for(const c of clients){const row=rows.find(r=>r.type===c.type&&r.id===c.id);if(row&&row.revision>c.last)void sendOne(c);}
 }catch{for(const c of clients)c.close?.();}
 finally{polling=false;}
},250);
server.listen(54387,'127.0.0.1',()=>console.log('LAB_SSE_READY 127.0.0.1:54387; sin aplicación, Cloud ni schedulers'));
const stop=()=>{if(stopping)return;stopping=true;clearInterval(poll);for(const c of clients)c.close?.();control.close();pollDb.close();server.close(()=>process.exit(0));};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
