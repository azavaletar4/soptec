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
const cable = '50000000-0000-0000-0000-000000000012';

test('Fase 165 etapa 2 (cierre, parte 2): corregir un rechazo confirmado reutiliza la clave y deja de bloquear el cierre', { timeout: 180000 }, async t => {
  const container = `smartrayco-f165r-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  const as = (s: string, uid = tech) => {
    const out = sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
    if (out.startsWith('{')) { const result = JSON.parse(out); if (result.materialRejected || result.materialCancelled) throw new Error(result.message); }
    return out;
  };
  const campoOp = (action: string, payload: object, id: string, uid = tech) =>
    as(`select public.campo_inventory_operation('${id}','installation','${install}','${action}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb);`, uid);
  const custody = (technicianId: string, productId: string) =>
    sql(`select coalesce((select quantity from technician_material_custody where technician_id='${technicianId}' and product_id='${productId}'),0);`);
  const deliver = (technicianId: string, productId: string, qty: number) =>
    as(`select public.deliver_material_to_technician('${technicianId}','${productId}',${qty},'Entrega de prueba');`, admin);
  const rejectionStatus = (id: string) => sql(`select status from material_inventory_rejections where operation_id='${id}';`);
  const rejectionPayload = (id: string) => sql(`select payload::text from material_inventory_rejections where operation_id='${id}';`);
  const close = () => sql(`update installations set status='completed' where id='${install}';`);

  const reset = () => sql(`truncate public.material_inventory_rejections,public.work_order_photos,public.work_order_closures,public.inventory_unit_events,public.inventory_movements,public.inventory_units,
      public.campo_inventory_operations,public.technician_material_custody,public.technician_material_custody_events,
      public.technician_material_return_requests,public.job_assignees,public.installations;
    update inventory_products set current_stock=100;
    insert into installations(id,status,client_id,contract_id) values('${install}','in_progress','${client}','${contract}');
    insert into job_assignees values('installation','${install}','${tech}','leader');`);

  try {
    docker(['run', '--pull=never', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) { try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready);

    // ---- Mismo harness probado en custodyRequiredMaterials.sql.test.ts, hasta las 2 migraciones candidatas ya certificadas ----
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
        ('${cable}','Cable Drop','metros',false,null);
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

    // ---- La migracion candidata bajo prueba ----
    sql(file('../../supabase/migrations/20261020130000_fase165_correccion_rechazo_definitivo.sql'));

    await t.test('rechazo 2 contra 1: custodia insuficiente deja la fila pending, sin movimientos (confirmado, nunca incierto)', () => {
      reset();
      deliver(tech, cable, 1);
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 2 }, id), /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
      assert.equal(custody(tech, cable), '1');
    });

    await t.test('corrección a 1 con la MISMA clave: se aplica, la fila pasa a resolved, y el cierre ya no está bloqueado', () => {
      reset();
      deliver(tech, cable, 1);
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 2 }, id));
      assert.throws(close, /No se puede cerrar la orden/); // bloqueado mientras el rechazo sigue pending
      const corrected = JSON.parse(campoOp('consume', { productId: cable, quantity: 1 }, id)); // MISMA clave, cantidad corregida
      assert.ok(corrected.ids?.length);
      assert.equal(rejectionStatus(id), 'resolved');
      assert.equal(JSON.parse(rejectionPayload(id)).quantity, 1); // la auditoría refleja lo que realmente se aplicó
      assert.equal(custody(tech, cable), '0'); // 1 entregado - 1 corregido y aplicado
      assert.equal(sql('select count(*) from inventory_movements;'), '1');
      close(); // ya NO bloqueado -- sin anulación ni intervención administrativa
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
    });

    await t.test('rechazo NO corregido: sigue pending y el cierre sigue bloqueado (sin cambios, regresión del diseño original)', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id), /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      assert.throws(close, /No se puede cerrar la orden/);
      assert.equal(sql(`select status from installations where id='${install}';`), 'in_progress');
    });

    await t.test('operación ya RESUELTA (no incierta, resultado definitivo): un payload distinto con la misma clave se rechaza, nunca se reinterpreta', () => {
      reset();
      deliver(tech, cable, 5);
      const id = randomUUID();
      campoOp('consume', { productId: cable, quantity: 3 }, id);
      assert.equal(rejectionStatus(id), ''); // nunca hubo rechazo: exito directo, sin fila
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id), /Identificador de operaci.n ya utilizado/);
      assert.equal(custody(tech, cable), '2'); // el intento de reinterpretar no tocó nada
      assert.equal(sql('select count(*) from inventory_movements;'), '1');
    });

    await t.test('operación CANCELADA por administración (no incierta): un payload distinto con la misma clave también se rechaza', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      as(`select cancel_rejected_material_operation('${id}','Se confirmó que no se usó material');`, admin);
      assert.equal(rejectionStatus(id), 'cancelled');
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id), /anulo este intento/);
      deliver(tech, cable, 5);
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 2 }, id), /Identificador de operaci.n ya utilizado/);
      assert.equal(custody(tech, cable), '5'); // nada se tocó: una vez cancelada, ni el payload original ni uno nuevo revive esa clave
    });

    await t.test('reintentos duplicados: la MISMA corrección enviada dos veces no aplica el consumo dos veces', () => {
      reset();
      deliver(tech, cable, 1);
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 2 }, id));
      campoOp('consume', { productId: cable, quantity: 1 }, id); // corrección real
      campoOp('consume', { productId: cable, quantity: 1 }, id); // reintento duplicado, misma clave y mismo payload corregido
      assert.equal(custody(tech, cable), '0');
      assert.equal(sql('select count(*) from inventory_movements;'), '1');
      assert.equal(sql('select count(*) from technician_material_custody_events where event_type=\'consumption\';'), '1');
    });

    await t.test('operación realmente incierta (nunca llegó a existir la fila): un reintento con otra cantidad bajo la MISMA clave antes de cualquier respuesta sigue exigiendo el payload original', () => {
      // No hay un "estado incierto" en el servidor -- la incertidumbre vive
      // en el cliente mientras no recibe respuesta. Aquí se simula el caso
      // límite real: la operación YA SE APLICÓ (recibo real en
      // campo_inventory_operations) pero nunca generó un rechazo, así que
      // myInventoryRejections no tiene fila -- reintentarla con otra
      // cantidad bajo la misma clave debe seguir exigiendo el payload
      // original, exactamente igual que antes de esta migración.
      reset();
      deliver(tech, cable, 5);
      const id = randomUUID();
      const first = JSON.parse(campoOp('consume', { productId: cable, quantity: 2 }, id));
      const again = JSON.parse(campoOp('consume', { productId: cable, quantity: 2 }, id)); // reintento real, misma clave y mismo payload -> recibo cacheado, no duplica
      assert.deepEqual(first.ids, again.ids);
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 3 }, id), /Identificador de operaci.n ya utilizado/);
      assert.equal(custody(tech, cable), '3');
      assert.equal(sql('select count(*) from inventory_movements;'), '1');
    });

    await t.test('corrección real desde una Rutina (mismo criterio, misma funcion compartida)', () => {
      const routine = '10000000-0000-0000-0000-000000000165';
      sql(`truncate public.material_inventory_rejections,public.routine_inventory_operations,public.inventory_movements,
          public.technician_material_custody,public.technician_material_custody_events,public.routines,public.job_assignees restart identity cascade;
        update inventory_products set current_stock=100;
        insert into routines(id,status,client_id,contract_id) values('${routine}','in_progress','${client}','${contract}');
        insert into job_assignees values('routine','${routine}','${tech}','leader');`);
      deliver(tech, cable, 1);
      const id = randomUUID();
      const routineOp = (qty: number) => as(`select public.routine_inventory_operation('${routine}','${id}','consume','${JSON.stringify({ product_id: cable, quantity: qty })}');`);
      assert.throws(() => routineOp(2), /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      routineOp(1); // corrección real, misma clave
      assert.equal(rejectionStatus(id), 'resolved');
      assert.equal(custody(tech, cable), '0');
    });

    await t.test('rollback propuesto restaura la version anterior sin tocar las filas ya resueltas/pendientes', () => {
      reset();
      deliver(tech, cable, 1);
      const idResolved = randomUUID();
      try { campoOp('consume', { productId: cable, quantity: 2 }, idResolved); } catch { /* rechazo esperado */ }
      campoOp('consume', { productId: cable, quantity: 1 }, idResolved); // corregido y resuelto bajo la version nueva
      const idPending = randomUUID();
      try { campoOp('consume', { productId: cable, quantity: 5 }, idPending); } catch { /* queda pending a propósito */ }
      const before = sql(`select json_build_object('rejections',(select json_agg(x) from (select operation_id,status,payload from material_inventory_rejections order by operation_id) x),'custody',(select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}'));`);
      sql(file('../../scripts/rollback-material-rejection-correction.sql'));
      assert.equal(sql(`select json_build_object('rejections',(select json_agg(x) from (select operation_id,status,payload from material_inventory_rejections order by operation_id) x),'custody',(select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}'));`), before);
      // Tras revertir, la relajacion ya no existe: un payload distinto bajo el rechazo que seguia pending vuelve a exigirse idéntico.
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, idPending), /Identificador de operaci.n ya utilizado/);
    });
  } finally { try { docker(['rm', '-f', container]); } catch {} }
});
