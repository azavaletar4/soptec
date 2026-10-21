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
const otherInstall = '20000000-0000-0000-0000-000000000099';
const ticket = '40000000-0000-0000-0000-000000000001';
const cable = '50000000-0000-0000-0000-000000000012';
const patchcord = '50000000-0000-0000-0000-000000000014';

test('Fase 166: un rechazo de material NO serializado pendiente deja de bloquear el cierre (regla operativa aprobada, caso real Diego Villanueva Bernabe CTR-2026-00727)', { timeout: 180000 }, async t => {
  const containerName = `smartrayco-f166-${process.pid}-${Date.now()}`;
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
  const closeTicket = () => sql(`update tickets set status='resolved' where id='${ticket}';`);
  const deliver = (technicianId: string, productId: string, qty: number) =>
    as(`select public.deliver_material_to_technician('${technicianId}','${productId}',${qty},'Entrega de prueba');`, admin);
  const rejectionStatus = (id: string) => sql(`select status from material_inventory_rejections where operation_id='${id}';`);
  const close = () => sql(`update installations set status='completed' where id='${install}';`);

  const reset = () => sql(`truncate public.material_inventory_rejections,public.work_order_photos,public.work_order_closures,public.inventory_unit_events,public.inventory_movements,public.inventory_units,
      public.campo_inventory_operations,public.technician_material_custody,public.technician_material_custody_events,
      public.technician_material_return_requests,public.job_assignees,public.installations,public.tickets;
    update inventory_products set current_stock=100;
    insert into installations(id,status,client_id,contract_id) values('${install}','in_progress','${client}','${contract}');
    insert into job_assignees values('installation','${install}','${tech}','leader');
    insert into tickets(id,status,client_id,contract_id) values('${ticket}','in_progress','${client}','${contract}');
    insert into job_assignees values('ticket','${ticket}','${tech}','leader');`);

  try {
    docker(['run', '--pull=never', '--rm', '-d', '--name', containerName, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) { try { docker(['exec', containerName, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready);

    // ---- Mismo harness de materialRejectionCorrection.sql.test.ts, hasta las migraciones candidatas ya certificadas ----
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

    // ---- La migracion candidata bajo prueba ----
    sql(file('../../supabase/migrations/20261021190000_fase166_materiales_no_bloquean_cierre.sql'));

    await t.test('caso real reproducido: un rechazo pendiente con un operation_id DISTINTO al de los consumos posteriores ya no bloquea el cierre', () => {
      reset();
      // Primer intento del kit: custodia insuficiente -> rechazo confirmado, pending.
      const rejectedId = randomUUID();
      assert.throws(() => campoOp('kit', { items: [{ productId: patchcord, quantity: 1 }], reason: 'Kit base de Alta desde Campo' }, rejectedId),
        /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(rejectedId), 'pending');
      // El tecnico recibe custodia y reintenta con un operation_id NUEVO (no corrige la fila original) -- exactamente lo que paso en campo.
      deliver(tech, patchcord, 1);
      const newId = randomUUID();
      const applied = JSON.parse(campoOp('kit', { items: [{ productId: patchcord, quantity: 1 }], reason: 'Kit base de Alta desde Campo' }, newId));
      assert.ok(applied.ids?.length);
      // La fila original SIGUE pending (no se resuelve ni se anula sola) -- se conserva para advertencia/revision administrativa.
      assert.equal(rejectionStatus(rejectedId), 'pending');
      // Antes de Fase 166 esto bloqueaba el cierre (ver materialRejectionCorrection.sql.test.ts). Ahora ya NO bloquea.
      close();
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
    });

    await t.test('un rechazo pendiente nunca corregido tampoco bloquea el cierre de una Averia (ticket)', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => ticketOp('consume', { productId: cable, quantity: 1 }, id), /No tienes suficiente material en custodia/);
      assert.equal(rejectionStatus(id), 'pending');
      closeTicket();
      assert.equal(sql(`select status from tickets where id='${ticket}';`), 'resolved');
      assert.equal(rejectionStatus(id), 'pending'); // sigue pendiente de revision administrativa, solo deja de bloquear
    });

    await t.test('el rechazo sigue quedando registrado y anulable por administracion despues del cierre (advertencia conservada, nunca silenciada)', () => {
      reset();
      const id = randomUUID();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 1 }, id));
      close();
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
      assert.equal(rejectionStatus(id), 'pending');
      as(`select cancel_rejected_material_operation('${id}','Revisado tras el cierre: no se usó ese material');`, admin);
      assert.equal(rejectionStatus(id), 'cancelled');
    });

    await t.test('sin ningun rechazo pendiente, el cierre sigue funcionando exactamente igual que antes (sin regresion)', () => {
      reset();
      deliver(tech, cable, 5);
      campoOp('consume', { productId: cable, quantity: 3 }, randomUUID());
      close();
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
    });

    await t.test('rollback propuesto restaura el bloqueo exacto de Fase 165 etapa 2 sin tocar filas existentes', () => {
      reset();
      const idResolved = randomUUID();
      deliver(tech, cable, 1);
      try { campoOp('consume', { productId: cable, quantity: 2 }, idResolved); } catch { /* rechazo esperado */ }
      campoOp('consume', { productId: cable, quantity: 1 }, idResolved); // corregido con la MISMA clave -> resolved
      const idPending = randomUUID();
      try { campoOp('consume', { productId: cable, quantity: 5 }, idPending); } catch { /* queda pending a proposito */ }
      close(); // bajo Fase 166, no bloquea aunque haya un pending
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
      const before = sql(`select json_build_object('rejections',(select json_agg(x) from (select operation_id,status,payload from material_inventory_rejections order by operation_id) x));`);
      sql(file('../../scripts/rollback-fase166-materiales-no-bloquean-cierre.sql'));
      assert.equal(sql(`select json_build_object('rejections',(select json_agg(x) from (select operation_id,status,payload from material_inventory_rejections order by operation_id) x));`), before);
      // Tras revertir, un rechazo pending vuelve a bloquear cualquier cierre nuevo.
      sql(`update installations set status='in_progress' where id='${install}';`);
      assert.throws(close, /No se puede cerrar la orden/);
    });
  } finally { try { docker(['rm', '-f', containerName]); } catch {} }
});
