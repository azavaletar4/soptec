import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tech = '00000000-0000-0000-0000-000000000003';
const support = '00000000-0000-0000-0000-000000000007';
const admin = '00000000-0000-0000-0000-000000000002';
const routine = '30000000-0000-0000-0000-000000000001';
const migration = '../../supabase/migrations/20261014180000_fase161_devolver_rutinas.sql';

test('Devoluciones de rutinas: PostgreSQL aislado, sin red ni datos reales', { timeout: 60000 }, async t => {
  const container = `smartrayco-routine-returns-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  const user = (s: string, uid = tech) => sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
  const call = `select public.return_routine('${routine}', '  No puedo continuar  ');`;
  const reset = () => sql(`truncate routine_returns, job_work_sessions, job_assignees, routines, tickets, installations;
    insert into routines(id,status,assigned_to,closure_notes) values ('${routine}','pending','${tech}','Conservar');
    insert into job_assignees values ('routine','${routine}','${tech}','leader'),('routine','${routine}','${support}','support');
    update routines set status='in_progress' where id='${routine}';`);
  const unchanged = () => {
    assert.equal(sql(`select status || '|' || assigned_to || '|' || closure_notes from routines;`), `in_progress|${tech}|Conservar`);
    assert.equal(sql('select count(*) from job_assignees;'), '2');
    assert.equal(sql('select count(*) from routine_returns;'), '0');
  };
  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(ready);
    sql(file('./jobWorkSessionsSchema.sql'));
    sql(`alter table routines add column closure_notes text;
      insert into profiles values ('${support}','TECNICO_RED',true);
      create table ticket_comments(ticket_id uuid, author_id uuid, body text);
      alter table job_assignees enable row level security;
      alter table routines enable row level security;
      alter table profiles enable row level security;`);
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    // Policies reales, cargadas sin reescribir sus condiciones.
    const crewSql = file('../../supabase/migrations/20261004000000_fase94_cuadrilla_multiples_tecnicos.sql');
    sql(crewSql.match(/create policy "job_assignees_select_staff"[\s\S]*?;/)![0]);
    sql(file('../../supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql').match(/create policy "job_assignees_write_dispatch"[\s\S]*?;/)![0]);
    const routinesSql = file('../../supabase/migrations/20261005020000_fase101_rutinas_mantenimiento.sql');
    sql(routinesSql.match(/create policy "routines_select_staff"[\s\S]*?;/)![0]);
    sql(routinesSql.match(/create policy "routines_update_staff"[\s\S]*?;/)![0]);
    sql(file('../../supabase/migrations/20260910180000_fase6_soporte_tickets.sql').match(/create policy "profiles_select_staff_for_assignment"[\s\S]*?;/)![0]);
    sql(file('../../supabase/migrations/20261005020000_fase101_rutinas_mantenimiento.sql').match(/create or replace function public\.sync_assigned_to_from_job_assignees\(\)[\s\S]*?\$\$;/)![0]);
    sql(`create trigger sync_crew after insert or update or delete on job_assignees for each row execute function sync_assigned_to_from_job_assignees();`);
    sql(file('../../supabase/migrations/20261012140000_fase150_sesiones_trabajo.sql'));
    sql(file('../../supabase/migrations/20261012200000_fase150b_fix_track_job_work_session_enum.sql'));
    sql(file('../../supabase/migrations/20261005010000_fase99_tecnico_devuelve_ticket.sql'));
    sql(file(migration));
    await t.test('devolucion valida: motivo, responsable, hora, cuadrilla y sesion', () => {
      reset(); user(call);
      assert.equal(sql(`select status || '|' || coalesce(assigned_to::text,'libre') || '|' || closure_notes from routines;`), 'pending|libre|Conservar');
      assert.equal(sql('select count(*) from job_assignees;'), '0');
      assert.equal(user(`select technician_id || '|' || reason || '|' || jsonb_array_length(crew_snapshot) || '|' || (returned_at <= clock_timestamp()) from routine_returns;`, admin), `${tech}|No puedo continuar|2|true`);
      assert.equal(sql("select end_reason from job_work_sessions where job_type='routine';"), 'paused');
    });
    await t.test('apoyo asignado tambien puede devolver', () => { reset(); user(call, support); assert.equal(sql('select technician_id from routine_returns;'), support); });
    for (const uid of [admin, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', '']) {
      await t.test(`identidad no autorizada ${uid || 'sin sesion'}`, () => { reset(); assert.throws(() => user(call, uid), /Solo un tecnico/); unchanged(); });
    }
    await t.test('tecnico inactivo', () => { reset(); sql(`update profiles set active=false where id='${tech}';`); assert.throws(() => user(call), /Solo un tecnico/); unchanged(); sql(`update profiles set active=true where id='${tech}';`); });
    await t.test('tecnico ajeno a cuadrilla', () => { reset(); sql(`delete from job_assignees where technician_id='${support}';`); assert.throws(() => user(call, support), /No estas asignado/); assert.equal(sql('select count(*) from routine_returns;'), '0'); });
    for (const reason of ['NULL', "''", "'   '"]) {
      await t.test(`motivo obligatorio ${reason}`, () => { reset(); assert.throws(() => user(`select return_routine('${routine}',${reason});`), /motivo/); unchanged(); });
    }
    for (const status of ['pending', 'scheduled', 'completed', 'cancelled']) {
      await t.test(`estado rechazado ${status}`, () => { reset(); sql(`update routines set status='${status}';`); assert.throws(() => user(call), /en progreso/); assert.equal(sql('select count(*) from routine_returns;'), '0'); assert.equal(sql('select count(*) from job_assignees;'), '2'); });
    }
    await t.test('rutina inexistente', () => { reset(); assert.throws(() => user("select return_routine('30000000-0000-0000-0000-000000000099','motivo');"), /no existe/); unchanged(); });
    await t.test('duplicada rechazada, nuevo ciclo conserva historial', () => {
      reset(); user(call); assert.throws(() => user(call), /en progreso/);
      sql(`insert into job_assignees values ('routine','${routine}','${tech}','leader'); update routines set status='in_progress';`);
      user(call); assert.equal(sql('select count(*) from routine_returns;'), '2');
    });
    await t.test('fallo al liberar cuadrilla revierte registro, estado y sesion', () => {
      reset();
      sql(`create function fail_delete() returns trigger language plpgsql as $$ begin raise exception 'Fallo simulado'; end $$;
        create trigger fail_delete before delete on job_assignees for each row execute function fail_delete();`);
      try {
        assert.throws(() => user(call), /Fallo simulado/); unchanged();
        assert.equal(sql('select count(*) from job_work_sessions where ended_at is null;'), '1');
      } finally { sql('drop trigger fail_delete on job_assignees; drop function fail_delete();'); }
    });
    await t.test('permisos: sin escritura directa, anon sin RPC, lectura oficina', () => {
      reset(); user(call);
      for (const uid of [tech, admin]) {
        assert.throws(() => user(`insert into routine_returns(routine_id,technician_id,reason,crew_snapshot) values ('${routine}','${tech}','falso','[]');`,uid), /permission denied/);
        assert.throws(() => user('delete from routine_returns;',uid), /permission denied/);
        assert.throws(() => user("update routine_returns set reason='falso';",uid), /permission denied/);
        assert.equal(user('select count(*) from routine_returns;',uid), '1');
      }
      assert.equal(user('select count(*) from routine_returns;', '00000000-0000-0000-0000-000000000006'), '0');
      assert.throws(() => sql(`set role anon; ${call}`), /permission denied/);
      assert.throws(() => sql(`delete from routines where id='${routine}';`), /foreign key/);
    });
    await t.test('RLS de cuadrilla sigue impidiendo que el tecnico libere ordenes directamente', () => {
      reset(); user(`delete from job_assignees where job_type='routine' and job_id='${routine}';`); unchanged();
      user(call);
      assert.equal(user(`select count(*) from routine_returns r join profiles p on p.id=r.technician_id;`,admin),'1');
      // Oficina puede reasignar con su policy existente; el historial no se borra.
      user(`insert into job_assignees values ('routine','${routine}','${support}','leader');`,admin);
      assert.equal(sql('select assigned_to from routines;'),support);
      assert.equal(sql('select count(*) from routine_returns;'),'1');
    });
    await t.test('dos devoluciones concurrentes: una sola gana', async () => {
      reset();
      const run = () => new Promise<number>(resolve => {
        const p = spawn('docker',args,{windowsHide:true}); p.stdout.resume(); p.stderr.resume();
        p.on('close',code => resolve(code ?? 1)); p.stdin.end(`set role authenticated; set request.jwt.claim.sub='${tech}'; ${call}`);
      });
      const codes = await Promise.all([run(),run()]); assert.equal(codes.filter(c => c === 0).length,1);
      assert.equal(sql('select count(*) from routine_returns;'), '1'); assert.equal(sql('select count(*) from job_assignees;'), '0');
    });
    await t.test('regresion: Averia usa RPC original y Alta conserva asignacion/estado', () => {
      reset();
      sql(`insert into tickets(id,status,assigned_to) values ('10000000-0000-0000-0000-000000000001','in_progress','${tech}');
        insert into installations(id,status,assigned_to) values ('20000000-0000-0000-0000-000000000001','in_progress','${tech}');
        insert into job_assignees values ('ticket','10000000-0000-0000-0000-000000000001','${tech}','leader'),('installation','20000000-0000-0000-0000-000000000001','${tech}','leader');`);
      user(call); assert.equal(sql('select status from tickets;'),'in_progress');
      user("select return_ticket('10000000-0000-0000-0000-000000000001','Motivo averia');");
      assert.equal(sql('select status from tickets;'),'open');
      assert.equal(sql('select body from ticket_comments;'),'↩️ Orden devuelta — Motivo averia');
      assert.equal(sql('select status from installations;'),'in_progress');
      assert.equal(sql("select count(*) from job_assignees where job_type='installation';"),'1');
    });
  } finally { try { docker(['rm','-f',container]); } catch {} }
});
