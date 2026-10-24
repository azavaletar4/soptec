import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { classifyNapServices } from '../../src/lib/napOccupancy';
import { isRetiredClient } from '../../src/lib/clientLifecycle';

const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const client='10000000-0000-0000-0000-000000000001';
const a='20000000-0000-0000-0000-000000000001',b='20000000-0000-0000-0000-000000000002';
const order='30000000-0000-0000-0000-000000000001';
const actor=(n:number)=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const session=(sql:string,n=1)=>`set role authenticated;set request.jwt.claim.sub='${actor(n)}';${sql}`;

test('baja de línea: PostgreSQL aislado, permisos, NAP comercial y atomicidad',{timeout:120000},async t=>{
 const name=`contract-administrative-test-${process.pid}-${Date.now()}`;
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:15000});
 const args=['exec','-i',name,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'];
 const query=(sql:string)=>docker(args,sql).trim();
 const parallel=(sql:string)=>new Promise<{code:number;output:string}>((resolve,reject)=>{
  const p=spawn('docker',args,{windowsHide:true});let output='';p.stdout.on('data',v=>output+=v);p.stderr.on('data',v=>output+=v);
  p.on('error',reject);p.on('close',code=>resolve({code:code??1,output}));p.stdin.end(sql);
 });
 const reset=()=>query(`truncate fo_nap_puertos,installations,service_contracts,clients,inventory_units,olt_onts;
 insert into clients(id,status)values('${client}','active');
 insert into service_contracts(id,client_id,status)values('${a}','${client}','active'),('${b}','${client}','active');
 insert into fo_nap_puertos values('${a}','${a}','${client}','nap-synthetic',1,'ocupado'),('${b}','${b}','${client}','nap-synthetic',2,'ocupado');
 insert into inventory_units values('${a}','${client}','${a}','assigned');insert into olt_onts values('${a}','${client}','${a}','online');`);
 const timestamp=(id=a)=>query(`select updated_at from service_contracts where id='${id}';`);
 const cancel=(id=a,stamp=timestamp(id),confirm=true)=>`select public.contract_cancel_administrative('${id}','${stamp}',${confirm});`;
 const state=()=>query(`select jsonb_build_object('c',(select jsonb_agg(c)from clients c),'s',(select jsonb_agg(s order by id)from service_contracts s));`);
 const protectedState=()=>query(`select jsonb_build_object('nap',(select jsonb_agg(n order by id)from fo_nap_puertos n),'history',(select jsonb_agg(h order by kind)from preserved_history h),'equipment',(select jsonb_agg(u)from inventory_units u),'ont',(select jsonb_agg(o)from olt_onts o),'orders',(select jsonb_agg(i)from installations i));`);
 const nap=()=>classifyNapServices(JSON.parse(query(`select jsonb_agg(jsonb_build_object('estado',p.estado,'client_id',p.client_id,'contract_id',p.contract_id,'puerto_numero',p.puerto_numero,'service_contracts',jsonb_build_object('status',s.status)))from fo_nap_puertos p join service_contracts s on s.id=p.contract_id;`)));
 const lifecycle=()=>JSON.parse(query(`select jsonb_build_object('status',c.status,'service_contracts',(select coalesce(jsonb_agg(jsonb_build_object('status',s.status)),'[]')from service_contracts s where s.client_id=c.id),'installations',(select coalesce(jsonb_agg(jsonb_build_object('status',i.status)),'[]')from installations i where i.client_id=c.id))from clients c;`));
 try{
  docker(['run','--rm','--pull=never','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
  const schema=file('./clientRetirement.fixture.sql'),at=schema.indexOf('create policy clients_staff_only');query(schema.slice(0,at));
  query(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);query(schema.slice(at));
  query('create table fo_nap_puertos(id uuid primary key,contract_id uuid,client_id uuid,infra_elemento_id text,puerto_numero integer,estado text);');
  reset();const beforeInstall=state();query(file('../../docs/sql/contract-administrative-cancellation-proposal.sql'));assert.equal(state(),beforeInstall);

  await t.test('dos líneas: sólo cancela seleccionada; NAP libera capacidad conservando historial, equipos y finanzas',()=>{
   reset();const before=protectedState(),other=query(`select row_to_json(s)from service_contracts s where id='${b}';`);
   query(session(cancel()));assert.equal(query(`select status from service_contracts where id='${a}';`),'cancelled');
   assert.equal(query(`select row_to_json(s)from service_contracts s where id='${b}';`),other);
   assert.equal(query('select status from clients;'),'active');assert.equal(protectedState(),before);
   assert.equal(isRetiredClient(lifecycle()),false);
   assert.equal(nap().occupied.length,1);assert.equal(nap().history.length,1);assert.equal(nap().history[0].contract_id,a);
  });
  await t.test('última línea vigente retira al titular, sin ONT obligatoria; repetición es idempotente',()=>{
   reset();query('truncate olt_onts;');query(session(cancel(b)));const stamp=timestamp(a);query(session(cancel(a,stamp),2));
   assert.equal(query('select status from clients;'),'retired');assert.equal(nap().occupied.length,0);assert.equal(nap().history.length,2);
   assert.equal(isRetiredClient(lifecycle()),true);
   const after=state();const repeated=JSON.parse(query(session(cancel(a,stamp))));assert.equal(repeated.alreadyCancelled,true);assert.equal(state(),after);
  });
  await t.test('suspensión conserva ocupación; cancelar otra línea deja al titular suspendido y vigente',()=>{
   reset();query(session(`update service_contracts set status='suspended'where id='${b}';`));assert.equal(nap().occupied.length,2);
   query(session(cancel()));assert.equal(query('select status from clients;'),'suspended');assert.equal(nap().occupied.length,1);
   assert.equal(isRetiredClient(lifecycle()),false);
  });
  await t.test('cancelar confirmación y preview obsoleta no escriben; Altas de la línea bloquean sin borrar órdenes',()=>{
   reset();let before=state();assert.throws(()=>query(session(cancel(a,timestamp(a),false))),/Confirme/);assert.equal(state(),before);
   assert.throws(()=>query(session(cancel(a,'2000-01-01T00:00:00Z'))),/Contrato cambiado/);assert.equal(state(),before);
   query(`insert into installations values('${order}','${client}','${a}','pending',now());`);before=state();const history=protectedState();
   assert.throws(()=>query(session(cancel())),/Alta abierta/);assert.equal(state(),before);assert.equal(protectedState(),history);
  });
  await t.test('Alta pendiente independiente impide retirar ficha al cancelar última línea',()=>{
   reset();query(`insert into installations values('${order}','${client}',null,'pending',now());`);query(session(cancel(a)));query(session(cancel(b)));
   assert.equal(query('select status from clients;'),'prospect');assert.equal(query('select status from installations;'),'pending');
   assert.equal(isRetiredClient(lifecycle()),false);
  });
  await t.test('permisos y bypass directo: sólo administradores activos por RPC',()=>{
   reset();const before=state();for(const role of [3,4,5,6,7])assert.throws(()=>query(session(cancel(),role)),/ADMIN/);
   assert.throws(()=>query(`set role anon;${cancel()}`),/permission denied/);assert.throws(()=>query(`set role service_role;${cancel()}`),/permission denied/);
   assert.throws(()=>query(session(`set app.client_retirement_id='${client}';update service_contracts set status='cancelled'where id='${a}';`)),/baja administrativa/);
   assert.equal(state(),before);
  });
  await t.test('fallo al guardar ficha revierte contrato y timestamps sin tocar historial',()=>{
   reset();query(session(cancel(b)));query(`create function public.fail_admin_test()returns trigger language plpgsql as $$begin raise exception 'injected client failure';end$$;create trigger fail_admin_test before update on clients for each row execute function fail_admin_test();`);
   const before=state(),history=protectedState();assert.throws(()=>query(session(cancel(a))),/injected/);assert.equal(state(),before);assert.equal(protectedState(),history);
   query('drop trigger fail_admin_test on clients;drop function fail_admin_test();');
  });
  await t.test('cancelaciones comerciales concurrentes serializan y no dejan estados parciales',async()=>{
   reset();const outcomes=await Promise.all([parallel(session(cancel(a))),parallel(session(cancel(b)))]);assert.ok(outcomes.every(r=>r.code===0),JSON.stringify(outcomes));
   assert.equal(query('select status from clients;'),'retired');assert.equal(nap().occupied.length,0);
   assert.throws(()=>query(session(`insert into service_contracts(id,client_id)values('${order}','${client}');`)),/retirada/);
  });
  await t.test('compatible con guardas locales 38cec66; rollback sólo de definiciones conserva datos',()=>{
   reset();query(file('../../docs/sql/client-retirement-proposal.sql'));query(session(cancel(a)));query(session(cancel(b)));assert.equal(query('select status from clients;'),'retired');
   query(file('../../docs/sql/client-retirement-rollback-proposal.sql'));
   const before=state(),history=protectedState();query(file('../../docs/sql/contract-administrative-cancellation-rollback.sql'));assert.equal(state(),before);assert.equal(protectedState(),history);
  });
 }finally{try{docker(['stop',name]);}catch{/* sólo contenedor propio */}}
});
