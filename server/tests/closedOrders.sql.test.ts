import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const superadmin = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const tecnico = '00000000-0000-0000-0000-000000000003';
const soporte = '00000000-0000-0000-0000-000000000004';
const client1 = '30000000-0000-0000-0000-000000000001';
const ontProduct = '50000000-0000-0000-0000-000000000001';
const dropProduct = '50000000-0000-0000-0000-000000000002';

test('PostgreSQL isolated: proteger ordenes cerradas (Fase 151, propuesta)', { timeout: 60000 }, async t => {
  const container = `smartrayco-fase151-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const queryAs = (sql: string) => docker(psqlArgs, sql).trim();
  // El dueño de la tabla (postgres) se salta RLS por defecto — todo lo que
  // deba respetar las policies tiene que pasar por asUser (role authenticated).
  const asUser = (sql: string, user: string) => queryAs(`set role authenticated; set request.jwt.claim.sub='${user}'; ${sql} reset role;`);
  const asSuper = (sql: string) => queryAs(`${sql}`);

  const ticketA = '10000000-0000-0000-0000-000000000001'; // resolved
  const ticketB = '10000000-0000-0000-0000-000000000002'; // closed
  const ticketC = '10000000-0000-0000-0000-000000000003'; // open
  const installE = '20000000-0000-0000-0000-000000000001'; // completed
  const installF = '20000000-0000-0000-0000-000000000002'; // cancelled
  const installG = '20000000-0000-0000-0000-000000000003'; // scheduled (abierta)
  const routineH = '60000000-0000-0000-0000-000000000001'; // completed

  const reset = () => asSuper(`
    truncate public.inventory_unit_events, public.inventory_movements, public.inventory_units,
             public.job_assignees, public.tickets, public.installations, public.routines restart identity;
    update public.inventory_products set current_stock = 100;
    insert into public.tickets (id, status, ticket_number) values
      ('${ticketA}', 'resolved', 'T-A'), ('${ticketB}', 'closed', 'T-B'), ('${ticketC}', 'open', 'T-C');
    insert into public.installations (id, status) values
      ('${installE}', 'completed'), ('${installF}', 'cancelled'), ('${installG}', 'scheduled');
    insert into public.routines (id, status, routine_number) values ('${routineH}', 'completed', 'R-H');
  `);

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');

    asSuper(sqlFile('./closedOrdersSchema.sql'));
    // current_user_role() tal cual vive en produccion (Fase 13) — mismo
    // patron de extraccion que napAssignment.sql.test.ts, para no
    // duplicarla a mano y que quede desincronizada.
    const roleSql = sqlFile('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql')
      .match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0];
    asSuper(roleSql);
    // Policies base (select/insert) que fase151 no toca pero hacen falta
    // para que los INSERT de prueba pasen RLS.
    asSuper(`
      alter table public.tickets enable row level security;
      alter table public.installations enable row level security;
      alter table public.routines enable row level security;
      alter table public.job_assignees enable row level security;
      alter table public.inventory_unit_events enable row level security;
      alter table public.inventory_movements enable row level security;
      create policy p0 on public.installations for select to authenticated using (true);
      create policy p1 on public.tickets for all to authenticated using (true) with check (true);
      create policy p2 on public.routines for all to authenticated using (true) with check (true);
      create policy p3 on public.job_assignees for select to authenticated using (true);
      create policy p4 on public.inventory_unit_events for all to authenticated using (true) with check (true);
      create policy p5 on public.inventory_movements for all to authenticated using (true) with check (true);
    `);
    asSuper(sqlFile('./../../supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql'));
    asSuper(`
      create trigger trg_inventory_unit_events_apply before insert on public.inventory_unit_events
        for each row execute procedure public.apply_inventory_unit_event();
      create trigger trg_inventory_movements_apply before insert on public.inventory_movements
        for each row execute procedure public.apply_inventory_movement();
    `);

    // ---- 1) installations_update_staff ----
    // OJO: un USING que excluye la fila hace que el UPDATE toque 0 filas en
    // silencio (no lanza excepcion) — es el comportamiento normal de RLS
    // para UPDATE/SELECT/DELETE (solo INSERT/UPDATE con WITH CHECK fallido
    // lanzan error real). Por eso estas pruebas verifican que la fila quedo
    // SIN CAMBIOS, no un throw.
    await t.test('ADMIN no puede editar una instalacion completed o cancelled (0 filas afectadas, sin error)', () => {
      reset();
      asUser(`update public.installations set assigned_to='${tecnico}' where id='${installE}';`, admin);
      asUser(`update public.installations set assigned_to='${tecnico}' where id='${installF}';`, admin);
      assert.equal(asSuper(`select coalesce(assigned_to::text,'null') from public.installations where id='${installE}';`), 'null');
      assert.equal(asSuper(`select coalesce(assigned_to::text,'null') from public.installations where id='${installF}';`), 'null');
    });

    await t.test('SUPERADMIN SI puede editar/reabrir una instalacion completed (edicion excepcional)', () => {
      reset();
      asUser(`update public.installations set status='scheduled' where id='${installE}';`, superadmin);
      assert.equal(asSuper(`select status from public.installations where id='${installE}';`), 'scheduled');
    });

    await t.test('ADMIN SI puede completar/cancelar una instalacion ABIERTA (la fila antes del update no esta cerrada)', () => {
      reset();
      asUser(`update public.installations set status='completed' where id='${installG}';`, admin);
      assert.equal(asSuper(`select status from public.installations where id='${installG}';`), 'completed');
    });

    await t.test('ADMIN sigue sin restriccion en una instalacion programada/pendiente (sin romper el flujo normal)', () => {
      reset();
      asUser(`update public.installations set assigned_to='${tecnico}' where id='${installG}';`, admin);
      assert.equal(asSuper(`select assigned_to from public.installations where id='${installG}';`), tecnico);
    });

    // ---- 2) job_assignees (solo installation) ----
    await t.test('ADMIN y SOPORTE no pueden tocar la cuadrilla de una instalacion cerrada', () => {
      reset();
      assert.throws(() => asUser(`insert into public.job_assignees values ('installation','${installE}','${tecnico}','leader');`, admin), /permission denied|row-level security/i);
      assert.throws(() => asUser(`insert into public.job_assignees values ('installation','${installF}','${tecnico}','leader');`, soporte), /permission denied|row-level security/i);
    });

    await t.test('SUPERADMIN SI puede tocar la cuadrilla de una instalacion cerrada', () => {
      reset();
      asUser(`insert into public.job_assignees values ('installation','${installE}','${tecnico}','leader');`, superadmin);
      assert.equal(asSuper(`select count(*) from public.job_assignees where job_type='installation' and job_id='${installE}';`), '1');
    });

    await t.test('ADMIN sigue SIN restriccion en cuadrilla de ticket/rutina cerrados (fuera de alcance de esta fase, a proposito)', () => {
      reset();
      asUser(`insert into public.job_assignees values ('ticket','${ticketB}','${tecnico}','leader');`, admin);
      asUser(`insert into public.job_assignees values ('routine','${routineH}','${tecnico}','leader');`, admin);
      assert.equal(asSuper(`select count(*) from public.job_assignees where job_id in ('${ticketB}','${routineH}');`), '2');
    });

    await t.test('ADMIN sigue SIN restriccion en cuadrilla de una instalacion abierta', () => {
      reset();
      asUser(`insert into public.job_assignees values ('installation','${installG}','${tecnico}','leader');`, admin);
      assert.equal(asSuper(`select count(*) from public.job_assignees where job_type='installation' and job_id='${installG}';`), '1');
    });

    // ---- 3) apply_inventory_unit_event: instalaciones (completed Y cancelled) ----
    await t.test('TECNICO_RED no puede asignar equipo a una instalacion CANCELADA (antes solo bloqueaba completed)', () => {
      reset();
      const unit = asSuper(`insert into public.inventory_units (product_id, serial_number) values ('${ontProduct}','SN-CANCEL-1') returning id;`);
      assert.throws(
        () => asUser(`insert into public.inventory_unit_events (unit_id, to_status, client_id, installation_id) values ('${unit}','assigned','${client1}','${installF}');`, tecnico),
        /completada o cancelada/,
      );
    });

    await t.test('ADMIN SI puede asignar equipo a una instalacion cancelada (correccion administrativa)', () => {
      reset();
      const unit = asSuper(`insert into public.inventory_units (product_id, serial_number) values ('${ontProduct}','SN-CANCEL-2') returning id;`);
      asUser(`insert into public.inventory_unit_events (unit_id, to_status, client_id, installation_id) values ('${unit}','assigned','${client1}','${installF}');`, admin);
      assert.equal(asSuper(`select status from public.inventory_units where id='${unit}';`), 'assigned');
    });

    // ---- 4) apply_inventory_unit_event: asimetria de ticket_id corregida (quitar/mover) ----
    await t.test('TECNICO_RED no puede QUITAR un equipo ya ligado a una averia resuelta (asimetria corregida)', () => {
      reset();
      const unit = asSuper(`insert into public.inventory_units (product_id, serial_number, status, client_id, ticket_id) values ('${ontProduct}','SN-TICKET-1','assigned','${client1}','${ticketA}') returning id;`);
      assert.throws(
        () => asUser(`insert into public.inventory_unit_events (unit_id, to_status, ticket_id) values ('${unit}','in_repair','${ticketA}');`, tecnico),
        /avería ya fue resuelta/,
      );
    });

    await t.test('SOPORTE SI puede quitar un equipo de una averia resuelta (mismo grupo que ya aprobaba, Fase 95b)', () => {
      reset();
      const unit = asSuper(`insert into public.inventory_units (product_id, serial_number, status, client_id, ticket_id) values ('${ontProduct}','SN-TICKET-2','assigned','${client1}','${ticketA}') returning id;`);
      asUser(`insert into public.inventory_unit_events (unit_id, to_status, ticket_id) values ('${unit}','in_repair','${ticketA}');`, soporte);
      assert.equal(asSuper(`select status from public.inventory_units where id='${unit}';`), 'in_repair');
    });

    await t.test('TECNICO_RED SI puede mover equipo de un ticket ABIERTO (regresion: no se rompio el flujo normal)', () => {
      reset();
      const unit = asSuper(`insert into public.inventory_units (product_id, serial_number, status, client_id, ticket_id) values ('${ontProduct}','SN-TICKET-3','assigned','${client1}','${ticketC}') returning id;`);
      asUser(`insert into public.inventory_unit_events (unit_id, to_status, ticket_id) values ('${unit}','in_repair','${ticketC}');`, tecnico);
      assert.equal(asSuper(`select status from public.inventory_units where id='${unit}';`), 'in_repair');
    });

    // ---- 5) apply_inventory_movement: candado nuevo de ticket_id + cancelled ----
    await t.test('TECNICO_RED no puede registrar materiales contra una averia cerrada (candado nuevo)', () => {
      reset();
      assert.throws(
        () => asUser(`insert into public.inventory_movements (product_id, movement_type, quantity, ticket_id) values ('${dropProduct}','egreso',10,'${ticketB}');`, tecnico),
        /avería ya fue resuelta/,
      );
    });

    await t.test('TECNICO_RED no puede registrar materiales contra una instalacion CANCELADA (antes solo bloqueaba completed)', () => {
      reset();
      assert.throws(
        () => asUser(`insert into public.inventory_movements (product_id, movement_type, quantity, installation_id) values ('${dropProduct}','egreso',10,'${installF}');`, tecnico),
        /completada o cancelada/,
      );
    });

    await t.test('TECNICO_RED SI puede registrar materiales en una instalacion abierta (regresion)', () => {
      reset();
      asUser(`insert into public.inventory_movements (product_id, movement_type, quantity, installation_id) values ('${dropProduct}','egreso',5,'${installG}');`, tecnico);
      assert.equal(asSuper(`select current_stock from public.inventory_products where id='${dropProduct}';`), '95.00');
    });
  } finally {
    try { docker(['stop', container]); } catch { /* Already removed after a startup failure. */ }
  }
});
