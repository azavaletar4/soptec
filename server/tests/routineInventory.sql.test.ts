import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tech='00000000-0000-0000-0000-000000000003', admin='00000000-0000-0000-0000-000000000002';
const other='00000000-0000-0000-0000-000000000005';
const client='30000000-0000-0000-0000-000000000001', client2='30000000-0000-0000-0000-000000000002';
const contract='31000000-0000-0000-0000-000000000001', contract2='31000000-0000-0000-0000-000000000002';
const routine='10000000-0000-0000-0000-000000000162';
const install='20000000-0000-0000-0000-000000000001', ticket='20000000-0000-0000-0000-000000000002';
const utp='50000000-0000-0000-0000-000000000002', rj='50000000-0000-0000-0000-000000000003', tv='50000000-0000-0000-0000-000000000004';
const unit='60000000-0000-0000-0000-000000000001', old='60000000-0000-0000-0000-000000000002';

test('Fase 162: real migration, isolated inventory and legacy restrictions', {timeout:180000}, async t => {
 const container=`smartrayco-routine-inventory-${process.pid}-${Date.now()}`;
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const args=['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
 const sql=(s:string)=>docker(args,s).trim();
 const as=(s:string,uid=tech)=>sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
 const statement=(action:string,payload:object={},id=randomUUID())=>`select public.routine_inventory_operation('${routine}','${id}','${action}','${JSON.stringify(payload).replaceAll("'","''")}'::jsonb);`;
 const call=(a:string,p:object={},uid=tech,id=randomUUID())=>JSON.parse(as(statement(a,p,id),uid));
 const reset=()=>sql(`truncate public.inventory_unit_events,public.inventory_movements,public.inventory_units,public.routine_inventory_operations,public.routine_returns,public.job_work_sessions,public.job_assignees,public.routines,public.tickets,public.installations;
 update inventory_products set current_stock=100;
 insert into installations(id,status) values('${install}','completed');
 insert into tickets(id,status) values('${ticket}','closed');
 insert into routines(id,status,client_id,contract_id,assigned_to) values('${routine}','in_progress','${client}','${contract}','${tech}');
 insert into job_assignees values('routine','${routine}','${tech}','leader');
 insert into inventory_units(id,product_id,serial_number,status,client_id,contract_id,installation_id,ticket_id) values
 ('${unit}','${tv}','TV-NEW','in_stock',null,null,null,null),
 ('${old}','${tv}','TV-OLD','assigned','${client}','${contract}','${install}','${ticket}');`);
 try {
  docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;for(let i=0;i<50;i++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert(ready);
  sql(file('./closedOrdersSchema.sql'));
  sql(`alter table routines add column client_id uuid references clients(id), add column contract_id uuid;
    alter table inventory_units add column pending_pickup_by uuid references profiles(id);
    alter table inventory_unit_events add column assigned_to uuid references profiles(id);
    create table service_contracts(id uuid primary key,client_id uuid references clients(id));
    insert into profiles values('${other}','TECNICO_RED',true);
    insert into clients values('${client2}');
    insert into service_contracts values('${contract}','${client}'),('${contract2}','${client2}');
    update inventory_products set unit='metro' where id='${utp}';
    insert into inventory_products(id,name,unit,is_serialized) values('${rj}','RJ45','unidad',false),('${tv}','TV Box','unidad',true);
    create unique index inventory_test_serial on inventory_units(serial_number);
    alter table inventory_movements enable row level security;
    alter table inventory_unit_events enable row level security;
    create policy movements_test on inventory_movements for all to authenticated using(true) with check(true);
    create policy events_test on inventory_unit_events for all to authenticated using(true) with check(true);`);
  sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
  const legacy=file('../../supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql');
  sql(legacy);
  const migration=file('../../supabase/migrations/20261015180000_fase162_inventario_rutinas.sql');
  const legacyFunction=legacy.match(/create or replace function public\.apply_inventory_unit_event\(\)[\s\S]*?\$\$;/)![0];
  const newFunction=migration.match(/create or replace function public\.apply_inventory_unit_event\(\)[\s\S]*?\$\$;/)![0];
  assert.equal(newFunction.replace(/  -- Fase 162: only authorized routine events enter the isolated branch\.\r?\n  if new\.routine_id is not null then\r?\n    return public\.apply_routine_inventory_event\(new\);\r?\n  end if;\r?\n/, '').replaceAll('\r',''),legacyFunction.replaceAll('\r',''));
  sql(`create trigger trg_inventory_unit_events_apply before insert on inventory_unit_events for each row execute function apply_inventory_unit_event();
       create trigger trg_inventory_movements_apply before insert on inventory_movements for each row execute function apply_inventory_movement();`);
  sql(file('../../supabase/migrations/20261012140000_fase150_sesiones_trabajo.sql'));
  sql(file('../../supabase/migrations/20261012200000_fase150b_fix_track_job_work_session_enum.sql'));
  sql(file('../../supabase/migrations/20261014180000_fase161_devolver_rutinas.sql'));
  sql(migration);
  await t.test('UTP decimal and RJ45 integer use central Kardex exactly once',()=>{
   reset();call('consume',{product_id:utp,quantity:12.75});call('consume',{product_id:rj,quantity:4});
   assert.equal(sql(`select current_stock from inventory_products where id='${utp}';`),'87.25');
   assert.equal(sql(`select current_stock from inventory_products where id='${rj}';`),'96.00');
   assert.equal(sql(`select count(*) from inventory_movements where routine_id='${routine}' and created_by='${tech}' and operation_id is not null;`),'2');
  });
  await t.test('no fractional units, nonfinite/invalid quantities or serialized material',()=>{
   reset();for(const quantity of [0,-1,1.001,'NaN','Infinity'])assert.throws(()=>call('consume',{product_id:utp,quantity}));
   assert.throws(()=>call('consume',{product_id:rj,quantity:1.5}));assert.throws(()=>call('consume',{product_id:tv,quantity:1}));
   assert.equal(sql('select count(*) from inventory_movements;'),'0');
  });
  await t.test('insufficient stock rolls back receipt and balance',()=>{
   reset();assert.throws(()=>call('consume',{product_id:utp,quantity:101}));
   assert.equal(sql('select count(*) from routine_inventory_operations;'),'0');
   assert.equal(sql(`select current_stock from inventory_products where id='${utp}';`),'100.00');
  });
  await t.test('lost response retry is idempotent, changed payload/actor rejected',()=>{
   reset();const id=randomUUID(),p={product_id:utp,quantity:5};const first=call('consume',p,tech,id);
   assert.deepEqual(call('consume',p,tech,id),first);
   assert.throws(()=>call('consume',{...p,quantity:6},tech,id));assert.throws(()=>call('consume',p,other,id));
   assert.throws(()=>as(statement('consume',p,id).replace(`'${routine}'`,'NULL')));
   assert.equal(sql('select count(*) from inventory_movements;'),'1');
  });
  await t.test('concurrent double send consumes once',async()=>{
   reset();const id=randomUUID(),s=`set role authenticated;set request.jwt.claim.sub='${tech}';${statement('consume',{product_id:utp,quantity:7},id)}`;
   const run=()=>new Promise<string>((resolve,reject)=>{const p=execFile('docker',args,{encoding:'utf8',windowsHide:true},(e,out)=>e?reject(e):resolve(out.trim()));p.stdin!.end(s);});
   const [a,b]=await Promise.all([run(),run()]);assert.equal(a,b);
   assert.equal(sql(`select current_stock from inventory_products where id='${utp}';`),'93.00');
  });
  await t.test('correction is atomic and cannot reverse twice',()=>{
   reset();const m=call('consume',{product_id:utp,quantity:10}).movement_or_event_id;
   assert.throws(()=>call('correct',{movement_id:m,quantity:200}));
   assert.equal(sql('select count(*) from inventory_movements;'),'1');
   call('correct',{movement_id:m,quantity:8});assert.equal(sql(`select current_stock from inventory_products where id='${utp}';`),'92.00');
   assert.throws(()=>call('remove',{movement_id:m}));
  });
  await t.test('TV Box staged then office approved, no consumable discount',()=>{
   reset();call('install',{unit_id:unit,contract_id:contract});
   assert.equal(sql(`select status||'|'||routine_id||'|'||client_id||'|'||contract_id from inventory_units where id='${unit}';`),`pending_approval|${routine}|${client}|${contract}`);
   assert.throws(()=>call('approve',{unit_id:unit}));
   call('approve',{unit_id:unit},admin);assert.equal(sql(`select status from inventory_units where id='${unit}';`),'assigned');
   assert.equal(sql('select count(*) from inventory_movements;'),'0');
  });
  await t.test('withdraw from closed origin is scoped, preserves origins, not warehouse available',()=>{
   reset();const p={unit_id:old,contract_id:contract,reason:'Retiro autorizado'};const id=randomUUID();
   call('withdraw',p,tech,id);call('withdraw',p,tech,id);
   assert.equal(sql(`select status||'|'||installation_id||'|'||ticket_id||'|'||pending_pickup_by from inventory_units where id='${old}';`),`en_recupero|${install}|${ticket}|${tech}`);
   assert.equal(sql(`select installation_id||'|'||ticket_id||'|'||client_id||'|'||contract_id from inventory_unit_events where unit_id='${old}';`),`${install}|${ticket}|${client}|${contract}`);
   assert.throws(()=>call('withdraw',p));assert.throws(()=>call('receive',{unit_id:old,condition:'in_stock'}));
   call('receive',{unit_id:old,condition:'in_repair'},admin);
   assert.equal(sql(`select status||'|'||(installation_id is null)::text from inventory_units where id='${old}';`),'in_repair|true');
   assert.equal(sql(`select count(*) from inventory_unit_events where unit_id='${old}' and installation_id='${install}' and ticket_id='${ticket}';`),'2');
  });
  await t.test('other clients/contracts/states and missing reason are rejected',()=>{
   reset();assert.throws(()=>call('withdraw',{unit_id:old,contract_id:contract2,reason:'Retiro'}));
   sql(`update inventory_units set client_id='${client2}',contract_id='${contract2}' where id='${old}';`);
   assert.throws(()=>call('withdraw',{unit_id:old,contract_id:contract,reason:'Retiro'}));
   assert.throws(()=>call('withdraw',{unit_id:unit,contract_id:contract,reason:'Retiro'}));
   assert.throws(()=>call('withdraw',{unit_id:old,contract_id:contract}));
   assert.throws(()=>call('install',{unit_id:unit,contract_id:contract2}));
  });
  await t.test('authentication, active role, crew, state and private helpers enforced',()=>{
   reset();assert.throws(()=>call('consume',{product_id:utp,quantity:1},other));
   assert.throws(()=>call('consume',{product_id:utp,quantity:1},admin));
   sql(`update profiles set active=false where id='${tech}';`);assert.throws(()=>call('consume',{product_id:utp,quantity:1}));sql(`update profiles set active=true where id='${tech}';`);
   assert.throws(()=>sql(`set role anon;${statement('consume',{product_id:utp,quantity:1})}`));
   assert.throws(()=>as(`select check_routine_inventory_receipt('${randomUUID()}','${routine}');`));
   for(const status of ['pending','completed','cancelled']){sql(`update routines set status='${status}';`);assert.throws(()=>call('consume',{product_id:utp,quantity:1}));}
  });
  await t.test('direct writes and fake receipts cannot enter the scoped exception',()=>{
   reset();assert.throws(()=>as(`insert into inventory_unit_events(unit_id,to_status,routine_id,operation_id) values('${old}','in_stock','${routine}','${randomUUID()}');`));
   assert.throws(()=>as(`insert into inventory_movements(product_id,movement_type,quantity,routine_id) values('${utp}','egreso',1,'${routine}');`));
   assert.throws(()=>as(`insert into routine_inventory_operations(id,routine_id,actor_id,action,payload) values('${randomUUID()}','${routine}','${tech}','withdraw','{}');`));
   call('withdraw',{unit_id:old,contract_id:contract,reason:'Retiro'});
   assert.throws(()=>as(`update inventory_units set status='in_stock',routine_id=null where id='${old}';`));
   assert.throws(()=>as(`insert into inventory_unit_events(unit_id,to_status) values('${old}','in_stock');`));
   assert.throws(()=>sql(`delete from inventory_units where id='${old}';`));
  });
  await t.test('event failure rolls back projection and operation receipt',()=>{
   reset();sql(`create function fail_routine_event() returns trigger language plpgsql as $$ begin raise exception 'SIMULATED_FAILURE'; end $$;
    create trigger fail_routine_event after insert on inventory_unit_events for each row execute function fail_routine_event();`);
   try{assert.throws(()=>call('withdraw',{unit_id:old,contract_id:contract,reason:'Retiro'}));assert.equal(sql(`select status from inventory_units where id='${old}';`),'assigned');assert.equal(sql('select count(*) from routine_inventory_operations;'),'0');}
   finally{sql('drop trigger fail_routine_event on inventory_unit_events;drop function fail_routine_event();');}
  });
  await t.test('return/reassign does not reverse materials or released equipment; old crew loses access',()=>{
   reset();const id=randomUUID(),p={product_id:utp,quantity:6};call('consume',p,tech,id);call('withdraw',{unit_id:old,contract_id:contract,reason:'Retiro'});
   as(`select return_routine('${routine}','Continuará otra cuadrilla');`);
   assert.equal(sql(`select current_stock from inventory_products where id='${utp}';`),'94.00');assert.equal(sql(`select status from inventory_units where id='${old}';`),'en_recupero');
   assert.throws(()=>call('consume',{product_id:utp,quantity:1}));
   call('consume',p,tech,id); // resolves an already committed request after return
   sql(`insert into job_assignees values('routine','${routine}','${other}','leader');update routines set status='in_progress',assigned_to='${other}';`);
   assert.throws(()=>call('consume',{product_id:utp,quantity:1}));call('consume',{product_id:utp,quantity:2},other);
   assert.equal(sql(`select current_stock from inventory_products where id='${utp}';`),'92.00');
  });
  await t.test('cancellation preserves inventory; rejected equipment requires physical reception',()=>{
   reset();call('consume',{product_id:rj,quantity:3});call('install',{unit_id:unit,contract_id:contract});
   call('reject',{unit_id:unit},admin);
   assert.equal(sql(`select status from inventory_units where id='${unit}';`),'en_recupero');
   sql(`update routines set status='cancelled';`);
   assert.equal(sql(`select current_stock from inventory_products where id='${rj}';`),'97.00');
   assert.throws(()=>call('consume',{product_id:rj,quantity:1}));
   call('receive',{unit_id:unit,condition:'in_stock'},admin);
   assert.equal(sql(`select status||'|'||(routine_id is null)::text from inventory_units where id='${unit}';`),'in_stock|true');
   assert.equal(sql('select count(*) from inventory_unit_events;'),'3');
   assert.throws(()=>sql(`delete from routines where id='${routine}';`));
  });
  await t.test('concurrent different withdrawal requests cannot retire the same unit twice',async()=>{
   reset();const run=()=>new Promise<string>((resolve,reject)=>{const p=execFile('docker',args,{encoding:'utf8',windowsHide:true},(e,out)=>e?reject(e):resolve(out));p.stdin!.end(`set role authenticated;set request.jwt.claim.sub='${tech}';${statement('withdraw',{unit_id:old,contract_id:contract,reason:'Retiro'})}`);});
   const results=await Promise.allSettled([run(),run()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(sql('select count(*) from inventory_unit_events;'),'1');
   assert.equal(sql('select count(*) from routine_inventory_operations;'),'1');
  });
  await t.test('legacy ticket/installation restrictions unchanged and open-order inventory still works',()=>{
   reset();assert.throws(()=>as(`insert into inventory_unit_events(unit_id,to_status) values('${old}','in_repair');`));
   assert.throws(()=>as(`insert into inventory_movements(product_id,movement_type,quantity,ticket_id) values('${utp}','egreso',1,'${ticket}');`));
   assert.throws(()=>as(`insert into inventory_movements(product_id,movement_type,quantity,installation_id) values('${utp}','egreso',1,'${install}');`));
   as(`insert into inventory_movements(product_id,movement_type,quantity,installation_id) values('${utp}','egreso',1,'${install}');`,admin);
   sql(`update installations set status='scheduled';update tickets set status='open';`);
   as(`insert into inventory_movements(product_id,movement_type,quantity,ticket_id) values('${utp}','egreso',1,'${ticket}');`);
   as(`insert into inventory_unit_events(unit_id,to_status,client_id,contract_id,installation_id) values('${unit}','assigned','${client}','${contract}','${install}');`);
   assert.equal(sql(`select status from inventory_units where id='${unit}';`),'assigned');
  });
  await t.test('migration refuses legacy function drift before changing schema',()=>{
   const guard=migration.match(/do \$\$[\s\S]*?end \$\$;/)![0];
   try {
    sql(`create or replace function public.apply_inventory_unit_event() returns trigger language plpgsql security definer set search_path=public as $$ begin return new; end $$;`);
    assert.throws(()=>sql(guard));
   } finally { sql(newFunction); }
  });
 } finally {try{docker(['stop',container]);}catch{ /* disposable container */ }}
});
