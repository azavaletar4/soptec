import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const admin = '00000000-0000-0000-0000-000000000002';
const tech = '00000000-0000-0000-0000-000000000003';
const client = '30000000-0000-0000-0000-000000000001';
const contract = '31000000-0000-0000-0000-000000000001';
const install = '20000000-0000-0000-0000-000000000001';
const cable = '50000000-0000-0000-0000-000000000012';

// Valida la candidata local 20261101130000_registrar_fallos_material_no_custodia.sql:
// registra en auditoria cualquier rechazo de validacion (22023), ademas del ya
// existente por custodia insuficiente (P1650), SIN tocar saldos/custodia/ordenes
// y SIN bloquear el cierre (Fase 166 sigue intacta) ni duplicar filas en reintentos.
test('Candidata 20261101130000: rechazos de validacion (22023) quedan auditables sin tocar saldos ni bloquear cierre', { timeout: 180000 }, async t => {
  const container = `smartrayco-f165val-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  // A diferencia del helper `as()` de otras suites, este NO lanza en materialRejected:
  // estas pruebas necesitan inspeccionar la respuesta de rechazo, no solo el camino feliz.
  const asRaw = (s: string, uid = tech) => sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
  const consume = (opId: string, productId: string, quantity: number, uid = tech) =>
    asRaw(`select public.campo_inventory_operation('${opId}','installation','${install}','consume','${JSON.stringify({ productId, quantity }).replaceAll("'", "''")}'::jsonb);`, uid);
  const custody = (technicianId: string, productId: string) =>
    sql(`select coalesce((select quantity from technician_material_custody where technician_id='${technicianId}' and product_id='${productId}'),0);`);
  const deliver = (technicianId: string, productId: string, qty: number) =>
    asRaw(`select public.deliver_material_to_technician('${technicianId}','${productId}',${qty},'Entrega de prueba');`, admin);
  const rejectionRow = (id: string) => sql(`select status||'|'||coalesce(sqlstate_code,'')||'|'||message from material_inventory_rejections where operation_id='${id}';`);
  const rejectionCount = (id: string) => sql(`select count(*) from material_inventory_rejections where operation_id='${id}';`);
  const movementCount = () => sql(`select count(*) from inventory_movements where installation_id='${install}';`);
  const custodyEventCount = () => sql(`select count(*) from technician_material_custody_events;`);

  const reset = () => sql(`truncate public.material_inventory_rejections,public.work_order_photos,public.work_order_closures,public.inventory_unit_events,public.inventory_movements,public.inventory_units,
      public.campo_inventory_operations,public.technician_material_custody,public.technician_material_custody_events,
      public.technician_material_return_requests,public.job_assignees,public.installations,public.tickets;
    update inventory_products set current_stock=100;
    insert into installations(id,status,client_id,contract_id) values('${install}','in_progress','${client}','${contract}');
    insert into job_assignees values('installation','${install}','${tech}','leader');`);

  try {
    docker(['run', '--pull=never', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) { try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready);

    // ---- Mismo harness probado en materialRejectionCorrection.sql.test.ts, hasta la version real en produccion ----
    sql(file('./closedOrdersSchema.sql'));
    sql(`alter table routines add column client_id uuid references clients(id), add column contract_id uuid;
      alter table installations add column client_id uuid references clients(id), add column contract_id uuid;
      alter table tickets add column client_id uuid references clients(id), add column contract_id uuid;
      alter table profiles add column full_name text, add column email text;
      alter table inventory_units add column pending_pickup_by uuid references profiles(id);
      alter table inventory_unit_events add column assigned_to uuid references profiles(id);
      create table service_contracts(id uuid primary key, client_id uuid references clients(id));
      insert into service_contracts values('${contract}','${client}');
      insert into inventory_products(id,name,unit,is_serialized,category_id) values('${cable}','Cable Drop','metros',false,null);
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
    sql(file('../../supabase/migrations/20261101130000_registrar_fallos_material_no_custodia.sql'));

    await t.test('cantidad invalida (22023): se audita, no toca Kardex/custodia, y el cierre NO queda bloqueado (Fase 166 intacta)', () => {
      reset();
      const opId = randomUUID();
      const out = JSON.parse(consume(opId, cable, -5));
      assert.equal(out.materialRejected, true);
      assert.match(out.message, /Cantidad inválida/);
      const [status, code] = rejectionRow(opId).split('|');
      assert.equal(status, 'pending'); assert.equal(code, '22023');
      assert.equal(movementCount(), '0');
      assert.equal(custodyEventCount(), '0');
      assert.equal(custody(tech, cable), '0');
      // Fase 166: un rechazo pendiente NO bloquea el cierre (sin tocar esa regla).
      sql(`update installations set status='completed' where id='${install}';`);
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
    });

    await t.test('reintento con la MISMA clave y cantidad corregida: resuelve, sin duplicar fila, descuenta custodia real', () => {
      reset();
      deliver(tech, cable, 10);
      const opId = randomUUID();
      const bad = JSON.parse(consume(opId, cable, -5));
      assert.equal(bad.materialRejected, true);
      assert.equal(rejectionCount(opId), '1');
      const good = JSON.parse(consume(opId, cable, 5));
      assert.ok(Array.isArray(good.ids));
      assert.equal(rejectionCount(opId), '1'); // misma fila, no duplicada
      const [status] = rejectionRow(opId).split('|');
      assert.equal(status, 'resolved');
      assert.equal(custody(tech, cable), '5');
      assert.equal(movementCount(), '1');
    });

    await t.test('reintento con la MISMA clave y OTRA cantidad igualmente invalida: no duplica, actualiza mensaje', () => {
      reset();
      const opId = randomUUID();
      consume(opId, cable, -5);
      const again = JSON.parse(consume(opId, cable, -8));
      assert.equal(again.materialRejected, true);
      assert.equal(rejectionCount(opId), '1');
      const [status, code] = rejectionRow(opId).split('|');
      assert.equal(status, 'pending'); assert.equal(code, '22023');
    });

    await t.test('rechazo por PERMISOS (42501, orden ya cerrada) NO se audita como material -- sigue siendo un error visible distinto', () => {
      reset();
      sql(`update installations set status='completed' where id='${install}';`);
      const opId = randomUUID();
      assert.throws(() => consume(opId, cable, 5), /La orden no admite nuevas operaciones/);
      assert.equal(rejectionCount(opId), '0');
      assert.equal(movementCount(), '0');
    });

    await t.test('P1650 (custodia insuficiente) sin regresion: mismo comportamiento que antes de esta candidata', () => {
      reset();
      const opId = randomUUID();
      const out = JSON.parse(consume(opId, cable, 5));
      assert.equal(out.materialRejected, true);
      assert.match(out.message, /custodia/);
      const [status, code] = rejectionRow(opId).split('|');
      assert.equal(status, 'pending'); assert.equal(code, 'P1650');
      deliver(tech, cable, 5);
      const resolved = JSON.parse(consume(opId, cable, 5));
      assert.ok(Array.isArray(resolved.ids));
      assert.equal(rejectionCount(opId), '1');
    });

    await t.test('replay EXACTO (misma clave, mismo payload) de un rechazo ya resuelto no reaplica el movimiento', () => {
      reset();
      deliver(tech, cable, 10);
      const opId = randomUUID();
      consume(opId, cable, 5);
      assert.equal(custody(tech, cable), '5');
      assert.equal(movementCount(), '1');
      const replay = JSON.parse(consume(opId, cable, 5));
      assert.ok(Array.isArray(replay.ids));
      assert.equal(custody(tech, cable), '5'); // sin segundo descuento
      assert.equal(movementCount(), '1');
    });

    await t.test('rollback especifico restaura exactamente el comportamiento anterior (hash y conducta)', () => {
      reset();
      sql(file('../../scripts/rollback-registrar-fallos-material-no-custodia.sql'));
      const hash = sql("select md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g')) from pg_proc where oid=to_regprocedure('public.execute_tracked_material_inventory(uuid,text,uuid,text,jsonb)');");
      assert.equal(hash, '489ac54e4a248fb191605274d683d452');
      // Tras el rollback, un 22023 ya NO se audita (vuelve al comportamiento anterior: propaga el error tal cual).
      const opId = randomUUID();
      assert.throws(() => consume(opId, cable, -5), /Cantidad inválida/);
      assert.equal(rejectionCount(opId), '0');
      // P1650 sigue intacto (nunca lo tocó ni la candidata ni el rollback).
      const opId2 = randomUUID();
      const out = JSON.parse(consume(opId2, cable, 5));
      assert.equal(out.materialRejected, true);
    });
  } finally {
    try { docker(['rm', '-f', container]); } catch { /* best effort */ }
  }
});
