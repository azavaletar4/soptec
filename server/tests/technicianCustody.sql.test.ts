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

test('Fase 164: custodia de equipos y materiales por tecnico', { timeout: 180000 }, async t => {
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

    // ---- Equipos serializados ----
    await t.test('admin entrega un equipo en bodega a un tecnico activo', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','Para instalacion de hoy');`, admin);
      assert.equal(sql(`select status||'|'||custody_technician_id from inventory_units where id='${unit}';`), `with_technician|${tech}`);
      assert.equal(sql(`select count(*) from inventory_unit_events where unit_id='${unit}' and to_status='with_technician';`), '1');
    });
    await t.test('tecnico no puede entregarse equipo a si mismo', () => {
      reset();
      assert.throws(() => as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, tech), /Solo administracion/);
    });
    await t.test('no se puede entregar un equipo que no esta en bodega (sin doble asignacion)', () => {
      reset();
      sql(`update inventory_units set status='assigned', client_id='${client}' where id='${unit}';`);
      assert.throws(() => as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin), /que este en bodega/);
    });
    await t.test('tecnico instala en una Alta un equipo que tenia en custodia (ruta ensanchada)', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      campoOp('assign', { unitId: unit, reason: 'Instalado en Alta' });
      assert.equal(sql(`select status||'|'||coalesce(custody_technician_id::text,'libre')||'|'||client_id from inventory_units where id='${unit}';`), `assigned|libre|${client}`);
    });
    await t.test('tecnico ajeno no puede instalar un equipo en custodia de otro', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      sql(`insert into job_assignees values('installation','${install}','${other}','support');`);
      assert.throws(() => campoOp('assign', { unitId: unit, reason: 'x' }, other), /Equipo no disponible/);
    });
    await t.test('tecnico solicita devolucion; solo administracion confirma la recepcion', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      as(`select public.request_unit_return('${unit}','No se uso, cliente cancelo');`, tech);
      assert.equal(sql(`select status from inventory_units where id='${unit}';`), 'pending_return');
      assert.throws(() => as(`select public.receive_unit_return('${unit}','in_stock',null);`, tech), /Solo administracion/);
      as(`select public.receive_unit_return('${unit}','in_stock',null);`, admin);
      assert.equal(sql(`select status||'|'||coalesce(custody_technician_id::text,'libre') from inventory_units where id='${unit}';`), 'in_stock|libre');
    });
    await t.test('tecnico ajeno no puede solicitar devolucion de un equipo que no es suyo', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      assert.throws(() => as(`select public.request_unit_return('${unit}','x');`, other), /no esta en tu custodia/);
    });
    await t.test('motivo obligatorio para solicitar devolucion', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      assert.throws(() => as(`select public.request_unit_return('${unit}','  ');`, tech), /motivo/);
    });

    // ---- Consumibles ----
    await t.test('entrega de material a tecnico NO descuenta el almacen central (entrega != consumo)', () => {
      reset();
      as(`select public.deliver_material_to_technician('${tech}','${cable}',50,'Para la semana');`, admin);
      assert.equal(sql(`select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}';`), '50');
      assert.equal(sql(`select current_stock from inventory_products where id='${cable}';`), '100.00');
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
    });
    await t.test('tecnico solicita devolucion de material; admin confirma y el saldo baja', () => {
      reset();
      as(`select public.deliver_material_to_technician('${tech}','${cable}',50,'x');`, admin);
      const reqId = as(`select public.request_material_return('${cable}',20,'Sobro de la orden');`, tech);
      as(`select public.confirm_material_return('${reqId}',true,null);`, admin);
      assert.equal(sql(`select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}';`), '30');
      assert.equal(sql(`select status from technician_material_return_requests where id='${reqId}';`), 'confirmed');
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
    });
    await t.test('devolucion rechazada no mueve el saldo', () => {
      reset();
      as(`select public.deliver_material_to_technician('${tech}','${cable}',50,'x');`, admin);
      const reqId = as(`select public.request_material_return('${cable}',20,'x');`, tech);
      as(`select public.confirm_material_return('${reqId}',false,'No corresponde');`, admin);
      assert.equal(sql(`select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}';`), '50');
      assert.equal(sql(`select status from technician_material_return_requests where id='${reqId}';`), 'rejected');
    });
    await t.test('no se puede solicitar devolver mas de lo que se tiene en custodia', () => {
      reset();
      as(`select public.deliver_material_to_technician('${tech}','${cable}',10,'x');`, admin);
      assert.throws(() => as(`select public.request_material_return('${cable}',20,'x');`, tech), /No tienes esa cantidad/);
    });

    // ---- RLS: tecnico solo ve lo propio ----
    await t.test('tecnico ve su propia custodia, no la de otro; admin ve todo', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      as(`select public.deliver_material_to_technician('${tech}','${cable}',10,'x');`, admin);
      assert.equal(as(`select count(*) from inventory_units where custody_technician_id='${tech}';`, tech), '1');
      assert.equal(as(`select count(*) from technician_material_custody where technician_id='${tech}';`, other), '0');
      assert.equal(as(`select count(*) from technician_material_custody where technician_id='${tech}';`, admin), '1');
    });
    await t.test('my_inventory_custody devuelve solo lo del tecnico que llama', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      as(`select public.deliver_material_to_technician('${tech}','${cable}',10,'x');`, admin);
      const result = JSON.parse(as('select public.my_inventory_custody();', tech));
      assert.equal(result.units.length, 1);
      assert.equal(result.materials.length, 1);
      const otherResult = JSON.parse(as('select public.my_inventory_custody();', other));
      assert.deepEqual(otherResult, { units: [], materials: [], pendingReturnRequests: [] });
    });
    await t.test('inventory_custody_summary es exclusivo de ADMIN/SUPERADMIN', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      assert.throws(() => as('select * from public.inventory_custody_summary();', tech), /exclusivo de ADMIN/);
      // 2 productos propios de este archivo + 2 ya insertados por el fixture compartido.
      const rows = as('select count(*) from public.inventory_custody_summary();', admin);
      assert.equal(rows, '4');
    });

    await t.test('tecnico instala en una Rutina un equipo que tenia en custodia (ruta ensanchada de Fase 162)', () => {
      reset();
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      sql(`insert into job_assignees values('routine','${routine}','${tech}','leader');`);
      as(`select public.routine_inventory_operation('${routine}','${randomUUID()}','install','{"unit_id":"${unit}"}'::jsonb);`, tech);
      assert.equal(sql(`select status||'|'||coalesce(custody_technician_id::text,'libre') from inventory_units where id='${unit}';`), 'pending_approval|libre');
    });

    // ---- Regresion: el flujo original (directo desde bodega) sigue igual ----
    await t.test('regresion: instalar directo desde bodega (sin custodia previa) sigue funcionando igual que antes', () => {
      reset();
      campoOp('assign', { unitId: unit, reason: 'Instalacion normal' });
      assert.equal(sql(`select status||'|'||client_id from inventory_units where id='${unit}';`), `assigned|${client}`);
    });
  } finally { try { docker(['rm', '-f', container]); } catch {} }
});
