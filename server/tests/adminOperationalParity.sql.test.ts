import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const superadmin = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const tecnico = '00000000-0000-0000-0000-000000000003';

test('PostgreSQL isolated: ampliacion de permisos operativos de ADMIN (paridad con SUPERADMIN)', { timeout: 60000 }, async t => {
  const container = `smartrayco-adminparity-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const queryAs = (sql: string) => docker(psqlArgs, sql).trim();
  // El dueño de la tabla (postgres) se salta RLS por defecto — todo lo que
  // deba respetar las policies tiene que pasar por asUser (role authenticated).
  const asUser = (sql: string, user: string) => queryAs(`set role authenticated; set request.jwt.claim.sub='${user}'; ${sql} reset role;`);
  const asSuper = (sql: string) => queryAs(sql);

  const reset = () => asSuper(`
    truncate public.admin_audit_log, public.inventory_units, public.inventory_products,
             public.invoices, public.fo_cables, public.installations, public.job_assignees,
             public.asistencia_solicitudes, public.asistencia_solicitud_eventos,
             public.asistencia_novedades, public.asistencia_intercambios,
             public.asistencia_horarios_personales, public.service_contracts, public.clients,
             public.contract_unfulfilled_cancellations, public.profiles restart identity cascade;
    insert into public.profiles (id, role, active) values
      ('${superadmin}', 'SUPERADMIN', true), ('${admin}', 'ADMIN', true), ('${tecnico}', 'TECNICO_RED', true);
  `);

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');

    asSuper(sqlFile('./adminOperationalParitySchema.sql'));
    asSuper(sqlFile('../../supabase/migrations/20261124120000_admin_operational_parity.sql'));
    // La migracion real SOLO reemplaza la funcion (igual que en produccion,
    // donde el trigger ya existe desde Fase 58) — el fixture aislado si
    // necesita declarar el trigger, ahora que la funcion ya existe.
    asSuper(`
      create trigger trg_inventory_products_guard_deactivation
        before update on public.inventory_products
        for each row execute function public.guard_inventory_product_deactivation();
    `);
    reset();

    // ==================================================================
    // 1) Inventario — desactivar producto (ampliado) + auditoria
    // ==================================================================
    await t.test('ADMIN ahora SI puede desactivar un producto (antes solo SUPERADMIN) y queda auditado', () => {
      reset();
      const product = asSuper(`insert into public.inventory_products (name) values ('Router X') returning id;`);
      asUser(`update public.inventory_products set is_active=false where id='${product}';`, admin);
      assert.equal(asSuper(`select is_active from public.inventory_products where id='${product}';`), 'f');
      const audit = asSuper(`select actor_role, tabla, accion from public.admin_audit_log where tabla='inventory_products';`);
      assert.equal(audit, `ADMIN|inventory_products|deactivate`);
    });

    await t.test('TECNICO_RED sigue SIN poder desactivar un producto', () => {
      reset();
      const product = asSuper(`insert into public.inventory_products (name) values ('Router Y') returning id;`);
      assert.throws(() => asUser(`update public.inventory_products set is_active=false where id='${product}';`, tecnico), /Solo SUPERADMIN o ADMIN/);
    });

    await t.test('Eliminar una unidad serializada queda auditado (antes no dejaba ningun rastro)', () => {
      reset();
      const product = asSuper(`insert into public.inventory_products (name) values ('ONT Z') returning id;`);
      const unit = asSuper(`insert into public.inventory_units (product_id, serial_number) values ('${product}','SN-1') returning id;`);
      asUser(`delete from public.inventory_units where id='${unit}';`, admin);
      const audit = asSuper(`select actor_role, tabla, accion, entidad_id from public.admin_audit_log where tabla='inventory_units';`);
      assert.equal(audit, `ADMIN|inventory_units|delete|${unit}`);
    });

    // ==================================================================
    // 2) Facturacion — eliminar factura: decision final del propietario
    // (2026-11-24, antes de publicar) SIGUE EXCLUSIVA DE SUPERADMIN.
    // Se conserva la auditoria nueva para el camino que SI funciona.
    // ==================================================================
    await t.test('ADMIN sigue SIN poder eliminar una factura (exclusivo SUPERADMIN, decision final)', () => {
      reset();
      const invoice = asSuper(`insert into public.invoices (invoice_number, amount) values ('F-001', 150.50) returning id;`);
      asUser(`delete from public.invoices where id='${invoice}';`, admin);
      assert.equal(asSuper(`select count(*) from public.invoices where id='${invoice}';`), '1');
    });

    await t.test('SUPERADMIN SI puede eliminar una factura y queda auditada con la fila completa', () => {
      reset();
      const invoice = asSuper(`insert into public.invoices (invoice_number, amount) values ('F-001b', 150.50) returning id;`);
      asUser(`delete from public.invoices where id='${invoice}';`, superadmin);
      assert.equal(asSuper(`select count(*) from public.invoices where id='${invoice}';`), '0');
      const amount = asSuper(`select anterior->>'amount' from public.admin_audit_log where tabla='invoices';`);
      assert.equal(amount, '150.50');
    });

    await t.test('TECNICO_RED sigue SIN poder eliminar facturas (0 filas, RLS silenciosa en DELETE)', () => {
      reset();
      const invoice = asSuper(`insert into public.invoices (invoice_number, amount) values ('F-002', 10) returning id;`);
      asUser(`delete from public.invoices where id='${invoice}';`, tecnico);
      assert.equal(asSuper(`select count(*) from public.invoices where id='${invoice}';`), '1');
    });

    // ==================================================================
    // 2b) Clientes y contratos — contract_cancel_unfulfilled: decision
    // final del propietario (2026-11-24) SIGUE EXCLUSIVA DE SUPERADMIN.
    // ==================================================================
    await t.test('ADMIN sigue SIN poder cancelar una contratacion no instalada (exclusivo SUPERADMIN, decision final)', () => {
      reset();
      const client = asSuper(`insert into public.clients (status) values ('prospect') returning id;`);
      const contract = asSuper(`insert into public.service_contracts (client_id) values ('${client}') returning id;`);
      const updatedAt = asSuper(`select updated_at from public.service_contracts where id='${contract}';`);
      assert.throws(() => asUser(`select public.contract_cancel_unfulfilled('${contract}', '${updatedAt}'::timestamptz, 'motivo', true);`, admin), /Requiere SUPERADMIN activo/);
      assert.equal(asSuper(`select status from public.service_contracts where id='${contract}';`), 'active');
    });

    await t.test('SUPERADMIN SI puede cancelar una contratacion no instalada (sin cambios de comportamiento)', () => {
      reset();
      const client = asSuper(`insert into public.clients (status) values ('prospect') returning id;`);
      const contract = asSuper(`insert into public.service_contracts (client_id) values ('${client}') returning id;`);
      const updatedAt = asSuper(`select updated_at from public.service_contracts where id='${contract}';`);
      asUser(`select public.contract_cancel_unfulfilled('${contract}', '${updatedAt}'::timestamptz, 'Cliente desistio antes de instalar', true);`, superadmin);
      assert.equal(asSuper(`select status from public.service_contracts where id='${contract}';`), 'cancelled');
      assert.equal(asSuper(`select count(*) from public.contract_unfulfilled_cancellations where contract_id='${contract}';`), '1');
    });

    await t.test('TECNICO_RED sigue SIN poder cancelar una contratacion no instalada', () => {
      reset();
      const client = asSuper(`insert into public.clients (status) values ('prospect') returning id;`);
      const contract = asSuper(`insert into public.service_contracts (client_id) values ('${client}') returning id;`);
      const updatedAt = asSuper(`select updated_at from public.service_contracts where id='${contract}';`);
      assert.throws(() => asUser(`select public.contract_cancel_unfulfilled('${contract}', '${updatedAt}'::timestamptz, 'motivo', true);`, tecnico), /Requiere SUPERADMIN activo/);
    });

    // ==================================================================
    // 3) Mapa de red — remove_from_network_map y guard_cable_endpoint_unlink:
    // decision final del propietario (2026-11-24) SIGUEN EXCLUSIVAS DE
    // SUPERADMIN. Se conserva la auditoria nueva para el camino que SI
    // funciona (SUPERADMIN).
    // ==================================================================
    await t.test('ADMIN sigue SIN poder desvincular un extremo de cable ya conectado (exclusivo SUPERADMIN, decision final)', () => {
      reset();
      const infra = asSuper(`insert into public.infra_elementos (tipo) values ('nap') returning id;`);
      const cable = asSuper(`insert into public.fo_cables (origen_infra_id) values ('${infra}') returning id;`);
      assert.throws(() => asUser(`update public.fo_cables set origen_infra_id=null where id='${cable}';`, admin), /Solo SUPERADMIN puede desvincular/);
      assert.equal(asSuper(`select origen_infra_id from public.fo_cables where id='${cable}';`), infra);
    });

    await t.test('SUPERADMIN SI puede desvincular un extremo de cable ya conectado y queda logueado', () => {
      reset();
      const infra = asSuper(`insert into public.infra_elementos (tipo) values ('nap') returning id;`);
      const cable = asSuper(`insert into public.fo_cables (origen_infra_id) values ('${infra}') returning id;`);
      asUser(`update public.fo_cables set origen_infra_id=null where id='${cable}';`, superadmin);
      assert.equal(asSuper(`select origen_infra_id from public.fo_cables where id='${cable}';`), '');
      assert.equal(asSuper(`select unlinked_by from public.fo_cable_endpoint_unlink_log where cable_id='${cable}';`), superadmin);
    });

    await t.test('TECNICO_RED sigue SIN poder desvincular un extremo ya conectado', () => {
      reset();
      const infra = asSuper(`insert into public.infra_elementos (tipo) values ('nap') returning id;`);
      const cable = asSuper(`insert into public.fo_cables (origen_infra_id) values ('${infra}') returning id;`);
      assert.throws(() => asUser(`update public.fo_cables set origen_infra_id=null where id='${cable}';`, tecnico), /Solo SUPERADMIN puede desvincular/);
    });

    await t.test('ADMIN sigue SIN poder llamar remove_from_network_map (exclusivo SUPERADMIN, decision final)', () => {
      reset();
      const infra = asSuper(`insert into public.infra_elementos (tipo) values ('mufa') returning id;`);
      const token = asSuper(`select md5(public.map_removal_snapshot('infra','${infra}',null)::text);`);
      assert.throws(() => asUser(`select public.remove_from_network_map('infra','${infra}','${token}',null);`, admin), /Solo SUPERADMIN puede eliminar elementos del mapa/);
      assert.equal(asSuper(`select coalesce(map_removed_at::text,'null') from public.infra_elementos where id='${infra}';`), 'null');
    });

    await t.test('SUPERADMIN SI puede llamar remove_from_network_map y queda auditado', () => {
      reset();
      const infra = asSuper(`insert into public.infra_elementos (tipo) values ('mufa') returning id;`);
      const token = asSuper(`select md5(public.map_removal_snapshot('infra','${infra}',null)::text);`);
      asUser(`select public.remove_from_network_map('infra','${infra}','${token}',null);`, superadmin);
      assert.notEqual(asSuper(`select map_removed_at from public.infra_elementos where id='${infra}';`), '');
      const audit = asSuper(`select actor_role, accion from public.admin_audit_log where tabla='network_map';`);
      assert.equal(audit, 'SUPERADMIN|infra_remove');
    });

    await t.test('TECNICO_RED sigue SIN poder llamar remove_from_network_map', () => {
      reset();
      const infra = asSuper(`insert into public.infra_elementos (tipo) values ('mufa') returning id;`);
      const token = asSuper(`select md5(public.map_removal_snapshot('infra','${infra}',null)::text);`);
      assert.throws(() => asUser(`select public.remove_from_network_map('infra','${infra}','${token}',null);`, tecnico), /Solo SUPERADMIN puede eliminar elementos del mapa/);
    });

    // ==================================================================
    // 4) Altas — edicion excepcional de una instalacion cerrada (ampliado)
    //    + cuadrilla, emparejado con lo que Averias/Rutinas ya permitian
    // ==================================================================
    await t.test('ADMIN ahora SI puede editar una instalacion completed/cancelled (antes solo SUPERADMIN) y queda auditado', () => {
      reset();
      const installE = asSuper(`insert into public.installations (status) values ('completed') returning id;`);
      asUser(`update public.installations set assigned_to='${tecnico}' where id='${installE}';`, admin);
      assert.equal(asSuper(`select assigned_to from public.installations where id='${installE}';`), tecnico);
      const audit = asSuper(`select actor_role, accion from public.admin_audit_log where tabla='installations';`);
      assert.equal(audit, 'ADMIN|exception_edit');
    });

    await t.test('TECNICO_RED sigue SIN poder editar una instalacion completed/cancelled (0 filas, sin error)', () => {
      reset();
      const installF = asSuper(`insert into public.installations (status) values ('cancelled') returning id;`);
      asUser(`update public.installations set assigned_to='${tecnico}' where id='${installF}';`, tecnico);
      assert.equal(asSuper(`select coalesce(assigned_to::text,'null') from public.installations where id='${installF}';`), 'null');
    });

    await t.test('ADMIN ahora SI puede tocar la cuadrilla de una instalacion cerrada (antes solo SUPERADMIN)', () => {
      reset();
      const installE = asSuper(`insert into public.installations (status) values ('completed') returning id;`);
      asUser(`insert into public.job_assignees values ('installation','${installE}','${tecnico}','leader');`, admin);
      assert.equal(asSuper(`select count(*) from public.job_assignees where job_id='${installE}';`), '1');
    });

    // ==================================================================
    // 5) Asistencia — resolver ausencias y crear novedades (ampliado),
    //    incluye el bug de auditoria corregido (actor_rol ya no queda
    //    hardcodeado en 'SUPERADMIN' cuando resuelve ADMIN).
    // ==================================================================
    await t.test('ADMIN ahora SI puede resolver una ausencia (antes solo SUPERADMIN) y el evento de auditoria dice ADMIN, no SUPERADMIN (bug corregido)', () => {
      reset();
      const solicitud = asSuper(`insert into public.asistencia_solicitudes (user_id, fecha, motivo) values ('${tecnico}','2026-12-01','salud') returning id;`);
      asUser(`select public.resolver_ausencia('${solicitud}', 0, 'aprobada', 'Justificado con certificado médico');`, admin);
      assert.equal(asSuper(`select estado from public.asistencia_solicitudes where id='${solicitud}';`), 'aprobada');
      const actorRol = asSuper(`select actor_rol from public.asistencia_solicitud_eventos where solicitud_id='${solicitud}' and estado_nuevo='aprobada';`);
      assert.equal(actorRol, 'ADMIN');
    });

    await t.test('TECNICO_RED sigue SIN poder resolver ausencias', () => {
      reset();
      const solicitud = asSuper(`insert into public.asistencia_solicitudes (user_id, fecha, motivo) values ('${tecnico}','2026-12-02','salud') returning id;`);
      assert.throws(() => asUser(`select public.resolver_ausencia('${solicitud}', 0, 'aprobada', 'motivo');`, tecnico), /Solo SUPERADMIN o ADMIN pueden resolver/);
    });

    await t.test('ADMIN ahora SI puede crear una novedad (vacaciones) para un TECNICO_RED (antes solo SUPERADMIN)', () => {
      reset();
      const opId = asSuper(`select gen_random_uuid();`);
      asUser(`select public.asistencia_novedad_crear('${opId}', '${tecnico}', 'vacaciones', '2026-12-10', '2026-12-15', null, null, null, 'Vacaciones anuales');`, admin);
      assert.equal(asSuper(`select count(*) from public.asistencia_novedades where user_id='${tecnico}' and estado='activa';`), '1');
    });

    await t.test('TECNICO_RED sigue SIN poder crear novedades para si mismo', () => {
      reset();
      const opId = asSuper(`select gen_random_uuid();`);
      assert.throws(() => asUser(`select public.asistencia_novedad_crear('${opId}', '${tecnico}', 'vacaciones', '2026-12-10', '2026-12-15', null, null, null, null);`, tecnico), /Solo SUPERADMIN o ADMIN configuran novedades/);
    });

    // ==================================================================
    // 6) Cambios de rol/activacion de cuentas quedan auditados; la tabla
    //    de auditoria en si es inmutable para TODOS (ni SUPERADMIN puede
    //    editar/borrar el historial).
    // ==================================================================
await t.test('Cambiar el rol de una cuenta vía sesión normal (RLS) queda auditado con actor, antes y despues completos', () => {
      reset();
      // Simula el camino donde SI hay JWT real (ej. una futura RPC
      // dedicada) — auth.uid() se resuelve y el actor queda identificado.
      asUser(`update public.profiles set role='ADMIN' where id='${tecnico}';`, superadmin);
      const audit = asSuper(`select actor_role, anterior->>'role', nuevo->>'role' from public.admin_audit_log where tabla='profiles';`);
      assert.equal(audit, 'SUPERADMIN|TECNICO_RED|ADMIN');
    });

    await t.test('Cambiar el rol vía el camino real de produccion (service_role, sin JWT) igual queda registrado — sin actor identificable, pero sin perder el rastro de que/cuando', () => {
      reset();
      // users.ts usa supabaseAdmin (service_role): no hay auth.uid(). El
      // trigger no debe reventar — debe loguear con actor NULL en vez de
      // perder el evento. Limitacion conocida y documentada en la migracion.
      asSuper(`update public.profiles set role='ADMIN' where id='${tecnico}';`);
      const audit = asSuper(`select coalesce(actor_id::text,'NULL'), anterior->>'role', nuevo->>'role' from public.admin_audit_log where tabla='profiles';`);
      assert.equal(audit, 'NULL|TECNICO_RED|ADMIN');
    });

    await t.test('admin_audit_log es insert-only: ni SUPERADMIN puede editar o borrar una fila del historial', () => {
      reset();
      asUser(`update public.profiles set role='ADMIN' where id='${tecnico}';`, superadmin);
      const id = asSuper(`select id from public.admin_audit_log limit 1;`);
      assert.throws(() => asUser(`update public.admin_audit_log set motivo='manipulado' where id='${id}';`, superadmin), /permission denied|row-level security/i);
      assert.throws(() => asUser(`delete from public.admin_audit_log where id='${id}';`, superadmin), /permission denied|row-level security/i);
      assert.equal(asSuper(`select motivo from public.admin_audit_log where id='${id}';`), '');
    });

    await t.test('TECNICO_RED no puede leer el historial de auditoria administrativa (0 filas visibles, sin error)', () => {
      reset();
      // Un cuarto perfil (no "tecnico") para no mutar el propio rol del
      // actor que se usa como TECNICO_RED en el resto de las pruebas.
      const otherTecnico = '00000000-0000-0000-0000-000000000005';
      asSuper(`insert into public.profiles (id, role, active) values ('${otherTecnico}','TECNICO_RED',true);`);
      asUser(`update public.profiles set role='ADMIN' where id='${otherTecnico}';`, superadmin);
      assert.equal(asUser(`select count(*) from public.admin_audit_log;`, tecnico), '0');
      assert.equal(asUser(`select count(*) from public.admin_audit_log;`, admin), '1');
    });

    // ==================================================================
    // 7) Rollback probado de punta a punta: revierte el ROL exacto y
    //    confirma que NO borra ninguna fila de auditoria ya escrita.
    // ==================================================================
    await t.test('ROLLBACK: ADMIN vuelve a NO poder desactivar productos ni editar una instalacion cerrada (comportamiento anterior restaurado), sin borrar auditoria previa', () => {
      reset();
      const product = asSuper(`insert into public.inventory_products (name) values ('Router Rollback') returning id;`);
      asUser(`update public.inventory_products set is_active=false where id='${product}';`, admin);
      const auditRowsBeforeRollback = asSuper(`select count(*) from public.admin_audit_log;`);
      assert.equal(auditRowsBeforeRollback, '1');

      asSuper(sqlFile('../../supabase/rollback/20261124120000_admin_operational_parity_rollback.sql'));
      try {
        const product2 = asSuper(`insert into public.inventory_products (name) values ('Router Rollback 2') returning id;`);
        assert.throws(() => asUser(`update public.inventory_products set is_active=false where id='${product2}';`, admin), /Solo el Super Admin tiene permisos/);

        const installE = asSuper(`insert into public.installations (status) values ('completed') returning id;`);
        asUser(`update public.installations set assigned_to='${tecnico}' where id='${installE}';`, admin);
        assert.equal(asSuper(`select coalesce(assigned_to::text,'null') from public.installations where id='${installE}';`), 'null');
        asUser(`update public.installations set assigned_to='${tecnico}' where id='${installE}';`, superadmin);
        assert.equal(asSuper(`select assigned_to from public.installations where id='${installE}';`), tecnico);

        // La fila de auditoria escrita ANTES del rollback sigue intacta
        // (el conteo total puede CRECER — la edicion de SUPERADMIN de
        // arriba genera su propia fila legitima nueva — pero nunca ENCOGE).
        const auditRowsAfterRollback = Number(asSuper(`select count(*) from public.admin_audit_log;`));
        assert.ok(auditRowsAfterRollback >= Number(auditRowsBeforeRollback), 'el rollback no debe borrar auditoria previa');
        assert.equal(asSuper(`select exists(select 1 from public.admin_audit_log where entidad_id='${product}');`), 't');
      } finally {
        // Deja la base lista para lo que siga: vuelve a aplicar la migracion de avance.
        asSuper(sqlFile('../../supabase/migrations/20261124120000_admin_operational_parity.sql'));
      }
    });
  } finally {
    try { docker(['stop', container]); } catch { /* Already removed after a startup failure. */ }
  }
});
