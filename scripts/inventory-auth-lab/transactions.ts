import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { jwtVerify,createRemoteJWKSet } from 'jose';
import { config,runtime,root,sql,gateway } from './common.mjs';
import { executeFieldInventory,pendingFieldInventory } from '../../src/lib/fieldInventoryOperation.ts';

const c=config(),f=JSON.parse(readFileSync(runtime+'transactions.json','utf8')),base=JSON.parse(readFileSync(runtime+'manifest.json','utf8'));
const admin=JSON.parse(readFileSync(runtime+'transactions-admin.json','utf8'));
const reportPath=root+'docs/INVENTARIO-LAB-TRANSACCIONES-RESULTADOS.json';
const results:any[]=[],tokens:Record<string,string>={},intents:any[]=[];
const journal=runtime+'transaction-intents.json';
if(existsSync(journal))throw Error('Hay un ensayo anterior: conservarlo y revisarlo antes de repetir escrituras.');
const save=()=>writeFileSync(reportPath,JSON.stringify({at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_ONLY',status:'IN_PROGRESS',results},null,2)+'\n');
const pass=(test:string,detail:string)=>{results.push({test,status:'PASS',detail});save();console.log('PASS '+test);};
const rpc=async(role:string,job:any,action:string,payload:object,op=randomUUID())=>{
 const request={p_operation_id:op,p_job_type:job.type,p_job_id:job.id,p_action:action,p_payload:payload};
 intents.push({role,...request});writeFileSync(journal,JSON.stringify(intents));
 return invoke(role,request);
};
async function invoke(role:string,request:object,drop=false,name='campo_inventory_operation'){
 const response=await fetch(gateway+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:c.anonKey,Authorization:'Bearer '+tokens[role],'Content-Type':'application/json',...(drop?{'x-lab-drop-response':'1'}:{})},body:JSON.stringify(request)});
 const body=await response.json();return {status:response.status,body};
}
const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(Object.keys(r.body).sort(),['action','at','ids','jobId','jobType','operationId']);return r.body;};
const denied=(r:any,code='42501')=>{assert(r.status>=400&&r.status<500,JSON.stringify(r));assert.equal(r.body.code,code);assert(!r.body.ids);};
const state=()=>JSON.parse(sql(`select jsonb_build_object('stock',(select current_stock from inventory_products where id='${f.material}'),'movements',(select count(*) from inventory_movements where product_id='${f.material}'),'events',(select count(*) from inventory_unit_events where unit_id in (${f.units.map((u:any)=>`'${u.id}'`).join(',')})),'receipts',(select count(*) from campo_inventory_operations))`));
const snapshot=()=>sql(`select jsonb_build_object('movements',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_movements x),'events',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_unit_events x),'units',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_units x),'products',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_products x),'receipts',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from campo_inventory_operations x))`);
const stock=(expected:number)=>assert.equal(state().stock,expected,'STOCK INCORRECTO: detener');
const unitState=(index:number)=>sql(`select status from inventory_units where id='${f.units[index].id}'`);
const untilHold=async()=>{for(let n=0;n<50;n++){if(sql("select count(*) from pg_stat_activity where query like '%lab_authorization_hold%' and wait_event='PgSleep'")==='1')return;await new Promise(r=>setTimeout(r,25));}throw Error('No se observó barrera concurrente');};
const [alta,averia,reassigned,closed]=f.jobs;
class FileStorage {
 path=runtime+'transaction-pending.json';
 get(){return existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):{};}
 getItem(key:string){return this.get()[key]??null;}
 setItem(key:string,value:string){writeFileSync(this.path,JSON.stringify({...this.get(),[key]:value}));}
 removeItem(key:string){const x=this.get();delete x[key];writeFileSync(this.path,JSON.stringify(x));}
}
try{
 assert.equal((await fetch(gateway+'/lab/config').then(r=>r.json())).transactionMode,true);
 assert.equal(sql('select current_database()'),'inventory_lab');stock(20);
 const jwks=createRemoteJWKSet(new URL(gateway+'/auth/v1/.well-known/jwks.json'));
 for(const a of [...c.accounts,{...admin,role:'admin'}]){
  const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.signInWithPassword({email:a.email,password:a.password});assert(!error,error?.message);assert(data.session);
  tokens[a.role]=data.session.access_token;
  const verified=await jwtVerify(tokens[a.role],jwks,{issuer:gateway+'/auth/v1',audience:'authenticated'});
  assert.equal(verified.payload.sub,a.role==='admin'?admin.id:base.users[a.role]);
 }
 pass('Cinco sesiones Auth reales locales','Líder, apoyo, ajeno, retirado y ADMIN ficticio; JWT verificados, sin service_role para operar.');
 for(const job of [alta,averia]){
  const a=ok(await rpc('leader',job,'consume',{productId:f.material,quantity:3}));stock(17);
  const b=ok(await rpc('support',job,'correct',{movementId:a.ids[0],quantity:1}));assert.equal(b.ids.length,2);stock(19);
  ok(await rpc('support',job,'reverse',{movementId:b.ids[1]}));stock(20);
  assert.equal(sql(`select count(*) from inventory_movements where reverses_movement_id='${a.ids[0]}'`),'1');
  pass(`Consumo/corrección/reversión ${job.type}`,'JWT líder/apoyo; stock 20→17→19→20; filas históricas y enlace de reversión conservados.');
 }
 ok(await rpc('leader',alta,'assign',{unitId:f.units[0].id}));assert.equal(unitState(0),'assigned');
 ok(await rpc('support',alta,'unassign',{unitId:f.units[0].id}));assert.equal(unitState(0),'in_stock');
 ok(await rpc('support',averia,'stage',{unitId:f.units[1].id}));assert.equal(unitState(1),'pending_approval');
 ok(await rpc('leader',averia,'unlink',{unitId:f.units[1].id}));assert.equal(unitState(1),'in_stock');
 ok(await rpc('support',averia,'return',{unitId:f.units[2].id,condition:'damaged'}));assert.equal(unitState(2),'damaged');
 pass('Equipos Alta y Avería','Asignar/retirar Alta; entrante Avería pendiente/desvincular; salida de equipo asignado a damaged.');
 const beforeDenied=snapshot();
 for(const role of ['outsider','removed'])for(const job of [alta,averia]){
  denied(await rpc(role,job,'consume',{productId:f.material,quantity:1}));
  denied(await rpc(role,job,'correct',{movementId:randomUUID(),quantity:1}));
  denied(await rpc(role,job,job.type==='installation'?'assign':'stage',{unitId:f.units[0].id}));
  denied(await rpc(role,job,job.type==='installation'?'unassign':'return',{unitId:f.units[0].id,...(job.type==='ticket'?{condition:'in_stock'}:{})}));
 }
 assert.equal(snapshot(),beforeDenied);pass('16 denegaciones de ajeno/retirado','42501 en materiales y equipos para ambas órdenes; cero cambios de inventario/recibos.');
 const first=ok(await rpc('leader',averia,'consume',{productId:f.material,quantity:2}));stock(18);
 const beforeFailure=snapshot();const fail=await rpc('support',averia,'correct',{movementId:first.ids[0],quantity:21});denied(fail,'P0001');assert.match(fail.body.message,/Stock insuficiente/);assert.equal(snapshot(),beforeFailure);
 ok(await rpc('support',averia,'reverse',{movementId:first.ids[0]}));stock(20);pass('Stock insuficiente / corrección atómica','Error español; ni reversión parcial ni recibo; stock/historial idénticos al estado anterior al fallo.');
 const context={jobType:alta.type,jobId:alta.id,actorId:base.users.leader,clientId:f.client,contractId:alta.contractId};
 const payload={productId:f.material,quantity:2},storage=new FileStorage(),prior=state();
 const helperInvoke=async(request:any,drop=false)=>{const r=await invoke('leader',request,drop);return r.status===200?{data:r.body,error:null}:{data:null,error:{code:r.body.code,message:r.body.message}};};
 await assert.rejects(executeFieldInventory(storage,context,'consume',payload,r=>helperInvoke(r,true)),/Respuesta de prueba no entregada/);
 const pending=pendingFieldInventory(new FileStorage(),context)!;assert(pending);stock(18);assert.equal(state().movements,prior.movements+1);
 const recovered=await executeFieldInventory(new FileStorage(),context,'consume',payload,r=>helperInvoke(r));assert.equal(recovered.operationId,pending.p_operation_id);stock(18);assert.equal(state().movements,prior.movements+1);assert.equal(state().receipts,prior.receipts+1);
 ok(await rpc('support',alta,'reverse',{movementId:recovered.ids[0]}));stock(20);pass('Respuesta perdida real tras commit / helper persistente','Gateway descarta respuesta después de REST 200; reintento con UUID persistida recupera un recibo, un consumo.');
 const sameOp=randomUUID(),priorSame=state();const pair=await Promise.all([rpc('leader',alta,'consume',{productId:f.material,quantity:3},sameOp),rpc('leader',alta,'consume',{productId:f.material,quantity:3},sameOp)]);assert.deepEqual(ok(pair[0]),ok(pair[1]));stock(17);assert.equal(state().movements,priorSame.movements+1);
 ok(await rpc('support',alta,'reverse',{movementId:pair[0].body.ids[0]}));stock(20);pass('Dos peticiones simultáneas de la misma intención','Respuestas idénticas, una fila y un efecto en stock.');
 const competing=await Promise.all([rpc('leader',alta,'consume',{productId:f.material,quantity:12}),rpc('support',alta,'consume',{productId:f.material,quantity:12})]);assert.equal(competing.filter(r=>r.status===200).length,1);denied(competing.find(r=>r.status!==200),'P0001');stock(8);
 const consumed=ok(competing.find(r=>r.status===200));const reversing=await Promise.all([rpc('leader',alta,'reverse',{movementId:consumed.ids[0]}),rpc('support',alta,'reverse',{movementId:consumed.ids[0]})]);assert.equal(reversing.filter(r=>r.status===200).length,1);denied(reversing.find(r=>r.status!==200),'22023');stock(20);assert.equal(sql(`select count(*) from inventory_movements where reverses_movement_id='${consumed.ids[0]}'`),'1');
 pass('Dos técnicos compiten por stock y reversión','Solo un consumo de 12 y una reversión; segundo consumo sin stock, segunda reversión rechazada.');
 const unitsBefore=state().events;const equipment=await Promise.all([rpc('leader',alta,'assign',{unitId:f.units[0].id}),rpc('support',alta,'assign',{unitId:f.units[0].id})]);assert.equal(equipment.filter(r=>r.status===200).length,1);denied(equipment.find(r=>r.status!==200));assert.equal(state().events,unitsBefore+1);ok(await rpc('support',alta,'unassign',{unitId:f.units[0].id}));pass('Dos técnicos compiten por equipo','Una sola asignación; retiro posterior legítimo; sin evento duplicado.');
 const priorRequest=randomUUID(),pre=ok(await rpc('leader',reassigned,'consume',{productId:f.material,quantity:1},priorRequest));stock(19);
 for(const [job,action] of [[reassigned,'reassign'],[closed,'close']] as const){
  const before=snapshot();const control=invoke('admin',{p_job_id:job.id,p_action:action},false,'lab_authorization_hold');await untilHold();
  const movement=rpc('leader',job,'consume',{productId:f.material,quantity:1});const [a,b]=await Promise.all([control,movement]);assert.equal(a.status,200,JSON.stringify(a.body));denied(b);assert.equal(snapshot(),before);
  pass(`Concurrencia JWT ADMIN ${action}`,'Protección real retiene padre; movimiento espera y luego 42501, sin escritura posterior a cierre/reasignación.');
 }
 const afterReassign=snapshot();denied(await rpc('leader',reassigned,'consume',{productId:f.material,quantity:1},priorRequest));assert.equal(snapshot(),afterReassign);
 ok(await rpc('outsider',reassigned,'reverse',{movementId:pre.ids[0]}));stock(20);pass('Recibo previo no autoriza al revocado','Mismo UUID tras reasignación denegado; nuevo técnico autorizado puede revertir el consumo original de la orden.');
 const baseline=JSON.parse(readFileSync(runtime+'transactions-baseline.json','utf8'));
 for(const [key,table] of Object.entries({products:'inventory_products',units:'inventory_units',movements:'inventory_movements',events:'inventory_unit_events'})){
  const old=baseline[key]??[];const current=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from ${table} t where id in (${old.map((x:any)=>`'${x.id}'`).join(',')||'null'})`));
  assert.deepEqual(current,old.sort((a:any,b:any)=>a.id.localeCompare(b.id)),'Se alteraron datos previos del laboratorio: detener');
 }
 assert.equal(sql(`select count(*) from(select reverses_movement_id from inventory_movements where product_id='${f.material}' and reverses_movement_id is not null group by reverses_movement_id having count(*)>1)x`),'0');
 pass('Datos previos conservados / auditoría final','Mismas filas previas; stock transaccional final 20; ninguna doble reversión.');
 writeFileSync(reportPath,JSON.stringify({at:new Date().toISOString(),status:'PASS',environment:'LOCAL_SYNTHETIC_ONLY',results,finalState:state(),productionAccess:false},null,2)+'\n');
 console.log('TRANSACTION_LAB_PASS '+results.length+' grupos de comprobaciones.');
}catch(error){
 writeFileSync(reportPath,JSON.stringify({at:new Date().toISOString(),status:'BLOCKED_STOPPED',environment:'LOCAL_SYNTHETIC_ONLY',results,error:error instanceof Error?error.message:String(error)},null,2)+'\n');
 console.error('BLOQUEADO: detener y conservar el laboratorio para revisión.');throw error;
}
