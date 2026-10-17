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

test('Selector Alta Fase164: custodia propia, aislamiento e idempotencia', { timeout: 180000 }, async t => {
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


    const rollback=file('../../scripts/rollback-campo-available-custody.sql');
    sql(rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION'),rollback.lastIndexOf('COMMIT;')));
    sql('revoke all on function inventory_order_read(text,uuid,text,integer,uuid,uuid,text) from public; grant execute on function inventory_order_read(text,uuid,text,integer,uuid,uuid,text) to authenticated;');
    const aclBefore=sql("select proacl::text from pg_proc where oid='inventory_order_read(text,uuid,text,integer,uuid,uuid,text)'::regprocedure");
    const read=(uid=tech,product=tv)=>JSON.parse(as("select inventory_order_read('installation','"+install+"','available',0,'"+product+"',null,null);",uid)).items;
    reset();as("select deliver_unit_to_technician('"+unit+"','"+tech+"','Entrega de prueba');",admin);
    await t.test('reproduce la causa: selector anterior excluye custodia propia',()=>assert(!read().some((u:any)=>u.id===unit)));
    sql(file('../../scripts/fix-campo-available-custody.sql'));
    await t.test('parche conserva ACL y la lectura ahora incluye custodia propia',()=>{
      assert.equal(sql("select proacl::text from pg_proc where oid='inventory_order_read(text,uuid,text,integer,uuid,uuid,text)'::regprocedure"),aclBefore);
      assert(read().some((u:any)=>u.id===unit));
    });
    await t.test('otro tecnico en la MISMA cuadrilla no ve ni puede usar el equipo ajeno',()=>{
      sql("insert into job_assignees values('installation','"+install+"','"+other+"','support');");
      assert(!read(other).some((u:any)=>u.id===unit));
      assert.throws(()=>campoOp('assign',{unitId:unit},other),/Equipo no disponible/);
      assert.equal(sql("select status from inventory_units where id='"+unit+"'"),'with_technician');
    });
    await t.test('la misma operacion se aplica una vez; otro ID no duplica instalacion',()=>{
      const op=randomUUID(),payload={unitId:unit};
      const first=campoOp('assign',payload,tech,op),retry=campoOp('assign',payload,tech,op);
      assert.equal(first,retry);
      assert.equal(sql("select status||'|'||coalesce(custody_technician_id::text,'libre')||'|'||client_id||'|'||contract_id from inventory_units where id='"+unit+"'"),'assigned|libre|'+client+'|'+contract);
      assert.equal(sql("select count(*) from inventory_unit_events where unit_id='"+unit+"' and to_status='assigned'"),'1');
      assert.equal(sql("select count(*) from campo_inventory_operations where action='assign'"),'1');
      assert.equal(sql("select count(*) from inventory_units where id='"+unit+"' and status='with_technician'"),'0');
      assert.equal(sql("select count(*) from inventory_units where id='"+unit+"' and status='assigned'"),'1');
      assert.throws(()=>campoOp('assign',payload),/Equipo no disponible/);
      assert.equal(sql("select count(*) from inventory_unit_events where unit_id='"+unit+"' and to_status='assigned'"),'1');
      assert.equal(sql("select count(*) from inventory_movements"),'0');
      assert.equal(sql("select current_stock from inventory_products where id='"+tv+"'"),'100.00');
      assert.equal(sql("select status from installations where id='"+install+"'"),'in_progress');
    });
    await t.test('pending_return queda fuera y no permite instalar',()=>{
      reset();as("select deliver_unit_to_technician('"+unit+"','"+tech+"','x');",admin);
      as("select request_unit_return('"+unit+"','Devolver');");
      assert(!read().some((u:any)=>u.id===unit));
      assert.throws(()=>campoOp('assign',{unitId:unit}),/Equipo no disponible/);
    });
    await t.test('bodega libre se conserva; producto distinto y orden cerrada no habilitan',()=>{
      reset();assert(read().some((u:any)=>u.id===unit));assert.equal(read(tech,cable).length,0);
      campoOp('assign',{unitId:unit});
      sql("update installations set status='completed' where id='"+install+"'");
      assert.throws(()=>read(),/Estado de orden no autorizado/);
    });
    await t.test('rollback restaura exactamente la consulta original',()=>{
      sql(file('../../scripts/rollback-campo-available-custody.sql'));
      reset();as("select deliver_unit_to_technician('"+unit+"','"+tech+"','x');",admin);
      assert(!read().some((u:any)=>u.id===unit));
      sql(file('../../scripts/fix-campo-available-custody.sql'));
      assert(read().some((u:any)=>u.id===unit));
    });
  } finally { try { docker(['rm','-f',container]); } catch {} }
});
