import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const client='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
const a='20000000-0000-0000-0000-000000000001',b='20000000-0000-0000-0000-000000000002',cancelled='20000000-0000-0000-0000-000000000003',added='20000000-0000-0000-0000-000000000004';
const order='30000000-0000-0000-0000-000000000001';
const actor=(n:number)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const session=(sql:string,n=1)=>`set role authenticated;set request.jwt.claim.sub='${actor(n)}';${sql}`;
const atomic=(token:string,ids=[a,b],confirm=true)=>`select public.client_retire_atomic('${client}','${token}',array[${ids.map(id=>`'${id}'::uuid`).join(',')}]::uuid[],${confirm});`;
test('baja definitiva: PostgreSQL efímero, RLS, atomicidad y concurrencia',{timeout:90000},async t=>{
 const name=`client-retirement-test-${process.pid}-${Date.now()}`;
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const args=['exec','-i',name,'psql','-h','127.0.0.1','-X','-q','-A','-t','-U','postgres','-v','ON_ERROR_STOP=1'];
 const query=(sql:string)=>docker(args,sql).trim();
 const parallel=(sql:string)=>new Promise<{code:number;output:string}>((resolve,reject)=>{const p=spawn('docker',args,{windowsHide:true});let out='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);p.on('error',reject);p.on('close',code=>resolve({code:code??1,output:out}));p.stdin.end(sql);});
 const state=()=>query(`select jsonb_build_object('clients',(select jsonb_agg(to_jsonb(c) order by id) from clients c),'contracts',(select jsonb_agg(to_jsonb(s) order by id) from service_contracts s));`);
 const protectedState=()=>query(`select jsonb_build_object('history',(select jsonb_agg(to_jsonb(p) order by kind) from preserved_history p),'units',(select jsonb_agg(to_jsonb(u) order by id) from inventory_units u),'onts',(select jsonb_agg(to_jsonb(o) order by id) from olt_onts o),'orders',(select jsonb_agg(to_jsonb(i) order by id) from installations i));`);
 const reset=()=>query(`truncate installations,service_contracts,clients,inventory_units,olt_onts;insert into clients(id,status,document_number) values('${client}','active','SYNTHETIC-1'),('${other}','active','SYNTHETIC-2');insert into service_contracts(id,client_id,contract_number,status,mikrotik_device_id,pppoe_username) values('${a}','${client}','TEST-A','active','${other}','synthetic'),('${b}','${client}','TEST-B','suspended',null,null),('${cancelled}','${client}','TEST-OLD','cancelled',null,null);insert into inventory_units values('${a}','${client}','${a}','assigned');insert into olt_onts values('${a}','${client}','${a}','online');`);
 const preview=(n=1)=>JSON.parse(query(session(`select public.client_retirement_preview('${client}');`,n)));
 try{
  docker(['run','--rm','--pull=never','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;for(let i=0;i<50;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
  const schema=file('./clientRetirement.fixture.sql'),at=schema.indexOf('create policy clients_staff_only');query(schema.slice(0,at));
  query(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
  query(schema.slice(at));reset();
  query(`insert into service_contracts(id,client_id,status)values('${added}','${other}','active');update clients set status='retired' where id='${other}';`);
  const beforeInstall=state();query(file('../../docs/sql/client-retirement-proposal.sql'));assert.equal(state(),beforeInstall,'La propuesta no corrige fichas históricas inconsistentes');
  await t.test('preview enumera todos; éxito cancela activo y suspendido, conserva cancelado e historial',()=>{
   reset();const p=preview();assert.equal(p.contracts.length,3);assert.equal(p.contracts.filter((c:any)=>c.status!=='cancelled').length,2);assert.equal(p.linkedEquipmentCount,1);assert.ok(p.contracts.find((c:any)=>c.id===a).pppoeLinked);
   const history=protectedState(),old=query(`select updated_at from service_contracts where id='${cancelled}';`),result=JSON.parse(query(session(atomic(p.token))));assert.equal(result.cancelledCount,2);assert.equal(result.operationalNetworkActionsExecuted,false);
   assert.equal(query(`select status from clients where id='${client}';`),'retired');assert.equal(query(`select count(*) from service_contracts where client_id='${client}' and status<>'cancelled';`),'0');assert.equal(protectedState(),history);assert.equal(query(`select updated_at from service_contracts where id='${cancelled}';`),old);
  });
  await t.test('sin confirmación, lista parcial o duplicada no cambia nada',()=>{
   for(const sql of [(p:any)=>atomic(p.token,[a],false),(p:any)=>atomic(p.token,[a]),(p:any)=>atomic(p.token,[a,a,b])]){reset();const before=state();assert.throws(()=>query(session(sql(preview()))),/Confirme|lista confirmada/);assert.equal(state(),before);}
  });
  await t.test('roles ADMIN/SUPERADMIN; demás roles, inactivo, anónimo y service_role denegados',()=>{
   reset();assert.equal(JSON.parse(query(session(atomic(preview(2).token),2))).status,'retired');
   for(const n of [3,4,5,6,7]){reset();const before=state();assert.throws(()=>preview(n),/ADMIN\/SUPERADMIN/);assert.throws(()=>query(session(atomic(preview().token),n)),/ADMIN\/SUPERADMIN/);assert.equal(state(),before);}
   for(const role of ['anon','service_role'])assert.throws(()=>query(`set role ${role};select public.client_retirement_preview('${client}');`),/permission denied/);
  });
  await t.test('direct update y GUC falsificado no evitan RPC; RLS actúa sin trigger',()=>{
   reset();const before=state();assert.throws(()=>query(session(`set app.client_retirement_id='${client}';update clients set status='retired' where id='${client}';`)),/transaccional/);assert.equal(state(),before);
   assert.throws(()=>query(`set session_replication_role=replica;${session(`update clients set status='retired' where id='${client}';`,3)}`),/row-level security/);assert.equal(state(),before);assert.equal(query(`select count(*) from pg_policies where tablename='clients' and permissive='RESTRICTIVE';`),'2');
   assert.throws(()=>query(session(`insert into service_contracts(id,client_id)values('${added}','${client}');`,7)),/No se puede validar/);
  });
  await t.test('Altas abiertas bloquean sin cancelar órdenes ni devolver equipos',()=>{
   for(const status of ['pending','scheduled','in_progress']){reset();query(`insert into installations values('${order}','${client}','${a}','${status}',now());`);const p=preview(),before=state(),history=protectedState();assert.equal(p.openInstallations.length,1);assert.throws(()=>query(session(atomic(p.token))),/Altas abiertas/);assert.equal(state(),before);assert.equal(protectedState(),history);}
  });
  await t.test('fallo en ficha revierte contratos y timestamps',()=>{
   reset();query(`create function public.force_retirement_failure() returns trigger language plpgsql as $$begin if new.status='retired' then raise exception 'injected client failure';end if;return new;end$$;create trigger z_force_retirement_failure before update on clients for each row execute function force_retirement_failure();`);const before=state(),history=protectedState(),p=preview();assert.throws(()=>query(session(atomic(p.token))),/injected client failure/);assert.equal(state(),before);assert.equal(protectedState(),history);query('drop trigger z_force_retirement_failure on clients;drop function force_retirement_failure();');
  });
  await t.test('contrato o ficha cambiados invalidan la vista previa',()=>{
   reset();const p=preview();query(`insert into service_contracts(id,client_id)values('${added}','${client}');`);const before=state();assert.throws(()=>query(session(atomic(p.token))),/cambiaron/);assert.equal(state(),before);
   reset();const p2=preview();query(`update clients set first_name='Cambio sintético' where id='${client}';`);const before2=state();assert.throws(()=>query(session(atomic(p2.token))),/cambiaron/);assert.equal(state(),before2);
  });
  await t.test('Alta creada después de la preview también bloquea y preserva la orden',()=>{
   reset();const p=preview();query(`insert into installations values('${order}','${client}','${a}','scheduled',now());`);const before=state(),history=protectedState();assert.throws(()=>query(session(atomic(p.token))),/Altas abiertas/);assert.equal(state(),before);assert.equal(protectedState(),history);
  });
  await t.test('rol desactivado después de preview no puede confirmar',()=>{
   reset();const p=preview(),before=state();query(`update profiles set active=false where id='${actor(1)}';`);
   try{assert.throws(()=>query(session(atomic(p.token))),/ADMIN\/SUPERADMIN/);assert.equal(state(),before);}finally{query(`update profiles set active=true where id='${actor(1)}';`);}
  });
  await t.test('sin contratos y órdenes cerradas: baja válida sin tocar historial',()=>{
   reset();query(`delete from service_contracts;insert into installations values('${order}','${client}',null,'completed',now());`);const history=protectedState(),p=preview();assert.equal(p.contracts.length,0);assert.equal(JSON.parse(query(session(atomic(p.token,[])))).cancelledCount,0);assert.equal(protectedState(),history);
  });
  await t.test('falla de un contrato revierte el lote; no permite ficha nueva directamente en Baja',()=>{
   reset();query(`create function public.force_contract_failure()returns trigger language plpgsql as $$begin if new.id='${b}' and new.status='cancelled' then raise exception 'injected contract failure';end if;return new;end$$;create trigger z_force_contract_failure before update on service_contracts for each row execute function force_contract_failure();`);
   const before=state(),p=preview();assert.throws(()=>query(session(atomic(p.token))),/injected contract failure/);assert.equal(state(),before);query('drop trigger z_force_contract_failure on service_contracts;drop function force_contract_failure();');
   assert.throws(()=>query(session(`insert into clients(id,status)values('${order}','retired');`)),/Cree la ficha/);
  });
  await t.test('cancelar un servicio conserva titular y otro servicio vigente',()=>{reset();query(session(`update service_contracts set status='cancelled' where id='${a}';`));assert.equal(query(`select status from clients where id='${client}';`),'active');assert.equal(query(`select status from service_contracts where id='${b}';`),'suspended');});
  await t.test('tras baja no permite crear/activar servicios ni abrir Altas',()=>{
   reset();query(session(atomic(preview().token)));assert.throws(()=>query(session(`insert into service_contracts(id,client_id)values('${added}','${client}');`)),/reincorporación/);assert.throws(()=>query(session(`update service_contracts set status='active'where id='${a}';`)),/reincorporación/);assert.throws(()=>query(session(`insert into installations values('${order}','${client}','${a}','pending',now());`)),/Alta abierta/);query(session(`insert into installations values('${order}','${client}','${a}','cancelled',now());`));assert.equal(query('select status from installations;'),'cancelled');
  });
  await t.test('contrato concurrente: nunca deja baja con contrato activo',async()=>{
   reset();const p=preview();const outcomes=await Promise.all([parallel(session(`begin;select 1 from clients where id='${client}' for update;select pg_sleep(0.2);${atomic(p.token)}commit;`)),parallel(session(`insert into service_contracts(id,client_id)values('${added}','${client}');`))]);assert.equal(outcomes.filter(o=>o.code===0).length,1,JSON.stringify(outcomes));assert.equal(query(`select count(*) from clients c where status='retired' and exists(select 1 from service_contracts s where s.client_id=c.id and s.status<>'cancelled');`),'0');
  });
  await t.test('contacto histórico sigue editable por staff sin conceder permiso de baja',()=>{
   reset();query(session(atomic(preview().token)));query(session(`update clients set first_name='Contacto corregido' where id='${client}';`,3));assert.equal(query(`select first_name from clients where id='${client}';`),'Contacto corregido');assert.equal(query(`select status from clients where id='${client}';`),'retired');
  });
  await t.test('rollback de definiciones elimina sólo objetos nuevos y conserva los datos',()=>{
   const before=state(),history=protectedState();query(file('../../docs/sql/client-retirement-rollback-proposal.sql'));assert.equal(state(),before);assert.equal(protectedState(),history);assert.equal(query(`select count(*) from pg_policies where policyname in ('client_retirement_update_guard','client_retirement_insert_guard');`),'0');
  });
 }finally{try{docker(['stop',name]);}catch{/* efímero ya eliminado */}}
});
