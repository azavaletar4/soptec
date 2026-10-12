import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const superadmin = '00000000-0000-0000-0000-000000000001';
const admin = '00000000-0000-0000-0000-000000000002';
const tech1 = '00000000-0000-0000-0000-000000000003'; // TECNICO_RED
const soporte = '00000000-0000-0000-0000-000000000004';
const facturacion = '00000000-0000-0000-0000-000000000005';
const cliente = '00000000-0000-0000-0000-000000000006';
const ticketA = '10000000-0000-0000-0000-000000000001';
const installE = '20000000-0000-0000-0000-000000000001';
const routineF = '30000000-0000-0000-0000-000000000001';

test('PostgreSQL isolated: sesiones de trabajo por orden (Fase 150, propuesta)', { timeout: 60000 }, async t => {
  const container = `smartrayco-fase150-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();
  const asUser = (sql: string, user: string) => query(`set role authenticated; set request.jwt.claim.sub='${user}'; ${sql} reset role;`);

  const reset = () => query(`
    truncate public.job_work_sessions, public.job_assignees, public.tickets, public.installations, public.routines;
    insert into public.tickets (id, status, ticket_number) values ('${ticketA}', 'open', 'T-A');
    insert into public.installations (id, status) values ('${installE}', 'pending');
    insert into public.routines (id, status, routine_number) values ('${routineF}', 'pending', 'R-F');
    insert into public.job_assignees (job_type, job_id, technician_id, role) values
      ('ticket', '${ticketA}', '${tech1}', 'leader'),
      ('installation', '${installE}', '${tech1}', 'leader'),
      ('routine', '${routineF}', '${tech1}', 'leader');
  `);
  const setStatus = (table: string, id: string, status: string) => query(`update public.${table} set status='${status}' where id='${id}';`);
  const sessionsFor = (jobType: string, id: string) =>
    query(`select started_at, ended_at, end_reason from public.job_work_sessions where job_type='${jobType}' and job_id='${id}' order by started_at;`);
  const countSessions = (jobType: string, id: string) =>
    Number(query(`select count(*) from public.job_work_sessions where job_type='${jobType}' and job_id='${id}';`));
  const openSessionCount = (jobType: string, id: string) =>
    Number(query(`select count(*) from public.job_work_sessions where job_type='${jobType}' and job_id='${id}' and ended_at is null;`));

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');
    query(sqlFile('./jobWorkSessionsSchema.sql'));
    // current_user_role() tal cual vive en produccion (Fase 13) — mismo
    // patron de extraccion que closedOrders.sql.test.ts/napAssignment.sql.test.ts.
    const roleSql = sqlFile('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql')
      .match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0];
    query(roleSql);
    query(sqlFile('../../supabase/migrations/20261010140000_fase137_un_ticket_activo_por_tecnico.sql'));
    query(sqlFile('../../supabase/migrations/20261012140000_fase150_sesiones_trabajo.sql'));
    // Fase 150b: hotfix del bug real de produccion — sin esto, cualquier
    // UPDATE que saque una instalacion/rutina de 'in_progress' revienta con
    // "invalid input value for enum installation_status/routine_status"
    // (ver migracion para la causa raiz completa).
    query(sqlFile('../../supabase/migrations/20261012200000_fase150b_fix_track_job_work_session_enum.sql'));
    // job_work_sessions se crea recien arriba — el GRANT de tabla de
    // jobWorkSessionsSchema.sql (que corre antes) no la alcanza.
    query(`grant all on public.job_work_sessions to anon, authenticated, service_role;`);

    await t.test('entrar a in_progress abre una sesion', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      assert.equal(countSessions('ticket', ticketA), 1);
      assert.equal(openSessionCount('ticket', ticketA), 1);
    });

    await t.test('terminar con exito cierra la sesion con end_reason=finished', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      setStatus('tickets', ticketA, 'resolved');
      const rows = sessionsFor('ticket', ticketA).split('\n');
      assert.equal(rows.length, 1);
      assert.ok(rows[0].includes('|finished'));
      assert.equal(openSessionCount('ticket', ticketA), 0);
    });

    await t.test('instalacion completada cierra con end_reason=finished', () => {
      reset();
      setStatus('installations', installE, 'in_progress');
      setStatus('installations', installE, 'completed');
      assert.ok(sessionsFor('installation', installE).includes('|finished'));
    });

    await t.test('rutina completada cierra con end_reason=finished (escenario exacto del incidente real: "Completar rutina")', () => {
      reset();
      setStatus('routines', routineF, 'in_progress');
      setStatus('routines', routineF, 'completed');
      assert.ok(sessionsFor('routine', routineF).includes('|finished'));
      assert.equal(openSessionCount('routine', routineF), 0);
    });

    await t.test('rutina cancelada en curso cierra con end_reason=cancelled_order (mismo enum, otra transicion fuera de in_progress)', () => {
      reset();
      setStatus('routines', routineF, 'in_progress');
      setStatus('routines', routineF, 'cancelled');
      assert.ok(sessionsFor('routine', routineF).includes('|cancelled_order'));
    });

    await t.test('cancelar una orden en curso cierra la sesion con end_reason=cancelled_order (se cuenta el tiempo trabajado)', () => {
      reset();
      setStatus('installations', installE, 'in_progress');
      setStatus('installations', installE, 'cancelled');
      assert.ok(sessionsFor('installation', installE).includes('|cancelled_order'));
      assert.equal(openSessionCount('installation', installE), 0);
    });

    await t.test('salir a un estado que no es cierre (pausa real) marca end_reason=paused, y retomar abre una SEGUNDA sesion', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      setStatus('tickets', ticketA, 'rescheduled'); // Cliente Ausente, Fase 102 — tecnico deja la orden sin terminar
      let rows = sessionsFor('ticket', ticketA).split('\n');
      assert.equal(rows.length, 1);
      assert.ok(rows[0].includes('|paused'));
      // Retoma mas tarde — nueva sesion, la primera sigue cerrada tal cual quedo.
      setStatus('tickets', ticketA, 'in_progress');
      setStatus('tickets', ticketA, 'resolved');
      rows = sessionsFor('ticket', ticketA).split('\n');
      assert.equal(rows.length, 2, 'debe haber 2 sesiones: la pausada y la que termino');
      assert.ok(rows[0].includes('|paused'));
      assert.ok(rows[1].includes('|finished'));
    });

    await t.test('una orden completada SIN pasar nunca por in_progress no genera ninguna sesion (debe verse "No registrado")', () => {
      reset();
      setStatus('routines', routineF, 'completed'); // admin la completa directo, sin pasar por in_progress
      assert.equal(countSessions('routine', routineF), 0);
    });

    await t.test('cambios de estado que no tocan status (ej. editar notas) no generan filas de mas', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      query(`update public.tickets set ticket_number='T-A-edit' where id='${ticketA}';`);
      assert.equal(countSessions('ticket', ticketA), 1, 'editar otro campo no debe abrir/cerrar sesiones');
    });

    await t.test('el indice unico impide 2 sesiones abiertas para la misma orden (insert directo, sin pasar por el trigger)', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress'); // 1 sesion abierta via trigger
      assert.throws(
        () => query(`insert into public.job_work_sessions (job_type, job_id) values ('ticket', '${ticketA}');`),
        /duplicate key value violates unique constraint/,
      );
    });

    await t.test('la regla de "un solo trabajo activo por tecnico" (Fase 137) sigue intacta conviviendo con las sesiones', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      assert.throws(() => setStatus('installations', installE, 'in_progress'), /Ya tienes un ticket en ejecución/);
      // El intento bloqueado no debe haber abierto sesion para la instalacion.
      assert.equal(countSessions('installation', installE), 0);
    });

    // ---- Permisos RLS (pedido explicito: verificar RLS, no solo el trigger) ----
    await t.test('RLS: todo el staff interno puede leer job_work_sessions (SUPERADMIN/ADMIN/TECNICO_RED/SOPORTE/FACTURACION)', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      for (const user of [superadmin, admin, tech1, soporte, facturacion]) {
        const count = asUser(`select count(*) from public.job_work_sessions where job_type='ticket' and job_id='${ticketA}';`, user);
        assert.equal(count, '1', `rol de ${user} deberia ver la sesion`);
      }
    });

    await t.test('RLS: CLIENTE no puede leer job_work_sessions (no esta en la policy de select)', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      const count = asUser(`select count(*) from public.job_work_sessions where job_type='ticket' and job_id='${ticketA}';`, cliente);
      assert.equal(count, '0');
    });

    await t.test('RLS: NINGUN rol (ni SUPERADMIN) puede insertar una sesion a mano — solo el trigger (security definer) escribe aca', () => {
      reset();
      for (const user of [superadmin, admin, tech1]) {
        assert.throws(
          () => asUser(`insert into public.job_work_sessions (job_type, job_id) values ('ticket', '${ticketA}');`, user),
          /new row violates row-level security policy|permission denied/i,
          `rol de ${user} no deberia poder insertar directo`,
        );
      }
    });

    await t.test('RLS: NINGUN rol puede actualizar/borrar una sesion a mano (0 filas afectadas, sin policy de write)', () => {
      reset();
      setStatus('tickets', ticketA, 'in_progress');
      setStatus('tickets', ticketA, 'resolved');
      const before = sessionsFor('ticket', ticketA);
      asUser(`update public.job_work_sessions set end_reason='finished' where job_type='ticket' and job_id='${ticketA}' and end_reason='paused';`, superadmin);
      asUser(`delete from public.job_work_sessions where job_type='ticket' and job_id='${ticketA}';`, superadmin);
      assert.equal(sessionsFor('ticket', ticketA), before, 'la sesion real (escrita por el trigger) debe seguir intacta');
    });
  } finally {
    try { docker(['stop', container]); } catch { /* Already removed after a startup failure. */ }
  }
});
