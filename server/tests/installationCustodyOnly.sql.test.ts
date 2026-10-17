import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const admin = '00000000-0000-0000-0000-000000000002';
const tech = '00000000-0000-0000-0000-000000000003';
const other = '00000000-0000-0000-0000-000000000005';
const client = '30000000-0000-0000-0000-000000000001';
const contract = '31000000-0000-0000-0000-000000000001';
const install = '20000000-0000-0000-0000-000000000001';
const routine = '10000000-0000-0000-0000-000000000164';
const tv = '50000000-0000-0000-0000-000000000013';
const cable = '50000000-0000-0000-0000-000000000012';
const unit = '60000000-0000-0000-0000-000000000001';

test('Altas solo custodia: RPC lectura/escritura y cierre sin regresion', { timeout: 180000 }, async t => {
  const container = `smartrayco-f164-custody-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  const as = (s: string, uid = tech) => sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
  const campoOp = (action: string, payload: object, uid = tech, id = randomUUID()) =>
    as(`select public.campo_inventory_operation('${id}','installation','${install}','${action}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb);`, uid);

  const reset = () => sql(`truncate public.inventory_unit_events,public.inventory_movements,public.inventory_units,
      public.campo_inventory_operations,public.routine_inventory_operations,public.technician_material_custody,public.technician_material_custody_events,
      public.technician_material_return_requests,public.job_assignees,public.installations,public.routines;
    update inventory_products set current_stock=100;
    insert into installations(id,status,client_id,contract_id) values('${install}','in_progress','${client}','${contract}');
    insert into routines(id,status,client_id,contract_id) values('${routine}','in_progress','${client}','${contract}');
    insert into job_assignees values('installation','${install}','${tech}','leader');
    insert into inventory_units(id,product_id,serial_number,status) values('${unit}','${tv}','TV-164-01','in_stock');`);

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) { try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready);

    sql(file('./closedOrdersSchema.sql'));
    sql(`alter table routines add column client_id uuid references clients(id), add column contract_id uuid;
      alter table installations add column client_id uuid references clients(id), add column contract_id uuid;
      alter table profiles add column full_name text, add column email text;
      alter table inventory_units add column pending_pickup_by uuid references profiles(id);
      alter table inventory_unit_events add column assigned_to uuid references profiles(id);
      create table service_contracts(id uuid primary key, client_id uuid references clients(id));
      insert into profiles values('${other}','TECNICO_RED',true);
      insert into service_contracts values('${contract}','${client}');
      insert into inventory_products(id,name,unit,is_serialized) values('${tv}','TV Box','unidad',true),('${cable}','Cable Drop','metro',false);
      create unique index inventory_test_serial on inventory_units(serial_number);
      alter table inventory_movements enable row level security;
      alter table inventory_unit_events enable row level security;
      create policy movements_test on inventory_movements for all to authenticated using(true) with check(true);
      create policy events_test on inventory_unit_events for all to authenticated using(true) with check(true);
      alter table installations enable row level security;
      create policy installations_test on installations for all to authenticated using(true) with check(true);`);
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    sql(file('../../supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql'));
    sql(`create trigger trg_inventory_unit_events_apply before insert on inventory_unit_events for each row execute function apply_inventory_unit_event();
      create trigger trg_inventory_movements_apply before insert on inventory_movements for each row execute function apply_inventory_movement();`);
    sql(file('../../supabase/migrations/20261016010000_campo_inventory_operations.sql'));
    sql(`alter table campo_inventory_operations enable row level security;
      create policy campo_ops_test on campo_inventory_operations for all to authenticated using(true) with check(true);`);
    sql(file('../../supabase/migrations/20261015180000_fase162_inventario_rutinas.sql'));
    sql(`alter type public.inventory_unit_status add value 'with_technician';`);
    sql(`alter type public.inventory_unit_status add value 'pending_return';`);
    sql(file('../../supabase/migrations/20261017030000_fase164_custodia_tecnicos.sql'));
    sql(`update inventory_products set name='Huawei ONT de prueba',category_id=(select id from inventory_categories where slug='onu') where id='${tv}';`);



    const rollback=file('../../scripts/rollback-campo-installation-custody-only.sql');
    sql(rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION'),rollback.lastIndexOf('COMMIT;')));
    const acl=()=>sql("select string_agg(proacl::text,'|' order by oid) from pg_proc where oid in ('inventory_order_read(text,uuid,text,integer,uuid,uuid,text)'::regprocedure,'campo_inventory_operation(uuid,text,uuid,text,jsonb)'::regprocedure)");
    const beforeAcl=acl();
    const read=(uid=tech)=>JSON.parse(as("select inventory_order_read('installation','"+install+"','available',0,'"+tv+"',null,null);",uid)).items;
    reset();
    await t.test('hotfix anterior mantiene bodega: reproduce la causa',()=>assert(read().some((u:any)=>u.id===unit)));
    sql(file('../../scripts/prepare-campo-installation-custody-only.sql'));
    await t.test('Ruber simulado solo ve custodia propia y otro tecnico solo la suya',()=>{
      as("select deliver_unit_to_technician('"+unit+"','"+tech+"','x');",admin);
      const foreign='60000000-0000-0000-0000-000000000012',warehouse='60000000-0000-0000-0000-000000000013';
      sql("insert into job_assignees values('installation','"+install+"','"+other+"','support'); insert into inventory_units(id,product_id,serial_number) values('"+foreign+"','"+tv+"','FOREIGN'),('"+warehouse+"','"+tv+"','WAREHOUSE');");
      as("select deliver_unit_to_technician('"+foreign+"','"+other+"','x');",admin);
      assert.deepEqual(read().map((u:any)=>u.id),[unit]); assert.deepEqual(read(other).map((u:any)=>u.id),[foreign]);
      assert.equal(read()[0].custody_technician_id,tech); assert.equal(acl(),beforeAcl);
      assert.throws(()=>campoOp('assign',{unitId:unit},other),/custodia vigente/);
      assert.throws(()=>campoOp('assign',{unitId:warehouse}),/custodia vigente/);
      assert.throws(()=>campoOp('assign',{unitId:foreign}),/custodia vigente/);
    });
    await t.test('instalacion valida, recibo idempotente y cierre normal sin segunda asignacion',()=>{
      const id=randomUUID(),payload={unitId:unit}; const first=campoOp('assign',payload,tech,id);
      assert.equal(campoOp('assign',payload,tech,id),first); assert(!read().some((u:any)=>u.id===unit));
      assert.throws(()=>campoOp('assign',payload),/custodia vigente/);
      assert.equal(sql("select count(*) from inventory_unit_events where unit_id='"+unit+"' and to_status='assigned'"),'1');
      assert.equal(sql('select count(*) from inventory_movements'),'0');
      as("update installations set status='completed' where id='"+install+"';");
      assert.equal(sql("select status from installations where id='"+install+"'"),'completed');
      assert.equal(campoOp('assign',payload,tech,id),first);
      assert.throws(()=>read(),/Estado de orden no autorizado/);
      assert.throws(()=>campoOp('assign',payload),/no admite nuevas operaciones/);
    });
    await t.test('pendiente de devolucion no se muestra ni se instala',()=>{
      reset(); as("select deliver_unit_to_technician('"+unit+"','"+tech+"','x');",admin); as("select request_unit_return('"+unit+"','x');");
      assert.equal(read().length,0); assert.throws(()=>campoOp('assign',{unitId:unit}),/custodia vigente/);
    });
    await t.test('lista obsoleta: equipo devuelto despues de leer se rechaza bajo bloqueo',()=>{
      reset(); as("select deliver_unit_to_technician('"+unit+"','"+tech+"','x');",admin); assert.equal(read().length,1);
      as("select receive_unit_return('"+unit+"','in_stock','recibido');",admin);
      assert.equal(read().length,0); assert.throws(()=>campoOp('assign',{unitId:unit}),/custodia vigente/);
    });
    await t.test('Averias conserva lectura de bodega y stage existente',()=>{
      reset(); sql("alter table tickets add column client_id uuid,add column contract_id uuid; insert into tickets(id,status,client_id,contract_id) values('"+install+"','in_progress','"+client+"','"+contract+"'); insert into job_assignees values('ticket','"+install+"','"+tech+"','leader');");
      const items=JSON.parse(as("select inventory_order_read('ticket','"+install+"','available',0,'"+tv+"',null,null);")).items;
      assert.equal(items.length,1);
      as("select campo_inventory_operation('"+randomUUID()+"','ticket','"+install+"','stage','{\"unitId\":\""+unit+"\"}');");
      assert.equal(sql("select status from inventory_units where id='"+unit+"'"),'pending_approval');
    });
    await t.test('rollback exacto y reaplicacion conservan ACL',()=>{
      sql(file('../../scripts/rollback-campo-installation-custody-only.sql'));reset();assert.equal(read().length,1);
      sql(file('../../scripts/prepare-campo-installation-custody-only.sql'));assert.equal(read().length,0);assert.equal(acl(),beforeAcl);
    });
  } finally { try { docker(['rm','-f',container]); } catch {} }
});
