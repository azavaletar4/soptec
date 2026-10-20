import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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

test('Fase 165 etapa 2 (cierre): entrega de materiales validada contra stock + idempotencia', { timeout: 180000 }, async t => {
  const container = `smartrayco-f165c-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  // Procesos psql independientes: no envolver execFileSync en Promise.all.
  const sqlAsync = (s: string) => new Promise<{ ok: boolean; output: string }>((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ ok: code === 0, output }));
    child.stdin.end(s);
  });
  const waitForSession = async (name: string, waitType: string) => {
    for (let i = 0; i < 60; i++) {
      if (sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='${waitType}';`) === '1') return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail(`No se observo la sesion ${name} esperando ${waitType}`);
  };
  const as = (s: string, uid = admin) => sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
  const deliver = (technicianId: string, productId: string, qty: number, opId = randomUUID(), uid = admin) =>
    as(`select public.deliver_material_to_technician('${opId}','${technicianId}','${productId}',${qty},'Entrega de prueba');`, uid);
  const custody = (technicianId: string, productId: string) =>
    sql(`select coalesce((select quantity from technician_material_custody where technician_id='${technicianId}' and product_id='${productId}'),0);`);
  const campoOp = (action: string, payload: object, uid = tech) =>
    as(`select public.campo_inventory_operation('${randomUUID()}','installation','${install}','${action}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb);`, uid);

  const reset = () => sql(`truncate public.material_delivery_operations,public.material_inventory_rejections,public.inventory_movements,
      public.campo_inventory_operations,public.technician_material_custody,public.technician_material_custody_events,
      public.job_assignees,public.installations restart identity cascade;
    update inventory_products set current_stock=100, is_active=true;
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

    // ---- Fase 165 etapa 2 (cierre): la migracion candidata bajo prueba ----
    sql(file('../../supabase/migrations/20261020120000_fase165_entrega_material_validada.sql'));

    await t.test('entrega valida dentro del stock se registra y queda disponible para consumir', () => {
      reset();
      deliver(tech, cable, 40);
      assert.equal(custody(tech, cable), '40');
      assert.equal(sql(`select count(*) from material_delivery_operations;`), '1');
      campoOp('consume', { productId: cable, quantity: 15, reason: 'x' });
      assert.equal(custody(tech, cable), '25'); // integracion: entrega -> custodia -> consumo real sigue funcionando junto
    });

    await t.test('una entrega que supera el stock de almacen se rechaza sin dejar nada a medias', () => {
      reset();
      assert.throws(() => deliver(tech, cable, 150), /supera el stock de almacén/);
      assert.equal(custody(tech, cable), '0');
      assert.equal(sql(`select count(*) from material_delivery_operations;`), '0');
      assert.equal(sql(`select count(*) from technician_material_custody_events;`), '0');
    });

    await t.test('el tope es sobre lo YA entregado a todos los tecnicos, no solo la entrega actual', () => {
      reset();
      deliver(tech, cable, 60);
      assert.throws(() => deliver(other, cable, 50), /supera el stock de almacén/); // 60+50=110 > 100
      assert.equal(custody(other, cable), '0'); // rechazo total, no se aplico nada
      deliver(other, cable, 40); // 60+40=100, exacto, si alcanza
      assert.equal(custody(other, cable), '40');
    });

    await t.test('reintento real (mismo operation_id, mismos datos) no duplica la entrega', () => {
      reset();
      const opId = randomUUID();
      deliver(tech, cable, 30, opId);
      deliver(tech, cable, 30, opId); // reintento, mismos datos
      assert.equal(custody(tech, cable), '30'); // UNA sola vez
      assert.equal(sql(`select count(*) from technician_material_custody_events;`), '1');
      assert.equal(sql(`select count(*) from material_delivery_operations;`), '1');
    });

    await t.test('el mismo operation_id con datos distintos se rechaza, nunca se reinterpreta como la misma entrega', () => {
      reset();
      const opId = randomUUID();
      deliver(tech, cable, 30, opId);
      assert.throws(() => deliver(tech, cable, 31, opId), /Identificador de operacion ya utilizado/);
      assert.throws(() => deliver(other, cable, 30, opId), /Identificador de operacion ya utilizado/);
      assert.equal(custody(tech, cable), '30'); // la primera entrega real sigue intacta
      assert.equal(custody(other, cable), '0');
    });

    await t.test('una segunda entrega legitima (operation_id distinto, mismos técnico/producto/cantidad) SI se aplica', () => {
      reset();
      deliver(tech, cable, 10);
      deliver(tech, cable, 10); // otra operation_id (default), misma entrega "en el papel" -- es una reposicion nueva
      assert.equal(custody(tech, cable), '20');
      assert.equal(sql(`select count(*) from technician_material_custody_events;`), '2');
      assert.equal(sql(`select count(*) from material_delivery_operations;`), '2');
    });

    await t.test('solo administracion puede entregar, con la firma nueva', () => {
      reset();
      assert.throws(() => deliver(tech, cable, 10, randomUUID(), tech), /Solo administracion/);
    });

    await t.test('producto serializado o inactivo sigue bloqueado (regresion)', () => {
      reset();
      const serialized = '50000000-0000-0000-0000-000000000099';
      sql(`insert into inventory_products(id,name,unit,is_serialized) values('${serialized}','ONT','unidad',true);`);
      assert.throws(() => deliver(tech, serialized, 1), /Producto consumible activo requerido/);
      sql(`update inventory_products set is_active=false where id='${cable}';`);
      assert.throws(() => deliver(tech, cable, 1), /Producto consumible activo requerido/);
    });

    // ---- Concurrencia: dos entregas simultaneas del MISMO producto, cada una individualmente dentro del stock, juntas lo superan ----
    await t.test('dos entregas simultaneas del mismo producto: el total entregado nunca supera el stock (una pasa, la otra se rechaza)', async () => {
      reset();
      const deliverCall = (technicianId: string, qty: number) => `select public.deliver_material_to_technician('${randomUUID()}','${technicianId}','${cable}',${qty},'Entrega concurrente de prueba');`;
      const first = sqlAsync(`set application_name='f165c_first'; begin; set role authenticated; set request.jwt.claim.sub='${admin}'; ${deliverCall(tech, 60)} select pg_sleep(5); commit;`);
      await waitForSession('f165c_first', 'Timeout'); // entrega aplicada, transaccion aun abierta (fila de inventory_products bloqueada)
      const second = sqlAsync(`set application_name='f165c_second'; set role authenticated; set request.jwt.claim.sub='${admin}'; ${deliverCall(other, 60)}`);
      await waitForSession('f165c_second', 'Lock'); // evidencia real de que la segunda espera el lock de inventory_products
      const [a, b] = await Promise.all([first, second]);
      assert.equal(a.ok, true, a.output);
      assert.equal(b.ok, false, b.output); // 60 (ya entregado) + 60 (esta) = 120 > 100 -- debe rechazarse, no quedar a medias
      assert.match(b.output, /supera el stock de almacén/);
      assert.equal(Number(custody(tech, cable)), 60);
      assert.equal(Number(custody(other, cable)), 0);
      assert.equal(Number(sql(`select coalesce(sum(quantity),0) from technician_material_custody where product_id='${cable}';`)), 60);
      assert.equal(sql(`select count(*) from material_delivery_operations;`), '1');
      assert.equal(sql(`select count(*) from technician_material_custody_events;`), '1');
    });

    await t.test('version anterior (4 argumentos, sin operation_id ni validacion) ya no existe tras la migracion', () => {
      assert.throws(() => sql(`select public.deliver_material_to_technician('${tech}','${cable}',1,'x');`), /function public\.deliver_material_to_technician.* does not exist/i);
    });

    await t.test('rollback propuesto restaura la firma original y conserva el Kardex/custodia ya registrados', () => {
      reset();
      deliver(tech, cable, 10);
      campoOp('consume', { productId: cable, quantity: 4, reason: 'x' });
      const before = sql(`select json_build_object('events',(select count(*) from technician_material_custody_events),'movements',(select count(*) from inventory_movements),'custody',(select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}'));`);
      sql(file('../../scripts/rollback-material-delivery-validada.sql'));
      assert.equal(sql(`select json_build_object('events',(select count(*) from technician_material_custody_events),'movements',(select count(*) from inventory_movements),'custody',(select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}'));`), before);
      assert.equal(sql(`select to_regclass('public.material_delivery_operations') is null;`), 't');
      assert.equal(sql(`select to_regprocedure('public.deliver_material_to_technician(uuid,uuid,numeric,text)') is not null;`), 't');
      assert.equal(sql(`select to_regprocedure('public.deliver_material_to_technician(uuid,uuid,uuid,numeric,text)') is null;`), 't');
      // la version restaurada (4 argumentos, sin validar stock) vuelve a admitir una entrega que antes se hubiera rechazado
      as(`select public.deliver_material_to_technician('${tech}','${cable}',500,'x');`);
      assert.equal(Number(custody(tech, cable)), 506);
    });
  } finally { try { docker(['rm', '-f', container]); } catch {} }
});
