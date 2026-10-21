import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const admin = '00000000-0000-0000-0000-000000000002';
const superadmin = '00000000-0000-0000-0000-000000000001';
const tech = '00000000-0000-0000-0000-000000000003';
const other = '00000000-0000-0000-0000-000000000005';
const client = '30000000-0000-0000-0000-000000000001';
const contract = '31000000-0000-0000-0000-000000000001';
const install = '20000000-0000-0000-0000-000000000001';
const ticket = '40000000-0000-0000-0000-000000000001';
const routine = '10000000-0000-0000-0000-000000000165';
const cable = '50000000-0000-0000-0000-000000000012';
const patchcord = '50000000-0000-0000-0000-000000000014';

test('Fase 169: reintentar un consumo rechazado desde administracion -- debita la custodia del tecnico original, nunca la del admin', { timeout: 180000 }, async t => {
  const containerName = `smartrayco-f169-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', containerName, 'psql', '-h', '127.0.0.1', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  const as = (s: string, uid = tech) => {
    const out = sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
    if (out.startsWith('{')) { const result = JSON.parse(out); if (result.materialRejected || result.materialCancelled) throw new Error(result.message); }
    return out;
  };
  const campoOp = (action: string, payload: object, id: string, uid = tech) =>
    as(`select public.campo_inventory_operation('${id}','installation','${install}','${action}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb);`, uid);
  const ticketOp = (action: string, payload: object, id: string, uid = tech) =>
    as(`select public.campo_inventory_operation('${id}','ticket','${ticket}','${action}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb);`, uid);
  const routineOp = (payload: object, id: string, uid = tech) =>
    as(`select public.routine_inventory_operation('${routine}','${id}','consume','${JSON.stringify(payload).replaceAll("'", "''")}');`, uid);
  const deliver = (technicianId: string, productId: string, qty: number) =>
    as(`select public.deliver_material_to_technician('${technicianId}','${productId}',${qty},'Entrega de prueba');`, admin);
  const retry = (operationId: string, uid = admin) => as(`select public.retry_rejected_material_operation('${operationId}');`, uid);
  const rejectionStatus = (id: string) => sql(`select status from material_inventory_rejections where operation_id='${id}';`);
  const custody = (technicianId: string, productId: string) =>
    sql(`select coalesce((select quantity from technician_material_custody where technician_id='${technicianId}' and product_id='${productId}'),0);`);
  const close = () => sql(`update installations set status='completed' where id='${install}';`);

  const reset = () => sql(`truncate public.material_inventory_rejections,public.work_order_photos,public.work_order_closures,public.inventory_unit_events,public.inventory_movements,public.inventory_units,
      public.campo_inventory_operations,public.routine_inventory_operations,public.technician_material_custody,public.technician_material_custody_events,
      public.technician_material_return_requests,public.job_assignees,public.installations,public.tickets,public.routines;
    update inventory_products set current_stock=100;
    insert into installations(id,status,client_id,contract_id) values('${install}','in_progress','${client}','${contract}');
    insert into job_assignees values('installation','${install}','${tech}','leader');
    insert into tickets(id,status,client_id,contract_id) values('${ticket}','in_progress','${client}','${contract}');
    insert into job_assignees values('ticket','${ticket}','${tech}','leader');
    insert into routines(id,status,client_id,contract_id) values('${routine}','in_progress','${client}','${contract}');
    insert into job_assignees values('routine','${routine}','${tech}','leader');`);

  try {
    docker(['run', '--pull=never', '--rm', '-d', '--name', containerName, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) { try { docker(['exec', containerName, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready);

    sql(file('./closedOrdersSchema.sql'));
    sql(`alter table routines add column client_id uuid references clients(id), add column contract_id uuid;
      alter table installations add column client_id uuid references clients(id), add column contract_id uuid;
      alter table tickets add column client_id uuid references clients(id), add column contract_id uuid;
      alter table profiles add column full_name text, add column email text;
      alter table inventory_units add column pending_pickup_by uuid references profiles(id);
      alter table inventory_unit_events add column assigned_to uuid references profiles(id);
      create table service_contracts(id uuid primary key, client_id uuid references clients(id));
      insert into profiles values('${other}','TECNICO_RED',true);
      insert into service_contracts values('${contract}','${client}');
      insert into inventory_products(id,name,unit,is_serialized,category_id) values
        ('${cable}','Cable Drop','metros',false,null),('${patchcord}','Patchcord','unidad',false,null);
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
    sql(file('../../supabase/migrations/20261016020000_fase162_autorizacion_recibos.sql'));
    sql(`alter type public.inventory_unit_status add value 'with_technician';`);
    sql(`alter type public.inventory_unit_status add value 'pending_return';`);
    sql(file('../../supabase/migrations/20261017030000_fase164_custodia_tecnicos.sql'));
    sql(file('../../scripts/prepare-campo-installation-custody-only.sql').match(/CREATE OR REPLACE FUNCTION public\.campo_inventory_operation[\s\S]*?\$function\$\s*;/)![0]);
    sql(file('../../supabase/migrations/20261019160000_fase165_etapa2_custodia_obligatoria.sql'));
    sql(file('../../supabase/migrations/20260928000000_fase32_app_campo.sql').match(/create table public\.work_order_closures[\s\S]*?\n\);/)![0]);
    sql(file('../../supabase/migrations/20260928000000_fase32_app_campo.sql').match(/create table public\.work_order_photos[\s\S]*?\n\);/)![0]);
    sql(file('../../supabase/migrations/20261005020000_fase101_rutinas_mantenimiento.sql').match(/alter table public\.work_order_closures drop constraint work_order_closures_job_type_check;[\s\S]*?check \([\s\S]*?;/)![0]);
    sql('alter table public.work_order_closures alter column client_id drop not null;');
    sql(file('../../supabase/migrations/20261019170000_fase165_cierre_consumos_rechazados.sql'));
    sql(file('../../supabase/migrations/20261020130000_fase165_correccion_rechazo_definitivo.sql'));
    sql(file('../../supabase/migrations/20261021190000_fase166_materiales_no_bloquean_cierre.sql'));

    // ---- La migracion candidata bajo prueba ----
    sql(file('../../supabase/migrations/20261021220000_fase169_reintentar_consumo_rechazado.sql'));

    await t.test('caso real reproducido: custodia 0, rechazo pending, luego el tecnico recibe custodia -- admin reintenta y resuelve, debitando SU custodia (del tecnico), no la del admin', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('kit', { items: [{ productId: patchcord, quantity: 1 }], reason: 'Kit base de Alta desde Campo' }, id),
        /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      deliver(tech, patchcord, 1); // el tecnico recibe la custodia que le faltaba
      const result = JSON.parse(retry(id, admin));
      assert.ok(result.ids?.length);
      assert.equal(rejectionStatus(id), 'resolved');
      assert.equal(custody(tech, patchcord), '0'); // se debito del TECNICO
      assert.equal(sql(`select count(*) from inventory_movements where product_id='${patchcord}';`), '1');
      assert.equal(sql(`select created_by from inventory_movements where product_id='${patchcord}';`), admin); // Kardex: quien lo ejecuto realmente
      assert.equal(sql(`select technician_id from technician_material_custody_events where event_type='consumption' and product_id='${patchcord}';`), tech); // custodia: de quien fue el intento real
    });

    await t.test('reintento SIN custodia suficiente: falla, sigue pending, no deja movimientos a medias', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id), /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      assert.throws(() => retry(id, admin), /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
      assert.equal(sql('select count(*) from technician_material_custody_events;'), '0');
    });

    await t.test('kit con 2 productos: si SOLO uno tiene custodia suficiente, el reintento falla completo -- no deja el otro aplicado a medias', () => {
      reset();
      deliver(tech, patchcord, 1); // suficiente para patchcord, nada para cable
      const id = randomUUID();
      assert.throws(() => campoOp('kit', { items: [{ productId: patchcord, quantity: 1 }, { productId: cable, quantity: 1 }], reason: 'Kit base de Alta desde Campo' }, id));
      assert.equal(rejectionStatus(id), 'pending');
      assert.throws(() => retry(id, admin), /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      assert.equal(sql('select count(*) from inventory_movements;'), '0'); // ni siquiera el patchcord quedo aplicado
      assert.equal(custody(tech, patchcord), '1'); // su custodia sigue intacta, nada se debito
    });

    await t.test('orden ya COMPLETADA: el reintento administrativo falla, no se puede alterar una Alta ya cerrada', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      close(); // Fase 166: cierra igual, aunque el rechazo siga pending
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
      deliver(tech, cable, 5); // aunque ahora SI tenga custodia...
      assert.throws(() => retry(id, admin), /no admite nuevas operaciones/);
      assert.equal(rejectionStatus(id), 'pending'); // conservado tal cual, en historial
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
    });

    await t.test('ya RESUELTO o CANCELADO: un segundo reintento (o doble click) nunca duplica el movimiento', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      deliver(tech, cable, 5);
      retry(id, admin);
      assert.equal(rejectionStatus(id), 'resolved');
      assert.throws(() => retry(id, admin), /ya fue resuelto o anulado/);
      assert.equal(sql('select count(*) from inventory_movements;'), '1'); // nunca 2
    });

    await t.test('intento ANULADO (cancelado antes): el reintento ya no aplica, mensaje claro', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      as(`select cancel_rejected_material_operation('${id}','Se confirmo que no se uso ese material');`, admin);
      assert.equal(rejectionStatus(id), 'cancelled');
      assert.throws(() => retry(id, admin), /ya fue resuelto o anulado/);
    });

    await t.test('permisos: TECNICO_RED no puede usar el reintento administrativo (aunque sea su propio intento)', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      deliver(tech, cable, 5);
      assert.throws(() => retry(id, tech), /Solo administracion puede reintentar/);
      assert.equal(rejectionStatus(id), 'pending');
    });

    await t.test('permisos: SUPERADMIN tambien puede reintentar (no solo ADMIN)', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      deliver(tech, cable, 5);
      const result = JSON.parse(retry(id, superadmin));
      assert.ok(result.ids?.length);
      assert.equal(rejectionStatus(id), 'resolved');
    });

    await t.test('Averia (ticket): mismo criterio, mismo reintento administrativo', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => ticketOp('consume', { productId: cable, quantity: 1 }, id));
      deliver(tech, cable, 3);
      const result = JSON.parse(retry(id, admin));
      assert.ok(result.ids?.length);
      assert.equal(rejectionStatus(id), 'resolved');
      assert.equal(custody(tech, cable), '2');
    });

    await t.test('Rutina: reintento administrativo NO disponible todavia (mensaje claro, no silencioso)', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => routineOp({ product_id: cable, quantity: 1 }, id));
      deliver(tech, cable, 5);
      assert.throws(() => retry(id, admin), /Rutinas no esta disponible/);
      assert.equal(rejectionStatus(id), 'pending');
    });

    await t.test('rollback propuesto elimina la funcion sin tocar ninguna fila existente', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      deliver(tech, cable, 5);
      retry(id, admin);
      const before = sql(`select json_build_object('rejections',(select json_agg(x) from (select operation_id,status,resolved_by,resolution_note from material_inventory_rejections order by operation_id) x),'movements',(select count(*) from inventory_movements),'custody',(select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}'));`);
      sql(file('../../scripts/rollback-fase169-reintentar-consumo-rechazado.sql'));
      assert.equal(sql(`select json_build_object('rejections',(select json_agg(x) from (select operation_id,status,resolved_by,resolution_note from material_inventory_rejections order by operation_id) x),'movements',(select count(*) from inventory_movements),'custody',(select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}'));`), before);
      assert.equal(sql("select to_regprocedure('public.retry_rejected_material_operation(uuid)') is null;"), 't');
    });
  } finally { try { docker(['rm', '-f', containerName]); } catch {} }
});
