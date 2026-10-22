import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { linkMaterialCorrections, detectMaterialCustodyShortfalls, type MaterialConsumptionMovementInput } from '../../src/lib/materialCustodyShortfall';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const admin = '00000000-0000-0000-0000-000000000002';
const tech = '00000000-0000-0000-0000-000000000003';
const other = '00000000-0000-0000-0000-000000000005';
const client = '30000000-0000-0000-0000-000000000001';
const contract = '31000000-0000-0000-0000-000000000001';
const install = '20000000-0000-0000-0000-000000000001';
const ticket = '21000000-0000-0000-0000-000000000001';
const routine = '10000000-0000-0000-0000-000000000165';
const cable = '50000000-0000-0000-0000-000000000012';
const patchcord = '50000000-0000-0000-0000-000000000014';

test('Fase 165 etapa 2: custodia obligatoria de materiales en consumo real', { timeout: 180000 }, async t => {
  const container = `smartrayco-f165e2-${process.pid}-${Date.now()}`;
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
  const as = (s: string, uid = tech) => {
    const out = sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
    if (out.startsWith('{')) { const result = JSON.parse(out); if (result.materialRejected || result.materialCancelled) throw new Error(result.message); }
    return out;
  };
  const campoOp = (action: string, payload: object, uid = tech, jobType: 'installation' | 'ticket' = 'installation', jobId = install, id = randomUUID()) =>
    as(`select public.campo_inventory_operation('${id}','${jobType}','${jobId}','${action}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb);`, uid);
  const routineOp = (action: string, payload: object, uid = tech, id = randomUUID()) =>
    as(`select public.routine_inventory_operation('${routine}','${id}','${action}','${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb);`, uid);
  const custody = (technicianId: string, productId: string) =>
    sql(`select coalesce((select quantity from technician_material_custody where technician_id='${technicianId}' and product_id='${productId}'),0);`);
  const deliver = (technicianId: string, productId: string, qty: number) =>
    as(`select public.deliver_material_to_technician('${technicianId}','${productId}',${qty},'Entrega de prueba');`, admin);

  const reset = () => sql(`truncate public.material_inventory_rejections,public.work_order_photos,public.work_order_closures,public.inventory_unit_events,public.inventory_movements,public.inventory_units,
      public.campo_inventory_operations,public.routine_inventory_operations,public.technician_material_custody,public.technician_material_custody_events,
      public.technician_material_return_requests,public.job_assignees,public.installations,public.routines,public.tickets;
    update inventory_products set current_stock=100;
    insert into installations(id,status,client_id,contract_id) values('${install}','in_progress','${client}','${contract}');
    insert into tickets(id,status,client_id,contract_id) values('${ticket}','in_progress','${client}','${contract}');
    insert into routines(id,status,client_id,contract_id) values('${routine}','in_progress','${client}','${contract}');
    insert into job_assignees values('installation','${install}','${tech}','leader');
    insert into job_assignees values('ticket','${ticket}','${tech}','leader');
    insert into job_assignees values('routine','${routine}','${tech}','leader'),('routine','${routine}','${other}','support');`);

  let legacyRoutineSQL = '';
  let candidateRoutineSQL = '';
  try {
    docker(['run', '--pull=never', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) { try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(ready);

    // ---- Mismo harness probado en technicianCustody.sql.test.ts, hasta Fase 164 ----
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
      alter table tickets enable row level security;
      create policy installations_test on installations for all to authenticated using(true) with check(true);
      create policy tickets_test on tickets for all to authenticated using(true) with check(true);`);
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
    // El candidato dba2c67 (17/10/2026, ver docs/CAMPO-CUSTODIA-ACTIVADA.md) se
    // aplico fuera de supabase/migrations/ (scripts/prepare-campo-installation-
    // custody-only.sql) y es la version REALMENTE vigente en produccion hoy —
    // sin cargar este fragmento, el guard de deriva de la migracion bajo
    // prueba no coincide con el MD5 real verificado en Cloud.
    sql(file('../../scripts/prepare-campo-installation-custody-only.sql').match(/CREATE OR REPLACE FUNCTION public\.campo_inventory_operation[\s\S]*?\$function\$\s*;/)![0]);

    // ---- Fase 165 etapa 2: la migracion bajo prueba ----
    await t.test('orden inverso de migraciones falla sin crear objetos ni activar guardas', () => {
      assert.throws(()=>sql(file('../../supabase/migrations/20261019170000_fase165_cierre_consumos_rechazados.sql')),/Fase 165 de custodia rastreada requerida/);
      assert.equal(sql("select to_regclass('public.material_inventory_rejections') is null;"),'t');
    });
    legacyRoutineSQL = sql("select pg_get_functiondef('public.routine_inventory_operation(uuid,uuid,text,jsonb)'::regprocedure);");
    sql(file('../../supabase/migrations/20261019160000_fase165_etapa2_custodia_obligatoria.sql'));
    sql(file('../../supabase/migrations/20260928000000_fase32_app_campo.sql').match(/create table public\.work_order_closures[\s\S]*?\n\);/)![0]);
    sql(file('../../supabase/migrations/20260928000000_fase32_app_campo.sql').match(/create table public\.work_order_photos[\s\S]*?\n\);/)![0]);
    sql(file('../../supabase/migrations/20261005020000_fase101_rutinas_mantenimiento.sql').match(/alter table public\.work_order_closures drop constraint work_order_closures_job_type_check;[\s\S]*?check \([\s\S]*?;/)![0]);
    sql('alter table public.work_order_closures alter column client_id drop not null;'); // Fase 101, igual que catalogo Cloud revisado
    sql(file('../../supabase/migrations/20261019170000_fase165_cierre_consumos_rechazados.sql'));
    candidateRoutineSQL = sql("select pg_get_functiondef('public.routine_inventory_operation(uuid,uuid,text,jsonb)'::regprocedure);");
    // Candidate return routines only; all writes remain inside the isolated fixture.
    sql(file('../../scripts/prepare-custody-returns-review.sql'));
    await t.test('devoluciones: material ya consumido no se puede solicitar ni recibir como sobrante', () => {
      reset();
      deliver(tech, cable, 10);
      const reqId = as(`select public.request_material_return('${cable}',7,'Pendiente antes del consumo');`);
      campoOp('consume', { productId: cable, quantity: 8, reason: 'Consumo real fixture' });
      assert.equal(custody(tech, cable), '2');
      const stockBefore = sql(`select current_stock from inventory_products where id='${cable}';`);
      const movementsBefore = sql('select count(*) from inventory_movements;');
      assert.throws(() => as(`select public.confirm_material_return('${reqId}',true,null);`, admin), /no tiene esa cantidad en custodia/);
      assert.equal(sql(`select status from technician_material_return_requests where id='${reqId}';`), 'pending');
      as(`select public.confirm_material_return('${reqId}',false,'Saldo consumido');`, admin);
      assert.throws(() => as(`select public.request_material_return('${cable}',8,'Ya consumido');`), /No tienes esa cantidad/);
      campoOp('consume', { productId: cable, quantity: 2, reason: 'Consume remanente' });
      assert.throws(() => as(`select public.request_material_return('${cable}',1,'Sin saldo');`), /No tienes esa cantidad/);
      assert.equal(custody(tech, cable), '0');
      assert.equal(Number(sql(`select current_stock from inventory_products where id='${cable}';`)), Number(stockBefore) - 2);
      assert.equal(Number(sql('select count(*) from inventory_movements;')), Number(movementsBefore) + 1);
    });

    // ---- Consumo valido ----
    await t.test('con custodia suficiente, el consumo se registra y descuenta la custodia (no el almacen)', () => {
      reset();
      deliver(tech, cable, 50);
      campoOp('consume', { productId: cable, quantity: 20, reason: 'Acometida' });
      assert.equal(custody(tech, cable), '30');
      assert.equal(sql(`select current_stock from inventory_products where id='${cable}';`), '80.00'); // el almacen SI baja (como siempre)
      assert.equal(sql(`select count(*) from technician_material_custody_events where event_type='consumption';`), '1');
    });

    // ---- Custodia insuficiente / cero ----
    await t.test('sin ninguna entrega (custodia cero), el consumo se bloquea y no deja nada a medias', () => {
      reset();
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 5, reason: 'x' }), /No tienes suficiente material en custodia/);
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
      assert.equal(sql(`select current_stock from inventory_products where id='${cable}';`), '100.00');
    });
    await t.test('con custodia parcial, pedir mas de lo que se tiene se bloquea (nada queda a medias)', () => {
      reset();
      deliver(tech, cable, 5);
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 10, reason: 'x' }), /No tienes suficiente material en custodia/);
      assert.equal(custody(tech, cable), '5');
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
    });
    await t.test('kit con 2 materiales: si uno no alcanza, el kit entero se bloquea (atomico)', () => {
      reset();
      deliver(tech, cable, 10);
      deliver(tech, patchcord, 1); // insuficiente para pedir 3
      assert.throws(() => campoOp('kit', { items: [{ productId: cable, quantity: 5 }, { productId: patchcord, quantity: 3 }], reason: 'Kit' }),
        /No tienes suficiente material en custodia/);
      assert.equal(custody(tech, cable), '10'); // ninguno de los dos se toco
      assert.equal(custody(tech, patchcord), '1');
      assert.equal(sql('select count(*) from inventory_movements;'), '0');
    });

    // ---- Averias (ticket) y Rutinas tambien quedan cubiertas ----
    await t.test('Averia (ticket): mismo control que en Alta', () => {
      reset();
      deliver(tech, cable, 5);
      assert.throws(() => campoOp('consume', { productId: cable, quantity: 10, reason: 'x' }, tech, 'ticket', ticket), /No tienes suficiente material en custodia/);
      deliver(tech, cable, 100); // ahora alcanza
      campoOp('consume', { productId: cable, quantity: 10, reason: 'x' }, tech, 'ticket', ticket);
      assert.equal(custody(tech, cable), '95');
    });
    await t.test('Rutina: consumo valido descuenta custodia del tecnico que lo registra, no de otro de la cuadrilla', () => {
      reset();
      deliver(tech, cable, 20);
      deliver(other, cable, 20);
      routineOp('consume', { product_id: cable, quantity: 15 }, tech);
      assert.equal(custody(tech, cable), '5');
      assert.equal(custody(other, cable), '20'); // intacto
    });
    await t.test('Rutina: sin custodia, el consumo se bloquea', () => {
      reset();
      assert.throws(() => routineOp('consume', { product_id: cable, quantity: 1 }, tech), /No tienes suficiente material en custodia/);
    });

    // ---- Reintentos (idempotencia) ----
    await t.test('reintentar la misma operacion (mismo operation_id) no descuenta dos veces', () => {
      reset();
      deliver(tech, cable, 50);
      const opId = randomUUID();
      campoOp('consume', { productId: cable, quantity: 20, reason: 'x' }, tech, 'installation', install, opId);
      campoOp('consume', { productId: cable, quantity: 20, reason: 'x' }, tech, 'installation', install, opId); // reintento, mismo payload
      assert.equal(custody(tech, cable), '30'); // sigue siendo UN solo descuento
      assert.equal(sql(`select count(*) from technician_material_custody_events where event_type='consumption';`), '1');
    });

    await t.test('Rutina: reintentar recibo confirmado no vuelve a descontar custodia', () => {
      reset();
      deliver(tech, cable, 20);
      const id = randomUUID();
      const payload = { product_id: cable, quantity: 6 };
      const first = routineOp('consume', payload, tech, id);
      assert.deepEqual(JSON.parse(routineOp('consume', payload, tech, id)), JSON.parse(first));
      assert.equal(Number(custody(tech, cable)), 14);
      assert.equal(sql("select count(*) from technician_material_custody_events where event_type='consumption';"), '1');
    });

    await t.test('correccion sin saldo suficiente revierte tambien la reposicion provisional', () => {
      reset();
      deliver(tech, cable, 20);
      const original = JSON.parse(campoOp('consume', { productId: cable, quantity: 10 }));
      assert.throws(() => campoOp('correct', { movementId: original.ids[0], quantity: 25 }, admin), /No tienes suficiente material en custodia/);
      assert.equal(Number(custody(tech, cable)), 10);
      assert.equal(sql('select count(*) from inventory_movements;'), '1');
      assert.equal(sql("select count(*) from technician_material_custody_events where event_type='consumption_reversal';"), '0');
    });

    // ---- Concurrencia: dos consumos simultaneos del mismo (tecnico,producto) ----
    await t.test('dos consumos simultaneos: el saldo nunca queda negativo (uno pasa, el otro se bloquea)', async () => {
      reset();
      deliver(tech, cable, 10);
      // Ordenes distintas, sin contrato compartido: compiten por material.
      sql('update installations set contract_id=null; update tickets set contract_id=null;');
      const consume = (job: string, id: string) => `set role authenticated; set request.jwt.claim.sub='${tech}';
        select campo_inventory_operation('${randomUUID()}','${job}','${id}','consume','{"productId":"${cable}","quantity":6}');`;
      const first = sqlAsync(`set application_name='f165_first'; begin; ${consume('installation', install)} select pg_sleep(5); commit;`);
      await waitForSession('f165_first', 'Timeout'); // consumo aplicado, transaccion aun abierta
      const second = sqlAsync(`set application_name='f165_second'; ${consume('ticket', ticket)}`);
      await waitForSession('f165_second', 'Lock'); // evidencia de solapamiento real en PostgreSQL
      const [a, b] = await Promise.all([first, second]);
      assert.equal(a.ok, true, a.output);
      assert.equal(b.ok, true, b.output); // rechazo persistido, no RAISE que perderia el pendiente
      assert.match(b.output, /"materialRejected": true/);
      assert.match(b.output, /No tienes suficiente material en custodia/);
      assert.equal(Number(custody(tech, cable)), 4);
      assert.equal(sql('select count(*) from inventory_movements;'), '1');
      assert.equal(sql("select count(*) from technician_material_custody_events where event_type='consumption';"), '1');
    });

    await t.test('dos primeras entregas simultaneas no pierden saldo cuando aun no existe la fila', async () => {
      reset();
      const event = `insert into technician_material_custody_events(technician_id,product_id,event_type,quantity,created_by)
        values('${tech}','${cable}','delivery',7,'${admin}');`;
      const first = sqlAsync(`set application_name='f165_delivery_first'; begin; ${event} select pg_sleep(5); commit;`);
      await waitForSession('f165_delivery_first', 'Timeout');
      const second = sqlAsync(`set application_name='f165_delivery_second'; ${event}`);
      await waitForSession('f165_delivery_second', 'Lock');
      const results = await Promise.all([first, second]);
      for (const result of results) assert.equal(result.ok, true, result.output);
      assert.equal(Number(custody(tech, cable)), 14);
    });

    // ---- Correccion / reversion: repone custodia SOLO si el consumo quedo rastreado ----
    await t.test('reverse de un consumo rastreado repone exactamente la custodia de quien lo consumio', () => {
      reset();
      deliver(tech, cable, 50);
      const result = JSON.parse(campoOp('consume', { productId: cable, quantity: 20, reason: 'x' }));
      assert.equal(custody(tech, cable), '30');
      campoOp('reverse', { movementId: result.ids[0], reason: 'Me equivoque' });
      assert.equal(custody(tech, cable), '50.00'); // repuesto completo (inventory_movements.quantity es numeric(12,2))
    });
    await t.test('correct de un consumo rastreado repone el original y descuenta solo la cantidad corregida', () => {
      reset();
      deliver(tech, cable, 50);
      const result = JSON.parse(campoOp('consume', { productId: cable, quantity: 20, reason: 'x' }));
      campoOp('correct', { movementId: result.ids[0], quantity: 8, reason: 'Era menos' });
      assert.equal(custody(tech, cable), '42.00'); // 50 - 8
    });
    await t.test('correct atribuye el nuevo descuento al tecnico del consumo ORIGINAL, no a quien corrige', () => {
      reset();
      deliver(tech, cable, 50);
      const result = JSON.parse(campoOp('consume', { productId: cable, quantity: 20, reason: 'x' }, tech));
      // Un admin corrige la cantidad en nombre del tecnico.
      campoOp('correct', { movementId: result.ids[0], quantity: 10, reason: 'Ajuste admin' }, admin);
      assert.equal(custody(tech, cable), '40.00'); // 50 - 10, siempre del tecnico original
      assert.equal(sql(`select count(*) from technician_material_custody where technician_id='${admin}';`), '0'); // nada se le atribuyo al admin
    });
    await t.test('CRITICO (punto 5 / diseño corregido): reverse de un consumo HISTORICO (nunca rastreado) no repone custodia ficticia', () => {
      reset();
      // Simula un movimiento "de antes de activar esta fase": insertado
      // directo, sin pasar por campo_inventory_operation, por lo tanto sin
      // ningun technician_material_custody_events de tipo 'consumption'.
      const legacyId = sql(`insert into inventory_movements(product_id,movement_type,quantity,reason,installation_id,created_by)
        values('${cable}','egreso',30,'Consumo historico pre-activacion','${install}','${tech}') returning id;`);
      assert.equal(custody(tech, cable), '0'); // nunca tuvo custodia -- este consumo nunca la toco
      campoOp('reverse', { movementId: legacyId, reason: 'Correccion administrativa de historico' });
      // Si se repusiera "de mas", aqui apareceria 30 de custodia ficticia -- el diseño exige que siga en 0.
      assert.equal(custody(tech, cable), '0');
      assert.equal(sql(`select count(*) from technician_material_custody_events where source_movement_id='${legacyId}';`), '0');
    });
    await t.test('Rutina: remove de un consumo rastreado repone al tecnico original, no a quien lo quita', () => {
      reset();
      deliver(tech, cable, 30);
      const result = JSON.parse(routineOp('consume', { product_id: cable, quantity: 12 }, tech));
      routineOp('remove', { movement_id: result.movement_or_event_id }, other); // otro de la cuadrilla lo quita
      assert.equal(custody(tech, cable), '30.00'); // repuesto a quien consumio, no a "other" (inventory_movements.quantity es numeric(12,2))
      assert.equal(custody(other, cable), '0');
    });

    for (const kind of ['installation', 'ticket', 'routine'] as const) {
      const editor = kind === 'routine' ? other : admin; // Rutinas exige tecnico asignado, incluso para corregir.
      const op = (action: string, movementId?: string, quantity?: number, actor = tech) => kind === 'routine'
        ? routineOp(action === 'reverse' ? 'remove' : action, action === 'consume'
          ? { product_id: cable, quantity } : { movement_id: movementId, ...(quantity === undefined ? {} : { quantity }) }, actor)
        : campoOp(action, action === 'consume' ? { productId: cable, quantity }
          : { movementId, ...(quantity === undefined ? {} : { quantity }) }, actor, kind, kind === 'ticket' ? ticket : install);
      const movement = (result: string) => { const r = JSON.parse(result); return kind === 'routine' ? r.movement_or_event_id : r.ids.at(-1); };

      await t.test(`${kind}: dos correcciones por otro actor conservan responsable y reverse repone una sola vez`, () => {
        reset();
        deliver(tech, cable, 50);
        const original = movement(op('consume', undefined, 20));
        const corrected = movement(op('correct', original, 12, editor));
        const next = movement(op('correct', corrected, 8, editor));
        assert.equal(Number(custody(tech, cable)), 42);
        assert.equal(Number(custody(editor, cable)), 0);
        assert.equal(sql(`select technician_id from technician_material_custody_events where source_movement_id='${next}' and event_type='consumption';`), tech);
        assert.equal(sql(`select created_by from inventory_movements where id='${next}';`), editor);
        const rows=JSON.parse(sql(`select json_agg(x) from (select id,product_id as "productId",created_by as "technicianId",movement_type as "movementType",quantity,created_at as "createdAt",'${kind}' as "jobType",'${kind==='routine'?routine:kind==='ticket'?ticket:install}' as "jobId",reverses_movement_id as "reversesMovementId",operation_id as "operationId",reason from inventory_movements) x;`)) as MaterialConsumptionMovementInput[];
        const receipts=JSON.parse(sql("select coalesce(json_agg(x),'[]') from (select action,payload,result from campo_inventory_operations where action='correct') x;"));
        const linked=linkMaterialCorrections(rows,receipts);
        assert.equal(linked.find(m=>m.id===next)?.correctsMovementId,corrected);
        // Mismo algoritmo del store con recibos/movimientos reales y sin eventos nuevos:
        // acredita tambien el historial previo a la activacion, no solo el mapping rastreado.
        assert.deepEqual(detectMaterialCustodyShortfalls([{technicianId:tech,productId:cable,eventType:'delivery',quantity:50,createdAt:'2000-01-01T00:00:00Z'}],linked),[]);
        op('reverse', next, undefined, editor);
        assert.equal(Number(custody(tech, cable)), 50);
        assert.throws(() => op('reverse', next, undefined, editor));
        assert.equal(Number(custody(tech, cable)), 50);
      });

      await t.test(`${kind}: cadena historica corregida dos veces y revertida no exige ni crea custodia`, () => {
        reset();
        const column = kind === 'routine' ? 'routine_id' : kind === 'ticket' ? 'ticket_id' : 'installation_id';
        const jobId = kind === 'routine' ? routine : kind === 'ticket' ? ticket : install;
        let legacy: string;
        if (kind === 'routine') {
          // Generar un recibo historico real con la funcion anterior, en esta BD efimera.
          sql(legacyRoutineSQL);
          try { legacy = movement(op('consume', undefined, 20)); }
          finally { sql(candidateRoutineSQL); }
        } else {
          legacy = sql(`insert into inventory_movements(product_id,movement_type,quantity,reason,${column},created_by)
            values('${cable}','egreso',20,'Historico','${jobId}','${tech}') returning id;`);
        }
        const corrected = movement(op('correct', legacy, 25, editor));
        const next = movement(op('correct', corrected, 10, editor));
        op('reverse', next, undefined, editor);
        assert.equal(sql('select count(*) from technician_material_custody_events;'), '0');
        assert.equal(sql('select count(*) from technician_material_custody;'), '0');
        assert.equal(sql('select count(*) from material_inventory_rejections;'), '0');
        assert.equal(Number(sql(`select current_stock from inventory_products where id='${cable}';`)), 100);
        const table=kind==='routine'?'routines':kind==='ticket'?'tickets':'installations';
        sql(`update ${table} set status='${kind==='ticket'?'resolved':'completed'}' where id='${jobId}';`);
      });
    }

    await t.test('Rutina: correcciones sucesivas por apoyo no transfieren custodia a la cuadrilla', () => {
      reset();
      deliver(tech, cable, 30);
      const original = JSON.parse(routineOp('consume', { product_id: cable, quantity: 12 }));
      const corrected = JSON.parse(routineOp('correct', { movement_id: original.movement_or_event_id, quantity: 9 }, other));
      routineOp('correct', { movement_id: corrected.movement_or_event_id, quantity: 6 }, other);
      assert.equal(Number(custody(tech, cable)), 24);
      assert.equal(Number(custody(other, cable)), 0);
    });

    // ---- Cierre de orden tras consumo valido (sin regresion) ----
    await t.test('la orden puede cerrarse normalmente despues de un consumo con custodia valida', () => {
      reset();
      deliver(tech, cable, 20);
      campoOp('consume', { productId: cable, quantity: 10, reason: 'x' });
      sql(`update installations set status='completed' where id='${install}';`);
      assert.equal(sql(`select status from installations where id='${install}';`), 'completed');
      assert.equal(custody(tech, cable), '10'); // la custodia descontada se mantiene, el cierre no la toca
    });

    // ---- Integridad del esquema nuevo ----
    await t.test('el CHECK nuevo exige source_movement_id en consumo/reversion y lo prohibe en entrega/devolucion', () => {
      reset();
      deliver(tech, cable, 50); // custodia suficiente -- este test valida el CHECK, no el trigger de saldo
      assert.throws(() => sql(`insert into technician_material_custody_events(technician_id,product_id,event_type,quantity,created_by)
        values('${tech}','${cable}','consumption',5,'${tech}');`), /technician_material_custody_events_source_matches_type/);
      assert.throws(() => sql(`insert into technician_material_custody_events(technician_id,product_id,event_type,quantity,created_by,source_movement_id)
        values('${tech}','${cable}','delivery',5,'${admin}','00000000-0000-0000-0000-000000000099');`), /technician_material_custody_events_source_matches_type|violates foreign key/);
    });

    // ---- Regresion: equipos serializados siguen sin cambios ----
    for (const kind of ['installation','ticket','routine'] as const) {
      const jobId = kind === 'installation' ? install : kind === 'ticket' ? ticket : routine;
      const table = kind === 'installation' ? 'installations' : kind === 'ticket' ? 'tickets' : 'routines';
      const terminal = kind === 'ticket' ? 'resolved' : 'completed';
      const close = () => sql(`update ${table} set status='${terminal}' where id='${jobId}';`);
      const attempt = (id: string) => kind === 'routine'
        ? routineOp('consume',{product_id:cable,quantity:6},tech,id)
        : campoOp('consume',{productId:cable,quantity:6},tech,kind,jobId,id);

      await t.test(`${kind}: cierre sin materiales requeridos permitido`, () => {
        reset();
        close();
        assert.equal(sql(`select status from ${table} where id='${jobId}';`),terminal);
        assert.equal(sql('select count(*) from material_inventory_rejections;'),'0');
      });
      await t.test(`${kind}: rechazo persiste sin movimientos, bloquea cierre y evidencia; entrega + mismo UUID resuelve una vez`, () => {
        reset();
        const id=randomUUID();
        assert.throws(()=>attempt(id),/No tienes suficiente material en custodia/);
        assert.equal(sql(`select status from material_inventory_rejections where operation_id='${id}';`),'pending');
        assert.equal(sql('select count(*) from inventory_movements;'),'0');
        assert.throws(close,/No se puede cerrar la orden/);
        assert.throws(()=>sql(`insert into work_order_closures(job_type,job_id,client_id) values('${kind}','${jobId}','${client}');`),/No se puede cerrar la orden/);
        assert.equal(sql(`select status from ${table} where id='${jobId}';`),'in_progress');
        assert.throws(()=>as(`select public.assert_material_closure_ready('${kind}','${jobId}');`),/No se puede cerrar/);
        deliver(tech,cable,10);
        attempt(id);attempt(id);
        assert.equal(Number(custody(tech,cable)),4);
        assert.equal(sql('select count(*) from inventory_movements;'),'1');
        assert.equal(sql(`select status from material_inventory_rejections where operation_id='${id}';`),'resolved');
        as(`select public.assert_material_closure_ready('${kind}','${jobId}');`);
        sql(`insert into work_order_closures(job_type,job_id,client_id) values('${kind}','${jobId}','${client}');`);
        close();
      });
      await t.test(`${kind}: solo admin puede anular intento equivocado con motivo; no genera custodia ni consumo`, () => {
        reset();const id=randomUUID();
        assert.throws(()=>attempt(id));
        assert.throws(()=>as(`select cancel_rejected_material_operation('${id}','Me equivoque');`),/Solo administracion/);
        assert.throws(()=>as(`select cancel_rejected_material_operation('${id}','');`,admin),/motivo/);
        as(`select cancel_rejected_material_operation('${id}','Se confirmo que no se uso material');`,admin);
        assert.throws(()=>attempt(id),/anulo este intento/);
        assert.equal(sql('select count(*) from inventory_movements;'),'0');
        assert.equal(Number(custody(tech,cable)),0);
        assert.equal(sql(`select resolution_note from material_inventory_rejections where operation_id='${id}';`),'Se confirmo que no se uso material');
        close();
      });
      await t.test(`${kind}: cierre simultaneo espera al rechazo y no puede ignorarlo`, async () => {
        reset();
        const payload=kind==='routine'?{product_id:cable,quantity:1}:{productId:cable,quantity:1};
        const call=kind==='routine'
          ?`select routine_inventory_operation('${jobId}','${randomUUID()}','consume','${JSON.stringify(payload)}');`
          :`select campo_inventory_operation('${randomUUID()}','${kind}','${jobId}','consume','${JSON.stringify(payload)}');`;
        const first=sqlAsync(`set application_name='f165_reject_close';begin;set role authenticated;set request.jwt.claim.sub='${tech}';${call} select pg_sleep(5);commit;`);
        await waitForSession('f165_reject_close','Timeout');
        const second=sqlAsync(`set application_name='f165_close_wait';update ${table} set status='${terminal}' where id='${jobId}';`);
        await waitForSession('f165_close_wait','Lock');
        const [a,b]=await Promise.all([first,second]);
        assert.equal(a.ok,true,a.output);assert.equal(b.ok,false,b.output);assert.match(b.output,/No se puede cerrar la orden/);
        assert.equal(sql(`select status from ${table} where id='${jobId}';`),'in_progress');
      });
    }

    await t.test('metros admite consumos decimales en Campo y Rutinas sin cambiar la unidad del producto', () => {
      reset();deliver(tech,cable,2);
      campoOp('consume',{productId:cable,quantity:0.5});
      routineOp('consume',{product_id:cable,quantity:0.5});
      assert.equal(Number(custody(tech,cable)),1);
      assert.equal(sql(`select unit from inventory_products where id='${cable}';`),'metros');
      assert.equal(sql('select count(*) from inventory_movements;'),'2');
    });
    await t.test('Rutina sin cliente ni materiales admite evidencia de cierre y estado completed', () => {
      reset();sql(`update routines set client_id=null,contract_id=null where id='${routine}';`);
      sql(`insert into work_order_closures(job_type,job_id,client_id) values('routine','${routine}',null);
        update routines set status='completed' where id='${routine}';`);
      assert.equal(sql(`select status from routines where id='${routine}';`),'completed');
    });

    await t.test('entrega y devolucion siguen operativas con las dos migraciones candidatas', () => {
      reset();deliver(tech,cable,20);
      const request=as(`select request_material_return('${cable}',7,'Sobrante');`);
      assert.equal(Number(custody(tech,cable)),20);
      as(`select confirm_material_return('${request}',true,'Recibido');`,admin);
      assert.equal(Number(custody(tech,cable)),13);
      assert.equal(sql('select count(*) from inventory_movements;'),'0');
      assert.equal(sql('select count(*) from material_inventory_rejections;'),'0');
    });

    await t.test('implementaciones privadas no son ejecutables ni se pueden borrar rechazos con REST', () => {
      reset();
      assert.throws(()=>as(`select campo_inventory_operation_f165_impl('${randomUUID()}','installation','${install}','consume','{}');`),/permission denied/);
      assert.throws(()=>as('delete from material_inventory_rejections;'),/permission denied/);
    });

    await t.test('regresion: equipos serializados no pasan por el control de materiales (sin cambios)', () => {
      reset();
      const unit = '60000000-0000-0000-0000-000000000165';
      sql(`insert into inventory_products(id,name,unit,is_serialized) values('50000000-0000-0000-0000-000000000165','ONT','unidad',true);
        insert into inventory_units(id,product_id,serial_number,status) values('${unit}','50000000-0000-0000-0000-000000000165','ONT-165-01','in_stock');`);
      // El candidato dba2c67 (ya vigente, cargado arriba) exige custodia
      // previa del equipo tambien para Altas -- mismo patron que
      // technicianCustody.sql.test.ts ("ruta ensanchada"), no es parte de
      // esta fase; lo reproducimos para que el regression test sea fiel a
      // la version REAL de campo_inventory_operation.
      as(`select public.deliver_unit_to_technician('${unit}','${tech}','x');`, admin);
      campoOp('assign', { unitId: unit, reason: 'Instalacion' });
      assert.equal(sql(`select status from inventory_units where id='${unit}';`), 'assigned');
      assert.equal(sql(`select count(*) from technician_material_custody_events;`), '0'); // nada de materiales se toco (equipos usan inventory_unit_events, tabla distinta)
    });
    await t.test('respaldo custom y restauracion aislada conservan filas, ACL, funciones y guardas', async () => {
      reset();deliver(tech,cable,20);campoOp('consume',{productId:cable,quantity:5});
      const serialUnit='60000000-0000-0000-0000-000000000166';
      sql(`insert into inventory_units(id,product_id,serial_number,status) values('${serialUnit}','50000000-0000-0000-0000-000000000165','SERIAL-BACKUP-SYNTHETIC','in_stock');`);
      as(`select deliver_unit_to_technician('${serialUnit}','${tech}','Entrega sintetica para respaldo');`,admin);
      campoOp('assign',{unitId:serialUnit});
      const request=as(`select request_material_return('${cable}',2,'Sobrante sintetico');`);
      as(`select confirm_material_return('${request}',true,'Recibido');`,admin);
      sql(`insert into work_order_closures(job_type,job_id,client_id,signature_path) values('installation','${install}','${client}','synthetic/signature.png');
        insert into work_order_photos(job_type,job_id,category,storage_path) values('installation','${install}','facade','synthetic/photo.png');`);
      assert.throws(()=>campoOp('consume',{productId:cable,quantity:30}));
      const tables=['profiles','clients','service_contracts','installations','tickets','routines','job_assignees','inventory_products','inventory_units','inventory_unit_events','inventory_movements','technician_material_custody','technician_material_custody_events','technician_material_return_requests','campo_inventory_operations','routine_inventory_operations','material_inventory_rejections','work_order_closures','work_order_photos'];
      const fingerprint=tables.map(table=>`select '${table}',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\\n' order by to_jsonb(x)::text),'')) from public.${table} x;`).join('\n');
      const expected=sql(fingerprint);
      const dump=execFileSync('docker',['exec',container,'pg_dump','-h','127.0.0.1','-U','postgres','-Fc','postgres'],{windowsHide:true,maxBuffer:20*1024*1024});
      assert.ok(dump.length>1000);assert.equal(createHash('sha256').update(dump).digest('hex').length,64);
      const restored=container+'-restore';
      try {
        docker(['run','--pull=never','--rm','-d','--name',restored,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
        for(let i=0;i<50;i++){try{docker(['exec',restored,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{await new Promise(r=>setTimeout(r,100));}}
        const read=(query:string)=>docker(['exec','-i',restored,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],query).trim();
        read('create role anon; create role authenticated; create role service_role nologin bypassrls;');
        execFileSync('docker',['exec','-i',restored,'pg_restore','-h','127.0.0.1','-U','postgres','--exit-on-error','-d','postgres'],{input:dump,windowsHide:true,stdio:['pipe','pipe','pipe']});
        assert.equal(read(fingerprint),expected);
        assert.throws(()=>read(`update installations set status='completed' where id='${install}';`),/No se puede cerrar/);
        assert.equal(read("select has_function_privilege('authenticated','public.campo_inventory_operation_f165_impl(uuid,text,uuid,text,jsonb)','execute');"),'f');
        assert.equal(read("select has_function_privilege('authenticated','public.campo_inventory_operation(uuid,text,uuid,text,jsonb)','execute');"),'t');
        assert.equal(Number(read(`select quantity from technician_material_custody where technician_id='${tech}' and product_id='${cable}';`)),13);
        assert.equal(read(`select status from inventory_units where id='${serialUnit}';`),'assigned');
      } finally { docker(['rm','-f',restored]); }
    });

    await t.test('rollback propuesto solo en este contenedor conserva Kardex, custodia y rechazos auditables', () => {
      reset();deliver(tech,cable,10);
      campoOp('consume',{productId:cable,quantity:5});
      assert.throws(()=>campoOp('consume',{productId:cable,quantity:10}));
      const before=sql(`select json_build_object('movements',(select count(*) from inventory_movements),'events',(select count(*) from technician_material_custody_events),'rejections',(select count(*) from material_inventory_rejections))`);
      sql(file('../../scripts/rollback-material-custody-stage2.sql'));
      assert.equal(sql(`select json_build_object('movements',(select count(*) from inventory_movements),'events',(select count(*) from technician_material_custody_events),'rejections',(select count(*) from material_inventory_rejections))`),before);
      assert.equal(Number(custody(tech,cable)),5);
      assert.equal(sql("select count(*) from pg_trigger where tgname in ('guard_material_closure','guard_material_installation','guard_material_ticket','guard_material_routine');"),'0');
      sql(`update installations set status='completed' where id='${install}';`);
    });
  } finally { try { docker(['rm', '-f', container]); } catch {} }
});
