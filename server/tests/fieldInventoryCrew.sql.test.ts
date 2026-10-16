import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const capture=JSON.parse(file('../../docs/INVENTARIO-ETAPA-3-CUADRILLAS-CLOUD.json'));
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const tech=id(3),support=id(5),outsider=id(6),admin=id(2),job=id(20),routine=id(22),contract=id(30);
const client='30000000-0000-0000-0000-000000000001',cable='50000000-0000-0000-0000-000000000002',ont='50000000-0000-0000-0000-000000000001';
type Outcome={ok:boolean;out:string;error:string};
test('Etapa 3 con protecciones Cloud de cierre/cuadrillas: solo PostgreSQL aislado', {timeout:180000},async t=>{
 const container=`inventory-crew-test-${process.pid}-${Date.now()}`;
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const args=['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres'];
 const sql=(s:string)=>docker(args,`set statement_timeout='12s';set deadlock_timeout='200ms';${s}`).trim();
 const start=(s:string)=>new Promise<Outcome>(resolve=>{const p=execFile('docker',args,{encoding:'utf8',windowsHide:true},(e,out,error)=>resolve({ok:!e,out:out.trim(),error}));p.stdin!.end(`set statement_timeout='12s';set deadlock_timeout='200ms';${s}`);});
 const as=(s:string,actor=tech)=>`set role authenticated;set request.jwt.claim.sub='${actor}';${s}`;
 const call=(action='consume',payload:object={productId:cable,quantity:1},op=randomUUID(),kind='installation')=>`select campo_inventory_operation('${op}','${kind}','${job}','${action}','${JSON.stringify(payload)}');`;
 const run=(s:string,actor=tech)=>JSON.parse(sql(as(s,actor)));
 const wait=async(condition:string)=>{for(let i=0;i<50;i++){if(sql(`select (${condition})::int`)==='1')return;await new Promise(r=>setTimeout(r,25));}throw Error('No se alcanzó barrera SQL: '+condition);};
 const sleeping=(name:string)=>wait(`exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event='PgSleep')`);
 const blocked=(name:string)=>wait(`exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock')`);
 const stock=()=>sql(`select current_stock from inventory_products where id='${cable}'`);
 const count=()=>sql('select count(*) from inventory_movements');
 const reset=(kind='installation')=>{
  sql(`truncate campo_inventory_operations,inventory_unit_events,inventory_movements,inventory_units,job_assignees,job_work_sessions,routine_returns,tickets,installations,routines;
   update profiles set active=true;update inventory_products set current_stock=100;
   insert into ${kind==='installation'?'installations':'tickets'}(id,status,client_id,contract_id) values('${job}','${kind==='installation'?'scheduled':'open'}','${client}','${contract}');
   insert into job_assignees(job_type,job_id,technician_id,role) values('${kind}','${job}','${tech}','leader'),('${kind}','${job}','${support}','support');
   update ${kind==='installation'?'installations':'tickets'} set status='in_progress' where id='${job}';
   insert into inventory_units(id,product_id,serial_number,status,client_id,contract_id,installation_id,ticket_id)
   values('${id(40)}','${ont}','SYNTHETIC','assigned','${client}','${contract}',${kind==='installation'?`'${job}'`:'null'},${kind==='ticket'?`'${job}'`:'null'});`);
 };
 const crew=(members:object[],expected:object[]=[{technician_id:tech,role:'leader'},{technician_id:support,role:'support'}],kind='installation')=>`select set_current_job_crew('${kind}','${job}','${JSON.stringify(expected)}','${JSON.stringify(members)}');`;
 try {
  assert.equal(capture.read_only,'on');assert.equal(capture.phase161.function_exists,true);
  docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready);
  sql(file('./closedOrdersSchema.sql'));
  sql(`grant usage on schema auth to authenticated,anon;
   create type contract_service_type as enum('internet_combo');
   create table service_contracts(id uuid primary key,client_id uuid references clients(id),contract_number text,service_type contract_service_type default 'internet_combo',zone_id uuid);
   alter table installations add column client_id uuid,add column contract_id uuid;
   alter table tickets add column client_id uuid,add column contract_id uuid;
   create table fo_nap_puertos(id uuid primary key default gen_random_uuid(),contract_id uuid,estado text);
   create table job_work_sessions(id uuid primary key default gen_random_uuid(),job_type text,job_id uuid,started_at timestamptz default now(),ended_at timestamptz,end_reason text,created_at timestamptz default now());
   create unique index sessions_one_open on job_work_sessions(job_type,job_id) where ended_at is null;
   create table routine_returns(id uuid primary key default gen_random_uuid(),routine_id uuid references routines(id),technician_id uuid references profiles(id),returned_at timestamptz default now(),reason text,crew_snapshot jsonb);
   create unique index crew_one_leader on job_assignees(job_type,job_id) where role='leader';
   insert into service_contracts values('${contract}','${client}','SYNTHETIC','internet_combo','${id(31)}');
   insert into fo_nap_puertos(contract_id,estado) values('${contract}','ocupado');
   insert into profiles values('${support}','TECNICO_RED',true),('${outsider}','TECNICO_RED',true),('${id(7)}','FACTURACION',true);
   grant all on all tables in schema public to authenticated;`);
  // Definiciones capturadas completas: ningún stub de autorización/cuadrillas.
  for(const f of capture.functions)sql(f.definition);
  for(const f of capture.functions){const signature=sql(`select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname='${f.name}'`);sql(`revoke all on function ${signature} from public,anon,authenticated,service_role;`);for(const grant of f.acl??[]){const [role,permissions]=grant.split('=');if(permissions.includes('X')&&role!=='postgres')sql(`grant execute on function ${signature} to ${role||'public'}`);}}
  for(const tr of capture.triggers){assert.equal(tr.enabled,'O');sql(tr.definition);}
  for(const table of [...new Set(capture.policies.map((p:any)=>p.tablename))])sql(`alter table public.${table} enable row level security`);
  for(const p of capture.policies)sql(`create policy "${p.policyname}" on public.${p.tablename} as ${p.permissive} for ${p.cmd} to ${p.roles.map((r:string)=>`"${r}"`).join(',')}${p.qual?` using (${p.qual})`:''}${p.with_check?` with check (${p.with_check})`:''}`);
  sql(file('../../supabase/migrations/20261016010000_campo_inventory_operations.sql'));

  await t.test('cierre coordinado gana: técnico líder/apoyo no confirma consumo ni retiro posterior',async()=>{
   for(const kind of ['installation','ticket']){reset(kind);const table=kind==='installation'?'installations':'tickets',state=kind==='installation'?'completed':'resolved';
    const closing=start(`set application_name='close-first';${as(`begin;update ${table} set status='${state}' where id='${job}';select pg_sleep(1);commit;`)}`);
    await sleeping('close-first');const pending=start(`set application_name='consume-after-close';${as(call('consume',{productId:cable,quantity:2},randomUUID(),kind),support)}`);await blocked('consume-after-close');
    const [a,b]=await Promise.all([closing,pending]);assert(a.ok,a.error);assert(!b.ok);assert.match(b.error,/42501/);assert.equal(stock(),'100.00');
    assert.throws(()=>run(call(kind==='installation'?'unassign':'return',{unitId:id(40),...(kind==='ticket'?{condition:'in_stock'}:{})},randomUUID(),kind)),/42501/);
    assert.equal(sql(`select count(*) from job_work_sessions where end_reason='finished'`),'1');
   }
  });
  await t.test('inventario gana y cierre espera: un commit anterior y replay sin nueva mutación',async()=>{
   reset();const op=randomUUID(),request=call('consume',{productId:cable,quantity:2},op);
   const inventory=start(`set application_name='inventory-first';${as(`begin;${request}select pg_sleep(1);commit;`)}`);await sleeping('inventory-first');
   const close=start(`set application_name='close-second';${as(`update installations set status='completed' where id='${job}'`)}`);await blocked('close-second');
   const [a,b]=await Promise.all([inventory,close]);assert(a.ok,a.error);assert(b.ok,b.error);assert.equal(stock(),'98.00');run(request);assert.equal(count(),'1');
  });
  await t.test('RPC reasigna antes: consumo/corrección y replay del técnico anterior denegados',async()=>{
   for(const kind of ['installation','ticket']){reset(kind);const originalOp=randomUUID(),firstRequest=call('consume',{productId:cable,quantity:2},originalOp,kind);const first=run(firstRequest);const op=randomUUID();
    const dispatch=start(`set application_name='dispatch-first';${as(`begin;${crew([{technician_id:outsider,role:'leader'}],undefined,kind)}select pg_sleep(1);commit;`,admin)}`);await sleeping('dispatch-first');
    const consume=start(as(call('correct',{movementId:first.ids[0],quantity:1},op,kind)));const [a,b]=await Promise.all([dispatch,consume]);assert(a.ok,a.error);assert(!b.ok);assert.match(b.error,/42501/);assert.equal(stock(),'98.00');assert.equal(count(),'1');
    assert.throws(()=>run(call('correct',{movementId:first.ids[0],quantity:1},op,kind)),/42501/);
    assert.throws(()=>run(firstRequest),/42501/,'Un recibo previo tampoco se entrega al técnico revocado');
    run(call('consume',{productId:cable,quantity:1},randomUUID(),kind),outsider);assert.equal(stock(),'97.00');
   }
  });
  await t.test('devolución atómica de orden pierde asignación: ningún movimiento después del commit',async()=>{
   for(const kind of ['installation','ticket']){reset(kind);const table=kind==='installation'?'installations':'tickets';
    const returning=start(`set application_name='return-first';${as(`begin;update ${table} set status='${kind==='installation'?'pending':'rescheduled'}' where id='${job}';${crew([],undefined,kind)}select pg_sleep(1);commit;`,admin)}`);await sleeping('return-first');
    const movement=start(as(call('consume',{productId:cable,quantity:1},randomUUID(),kind)));const [a,b]=await Promise.all([returning,movement]);assert(a.ok,a.error);assert(!b.ok);assert.match(b.error,/42501/);assert.equal(stock(),'100.00');assert.equal(count(),'0');
   }
  });
  await t.test('DML legacy de cuadrilla con padre retenido: no deadlock, rollback y reintento',async()=>{
   for(const verb of ['delete','update']){reset();const op=randomUUID();
    const inventory=start(`set application_name='legacy-inventory';${as(`begin;select id from installations where id='${job}' for update;select pg_sleep(2);${call('consume',{productId:cable,quantity:1},op)}commit;`)}`);
    await sleeping('legacy-inventory');
    const legacy=start(`set application_name='legacy-dispatch';${as(verb==='delete'?`delete from job_assignees where job_id='${job}' and technician_id='${tech}'`:`update job_assignees set role='support' where job_id='${job}' and technician_id='${tech}'`,admin)}`);await blocked('legacy-dispatch');
    const results=await Promise.all([inventory,legacy]);assert(!results.some(r=>r.error.includes('40P01')),results.map(r=>r.error).join('\n'));
    assert(results[1].ok,results[1].error);assert(!results[0].ok);assert.match(results[0].error,/55P03/);assert.equal(stock(),'100.00');assert.equal(count(),'0');
    if(verb==='delete')assert.throws(()=>run(call('consume',{productId:cable,quantity:1},op)),/42501/);
    else {run(call('consume',{productId:cable,quantity:1},op));run(call('consume',{productId:cable,quantity:1},op));assert.equal(stock(),'99.00');}
   }
  });
  await t.test('cancelación con retorno automático compite con correct: historial y saldo únicos',async()=>{
   reset();const first=run(call('consume',{productId:cable,quantity:3}));
   const cancel=start(`set application_name='cancel-first';${as(`begin;update installations set status='cancelled' where id='${job}';select pg_sleep(1);commit;`,admin)}`);await sleeping('cancel-first');
   const correcting=start(as(call('correct',{movementId:first.ids[0],quantity:2})));const [a,b]=await Promise.all([cancel,correcting]);assert(a.ok,a.error);assert(!b.ok);assert.equal(stock(),'100.00');assert.equal(sql(`select count(*) from inventory_movements where reverses_movement_id='${first.ids[0]}'`),'1');assert.equal(sql(`select status from inventory_units where id='${id(40)}'`),'in_stock');
  });
  await t.test('Fase 161 capturada conserva devolución y sesión; RPC inventario no admite Rutinas',()=>{
   reset();sql(`update installations set status='completed';insert into routines(id,status) values('${routine}','pending');insert into job_assignees(job_type,job_id,technician_id,role) values('routine','${routine}','${tech}','leader');update routines set status='in_progress' where id='${routine}';`);
   sql(as(`select return_routine('${routine}','Motivo sintético')`));assert.equal(sql(`select status from routines where id='${routine}'`),'pending');assert.equal(sql('select count(*) from routine_returns'),'1');assert.equal(sql(`select count(*) from job_assignees where job_type='routine'`),'0');assert.throws(()=>run(call('consume',{productId:cable,quantity:1},randomUUID(),'routine')),/22023/);
  });
  await t.test('dos grupos históricos sintéticos 26/30: RPC rechaza otra reversión sin alterar filas ni saldo',()=>{
   for(const shape of capture.duplicate_reversal_shapes){assert(shape.same_product&&shape.same_quantity&&shape.all_ingreso&&shape.same_order);reset();const first=run(call('consume',{productId:cable,quantity:1}));sql(`insert into inventory_movements(product_id,movement_type,quantity,installation_id,reverses_movement_id) select '${cable}','ingreso',1,'${job}','${first.ids[0]}' from generate_series(1,${shape.reversals});`);const before=sql('select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m'),balance=stock(),op=randomUUID();for(let i=0;i<2;i++)assert.throws(()=>run(call('reverse',{movementId:first.ids[0]},op)),/22023/);assert.equal(stock(),balance);assert.equal(sql('select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m'),before);}
  });
 }finally{try{docker(['rm','-f',container]);}catch{}}
});
