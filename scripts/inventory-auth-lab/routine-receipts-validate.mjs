// Únicamente Auth local y DB ficticia separada. Nunca usa service_role.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {config,root,runtime,project,docker,sql,gateway} from './common.mjs';
const c=config(),f=JSON.parse(readFileSync(runtime+'routine-receipt-prepared.json','utf8'));
assert.equal(f.database,'inventory_routine_receipt_lab');assert.equal(f.url,'http://127.0.0.1:54389');
const reportPath=root+'docs/INVENTARIO-RUTINAS-RECIBOS-RESULTADOS.json';
if(existsSync(runtime+'routine-receipts-started.json'))throw Error('Ensayo existente: conservar evidencia, no repetir escrituras.');
const fixture={routine:randomUUID(),returned:randomUUID(),leaderOp:randomUUID(),removedOp:randomUUID(),supportOp:randomUUID(),returnedOp:randomUUID(),officeOp:randomUUID()};
writeFileSync(runtime+'routine-receipts-started.json',JSON.stringify(fixture));
const report={at:new Date().toISOString(),environment:'LOCAL_SYNTHETIC_SEPARATE_DATABASE',status:'IN_PROGRESS',authentication:'REAL_GOTRUE_ES256_JWT',productionAccess:false,results:[]};
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
const pass=(test,detail)=>{report.results.push({test,status:'PASS',detail});save();console.log('PASS '+test);};
const local=s=>docker(['exec','-i',project+'-db','psql','-U','postgres','-d',f.database,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],s).trim();
const file=p=>readFileSync(root+p,'utf8');
const material='50000000-0000-0000-0000-000000000002';
const tokens={},jwks=createRemoteJWKSet(new URL(gateway+'/auth/v1/.well-known/jwks.json'));
const request=(operation,quantity,routine=fixture.routine)=>({p_routine_id:routine,p_operation_id:operation,p_action:'consume',p_payload:{product_id:material,quantity}});
async function call(role,body){const r=await fetch(f.url+'/rpc/routine_inventory_operation',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r));assert(r.body.operation_id);return r.body;};
const deny=r=>{assert(r.status>=400&&r.status<500,JSON.stringify(r));assert(!r.body.operation_id&&!r.body.movement_or_event_id&&!r.body.reversal_id,'Denegación expone recibo');};
const inventory=()=>JSON.parse(local(`select jsonb_build_object('stock',(select current_stock from inventory_products where id='${material}'),'movements',(select count(*) from inventory_movements),'events',(select count(*) from inventory_unit_events),'receipts',(select count(*) from routine_inventory_operations),'receipt_hash',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from routine_inventory_operations x))`));
const check=expected=>{const s=inventory();assert.equal(s.stock,expected,'Stock incorrecto: detener');assert.equal(s.stock,100-Number(local("select coalesce(sum(case when movement_type='egreso' then quantity else -quantity end),0) from inventory_movements")),'Kardex distinto de saldo');return s;};
const functions=()=>local(`select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc,'acl',p.proacl,'owner',p.proowner,'definer',p.prosecdef,'settings',p.proconfig) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname<>'routine_inventory_operation'`);
const metadata=()=>local(`select jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'settings',proconfig,'args',pg_get_function_arguments(oid),'result',pg_get_function_result(oid)) from pg_proc where oid='routine_inventory_operation(uuid,uuid,text,jsonb)'::regprocedure`);
const existingLab=()=>sql(`select jsonb_object_agg(t,h) from (
 select 'products' t,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) h from inventory_products x union all
 select 'units',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_units x union all
 select 'movements',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_movements x union all
 select 'events',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_unit_events x union all
 select 'receipts',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from campo_inventory_operations x)z`);
try{
 for(const account of [...c.accounts,{...JSON.parse(file('scripts/inventory-auth-lab/runtime/transactions-admin.json')),role:'admin'}]){
  const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.signInWithPassword({email:account.email,password:account.password});assert(!error,error?.message);
  const token=data.session.access_token;const verified=await jwtVerify(token,jwks,{issuer:gateway+'/auth/v1',audience:'authenticated'});
  assert.equal(verified.protectedHeader.alg,'ES256');assert.equal(verified.payload.sub,account.role==='admin'?f.admin:f.users[account.role]);tokens[account.role]=token;
 }
 pass('JWT reales','GoTrue y firma ES256 verificados para líder, apoyo, retirado, ajeno y ADMIN; sin tokens inventados ni service_role.');
 local(`insert into routines(id,status,assigned_to) values('${fixture.routine}','in_progress','${f.users.leader}'),('${fixture.returned}','in_progress','${f.users.leader}');
 insert into job_assignees(job_type,job_id,technician_id,role) values('routine','${fixture.routine}','${f.users.leader}','leader'),('routine','${fixture.routine}','${f.users.support}','support'),('routine','${fixture.routine}','${f.users.removed}','support'),('routine','${fixture.returned}','${f.users.leader}','leader');`);
 const leader=ok(await call('leader',request(fixture.leaderOp,5)));
 const removed=ok(await call('removed',request(fixture.removedOp,3)));check(92);
 local(`delete from job_assignees where job_type='routine' and job_id='${fixture.routine}' and technician_id='${f.users.removed}'`);
 assert.deepEqual(ok(await call('removed',request(fixture.removedOp,3))),removed);
 pass('Causa reproducida antes del parche','RPC original devuelve recibo al técnico retirado, con JWT real y sin otro movimiento.');
 const before=inventory(),otherFunctions=functions(),acl=metadata();
 const original=file('supabase/migrations/20261015180000_fase162_inventario_rutinas.sql').match(/create function public\.routine_inventory_operation\([\s\S]*?end \$\$;/)[0];
 const patch=file('supabase/migrations/20261016020000_fase162_autorizacion_recibos.sql');
 assert.equal(patch.slice(patch.indexOf(" if p_action='withdraw'"),patch.indexOf('end $$;',patch.indexOf('create or replace function'))),original.slice(original.indexOf(" if p_action='withdraw'"),original.indexOf('end $$;')));
 local(patch);
 assert.equal(functions(),otherFunctions);assert.equal(metadata(),acl);assert.deepEqual(inventory(),before);
 pass('Parche mínimo aplicado solo en DB ficticia','Una RPC sustituida; resto de funciones, firma, ACL, owner, search_path, movimientos y recibos idénticos. Cuerpo de escrituras idéntico.');
 deny(await call('removed',request(fixture.removedOp,3)));assert.deepEqual(inventory(),before);
 pass('Retirado con JWT abierto denegado','Reutiliza JWT/UUID/carga anteriores; no recibe identificadores ni modifica inventario.');
 deny(await call('outsider',request(fixture.leaderOp,5)));
 deny(await call('support',request(fixture.leaderOp,5)));
 deny(await call('leader',request(fixture.leaderOp,6)));assert.deepEqual(inventory(),before);
 pass('Ajeno, otra identidad y otra carga denegados','Sin recuperación de recibos ni cambios de stock/historial.');
 assert.deepEqual(ok(await call('leader',request(fixture.leaderOp,5))),leader);
 const payload=request(fixture.supportOp,2);
 const replies=await Promise.all([call('support',payload),call('support',payload)]);
 assert.deepEqual(ok(replies[0]),ok(replies[1]));const supportReceipt=replies[0].body;
 assert.deepEqual(ok(await call('support',payload)),supportReceipt);check(90);
 assert.equal(inventory().movements,3);assert.equal(inventory().receipts,3);
 pass('Líder y apoyo autorizados, reintento y envío concurrente','Recibo estable; simula respuesta descartada y reenvía misma intención; 3 consumos, 3 recibos, stock 90.');
 const beforeInactive=inventory();local(`update profiles set active=false where id='${f.users.support}'`);
 deny(await call('support',payload));assert.deepEqual(inventory(),beforeInactive);
 local(`update profiles set active=true where id='${f.users.support}'`);
 assert.deepEqual(ok(await call('support',payload)),supportReceipt);
 pass('Inactivo denegado con mismo JWT','Actividad leída del perfil vigente; reactivación recupera el mismo recibo sin escribir.');
 local(`update routines set status='completed' where id='${fixture.routine}'`);
 const afterClose=inventory();assert.deepEqual(ok(await call('support',payload)),supportReceipt);
 deny(await call('support',request(randomUUID(),1)));assert.deepEqual(inventory(),afterClose);
 pass('Compatibilidad de cierre y reintento offline','Asignado activo recupera recibo tras cierre; operación nueva denegada. No reabre ni cambia el estado.');
 ok(await call('leader',request(fixture.returnedOp,4,fixture.returned)));check(86);
 const returned=await fetch(f.url+'/rpc/return_routine',{method:'POST',headers:{Authorization:'Bearer '+tokens.leader,'Content-Type':'application/json'},body:JSON.stringify({p_routine_id:fixture.returned,p_reason:'Devolución ficticia de prueba'})});assert(returned.ok,await returned.text());
 const afterReturn=inventory();deny(await call('leader',request(fixture.returnedOp,4,fixture.returned)));assert.deepEqual(inventory(),afterReturn);
 pass('Rutina devuelta deniega recibo','return_routine original, JWT real, borra asignación; mismo recibo ya no accesible. Stock 86 sin duplicados.');
 const office={p_routine_id:fixture.routine,p_operation_id:fixture.officeOp,p_action:'receive',p_payload:{unit_id:randomUUID()}};
 const officeResult={operation_id:fixture.officeOp,movement_or_event_id:randomUUID(),reversal_id:null};
 local(`insert into routine_inventory_operations(id,routine_id,actor_id,action,payload,result) values('${fixture.officeOp}','${fixture.routine}','${f.admin}','receive','${JSON.stringify(office.p_payload)}','${JSON.stringify(officeResult)}')`);
 const officeState=inventory();
 for(const role of ['ADMIN','SUPERADMIN','SOPORTE']){local(`update profiles set role='${role}' where id='${f.admin}'`);assert.deepEqual(ok(await call('admin',office)),officeResult);assert.deepEqual(inventory(),officeState);}
 local(`update profiles set role='ADMIN' where id='${f.admin}'`);
 pass('Permisos de oficina conservados','Mismo JWT auténtico con roles efectivos ADMIN/SUPERADMIN/SOPORTE en perfil ficticio; recibo propio de recepción recuperable. Fixture de recibo, sin recepción física nueva.');
 assert.equal(functions(),otherFunctions);assert.equal(metadata(),acl);check(86);
 assert.equal(inventory().movements,4);assert.equal(inventory().receipts,5);assert.equal(inventory().events,0);
 assert.deepEqual(JSON.parse(existingLab()),JSON.parse(readFileSync(runtime+'routine-receipt-existing-baseline.json','utf8')));
 report.final={stock:86,kardex:86,movements:4,receipts:5,events:0,previousLabRowsUnchanged:true,otherFunctionsUnchanged:true};
 pass('Integridad final','4 consumos, 5 recibos (uno fixture oficina), cero eventos; saldo=Kardex=86; laboratorio previo intacto.');
 report.status='PASS';save();
}catch(error){report.status='FAIL';report.error=error.message;save();throw error;}
