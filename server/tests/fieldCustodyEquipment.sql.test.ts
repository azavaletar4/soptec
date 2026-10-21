import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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

test('Averias/Rutinas: equipos de custodia propia y cuadrilla', { timeout: 180000 }, async t => {
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
    sql(file('../../scripts/prepare-campo-installation-custody-only.sql'));
    sql('alter table tickets add column client_id uuid,add column contract_id uuid;');
    for(const job of ['ticket','routine'] as const)await t.test(job+': RPC propia, ajena y bodega; validacion e idempotencia de equipo',()=>{
      reset();
      const order=job==='ticket'?install:routine;
      if(job==='ticket')sql("insert into tickets(id,status,client_id,contract_id) values('"+order+"','in_progress','"+client+"','"+contract+"');");
      sql("insert into job_assignees values('"+job+"','"+order+"','"+other+"','leader'),('"+job+"','"+order+"','"+tech+"','support');");
      const foreign='60000000-0000-0000-0000-000000000012',warehouse='60000000-0000-0000-0000-000000000013';
      sql("insert into inventory_units(id,product_id,serial_number) values('"+foreign+"','"+tv+"','FOREIGN'),('"+warehouse+"','"+tv+"','WAREHOUSE');");
      as("select deliver_unit_to_technician('"+unit+"','"+tech+"','x');",admin);
      as("select deliver_unit_to_technician('"+foreign+"','"+other+"','x');",admin);
      const mine=JSON.parse(as('select my_inventory_custody();'));
      const theirs=JSON.parse(as('select my_inventory_custody();',other));
      assert.deepEqual(mine.units.map((u:any)=>u.id),[unit]);assert.deepEqual(theirs.units.map((u:any)=>u.id),[foreign]);
      const operation=randomUUID();
      const op=(unitId:string,actor=tech,id=randomUUID())=>job==='ticket'
        ? as("select campo_inventory_operation('"+id+"','ticket','"+order+"','stage','"+JSON.stringify({unitId})+"');",actor)
        : as("select routine_inventory_operation('"+order+"','"+id+"','install','"+JSON.stringify({unit_id:unitId,contract_id:contract,reason:'Prueba aislada'})+"');",actor);
      assert.throws(()=>op(foreign),/no disponible|custodia/i);
      assert.throws(()=>op(unit,other),/no disponible|custodia/i);
      const first=op(unit,tech,operation);assert.equal(op(unit,tech,operation),first);
      assert.equal(sql("select status from inventory_units where id='"+unit+"'"),'pending_approval');
      assert.equal(sql("select count(*) from inventory_unit_events where unit_id='"+unit+"' and to_status='pending_approval'"),'1');
      assert(!JSON.parse(as('select my_inventory_custody();')).units.some((u:any)=>u.id===unit));
      assert.equal(sql('select count(*) from inventory_movements'),'0');
      assert.equal(sql("select status from inventory_units where id='"+warehouse+"'"),'in_stock');
    });
  } finally { try { docker(['rm','-f',container]); } catch {} }
});
