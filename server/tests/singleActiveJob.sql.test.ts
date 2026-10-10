import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const tech1 = '00000000-0000-0000-0000-000000000001';
const tech2 = '00000000-0000-0000-0000-000000000002';
const tech3 = '00000000-0000-0000-0000-000000000003';
const ticketA = '10000000-0000-0000-0000-000000000001';
const ticketB = '10000000-0000-0000-0000-000000000002';
const ticketC = '10000000-0000-0000-0000-000000000003';
const ticketD = '10000000-0000-0000-0000-000000000004';
const ticketG = '10000000-0000-0000-0000-000000000005';
const installE = '20000000-0000-0000-0000-000000000001';
const routineF = '30000000-0000-0000-0000-000000000001';

test('PostgreSQL isolated: un tecnico solo tiene un ticket/alta/rutina en ejecucion a la vez', { timeout: 60000 }, async t => {
  const container = `smartrayco-fase137-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();
  const queryAsync = (sql: string) =>
    new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn('docker', psqlArgs, { windowsHide: true });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ code: code ?? 1, output }));
      child.stdin.end(sql);
    });

  const reset = () => query(`
    truncate public.job_assignees, public.tickets, public.installations, public.routines;
    insert into public.tickets (id, status, ticket_number) values
      ('${ticketA}', 'open', 'T-A'), ('${ticketB}', 'open', 'T-B'), ('${ticketC}', 'open', 'T-C'), ('${ticketD}', 'open', 'T-D'), ('${ticketG}', 'open', 'T-G');
    insert into public.installations (id, status) values ('${installE}', 'pending');
    insert into public.routines (id, status, routine_number) values ('${routineF}', 'pending', 'R-F');
    insert into public.job_assignees (job_type, job_id, technician_id, role) values
      ('ticket', '${ticketA}', '${tech1}', 'leader'),
      ('ticket', '${ticketB}', '${tech1}', 'leader'),
      ('ticket', '${ticketC}', '${tech2}', 'leader'),
      ('ticket', '${ticketD}', '${tech2}', 'support'),
      ('ticket', '${ticketG}', '${tech2}', 'leader'),
      ('installation', '${installE}', '${tech1}', 'leader'),
      ('routine', '${routineF}', '${tech1}', 'leader');
  `);
  const start = (table: string, id: string, toStatus = 'in_progress') => query(`update public.${table} set status='${toStatus}' where id='${id}';`);
  const addAssignee = (jobType: string, jobId: string, techId: string, role = 'support') =>
    query(`insert into public.job_assignees (job_type, job_id, technician_id, role) values ('${jobType}','${jobId}','${techId}','${role}');`);

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'isolated Postgres must start');
    query(sqlFile('./singleActiveJobSchema.sql'));
    query(sqlFile('../../supabase/migrations/20261010140000_fase137_un_ticket_activo_por_tecnico.sql'));
    query(sqlFile('../../supabase/migrations/20261010150000_fase137b_bloqueo_reasignacion_cuadrilla.sql'));

    await t.test('iniciar un trabajo sin nada activo funciona', () => {
      reset();
      start('tickets', ticketA);
      assert.equal(query(`select status from public.tickets where id='${ticketA}';`), 'in_progress');
    });

    await t.test('un segundo ticket del MISMO tecnico queda bloqueado mientras el primero sigue activo', () => {
      reset();
      start('tickets', ticketA);
      assert.throws(() => start('tickets', ticketB), /Ya tienes un ticket en ejecución/);
      assert.equal(query(`select status from public.tickets where id='${ticketB}';`), 'open');
    });

    await t.test('bloquea cruzando tipos: un ticket activo bloquea iniciar una instalacion o rutina', () => {
      reset();
      start('tickets', ticketA);
      assert.throws(() => start('installations', installE), /Ya tienes un ticket en ejecución/);
      assert.throws(() => start('routines', routineF), /Ya tienes un ticket en ejecución/);
    });

    await t.test('finalizar la atencion activa libera el cupo para iniciar otra', () => {
      reset();
      start('tickets', ticketA);
      start('tickets', ticketA, 'resolved');
      start('tickets', ticketB); // ya no debe tirar excepcion
      assert.equal(query(`select status from public.tickets where id='${ticketB}';`), 'in_progress');
    });

    await t.test('un tecnico distinto nunca se bloquea por el trabajo activo de otro', () => {
      reset();
      start('tickets', ticketA); // tech1 ocupado
      start('tickets', ticketC); // tech2, sin relacion
      assert.equal(query(`select status from public.tickets where id='${ticketC}';`), 'in_progress');
    });

    await t.test('un integrante de apoyo (no lider) tambien queda bloqueado, igual que el lider', () => {
      reset();
      start('tickets', ticketC); // tech2 lider de C
      // tech2 tambien es 'support' en ticketD (ver reset()) — debe bloquear igual.
      assert.throws(() => start('tickets', ticketD), /Ya tienes un ticket en ejecución/);
    });

    await t.test('dos dispositivos iniciando simultaneamente: solo uno de los dos tiene exito', async () => {
      reset();
      const outcomes = await Promise.all([
        queryAsync(`begin; update public.tickets set status='in_progress' where id='${ticketA}'; select pg_sleep(0.3); commit;`),
        queryAsync(`begin; update public.tickets set status='in_progress' where id='${ticketB}'; select pg_sleep(0.3); commit;`),
      ]);
      assert.equal(outcomes.filter(r => r.code === 0).length, 1, 'exactamente una de las dos debe confirmar');
      const failed = outcomes.find(r => r.code !== 0);
      assert.ok(failed?.output.includes('Ya tienes un ticket en ejecución'));
      const statuses = query(`select status from public.tickets where id in ('${ticketA}','${ticketB}') order by id;`);
      // Una queda in_progress, la otra conserva 'open' (el rollback de la transaccion perdedora).
      assert.equal(statuses.split('\n').filter(s => s === 'in_progress').length, 1);
      assert.equal(statuses.split('\n').filter(s => s === 'open').length, 1);
    });

    // ---- Fase 137b: reasignacion de cuadrilla ----

    await t.test('sumar a un tecnico a un trabajo PENDIENTE nunca se bloquea, aunque ya tenga otro en curso', () => {
      reset();
      start('tickets', ticketA); // tech1 ocupado
      addAssignee('ticket', ticketC, tech1, 'support'); // ticketC sigue 'open' (tech2 es su lider) — no debe tirar excepcion
      assert.equal(query(`select count(*) from public.job_assignees where job_type='ticket' and job_id='${ticketC}' and technician_id='${tech1}';`), '1');
    });

    await t.test('sumar a un tecnico OCUPADO a un trabajo YA EN CURSO de otro lider se bloquea', () => {
      reset();
      start('tickets', ticketA); // tech1 ocupado
      start('tickets', ticketG); // tech2 lider de G, ahora en curso
      assert.throws(() => addAssignee('ticket', ticketG, tech1, 'support'), /Este técnico ya tiene un trabajo en ejecución/);
      assert.equal(query(`select count(*) from public.job_assignees where job_type='ticket' and job_id='${ticketG}' and technician_id='${tech1}';`), '0');
    });

    await t.test('sumar a un tecnico LIBRE a un trabajo ya en curso funciona normalmente', () => {
      reset();
      start('tickets', ticketG); // tech2 lider de G, en curso
      addAssignee('ticket', ticketG, tech3, 'support'); // tech3 no tiene nada activo
      assert.equal(query(`select count(*) from public.job_assignees where job_type='ticket' and job_id='${ticketG}' and technician_id='${tech3}';`), '1');
    });

    await t.test('reinsertar al mismo tecnico en SU PROPIO trabajo ya en curso no se autobloquea', () => {
      reset();
      start('tickets', ticketA); // tech1 lider y ocupado en A
      // on conflict do nothing: mismo patron que add_support_technician (Fase 121) al reintentar.
      query(`insert into public.job_assignees (job_type, job_id, technician_id, role) values ('ticket','${ticketA}','${tech1}','leader')
             on conflict (job_type, job_id, technician_id) do nothing;`);
      assert.equal(query(`select count(*) from public.job_assignees where job_type='ticket' and job_id='${ticketA}' and technician_id='${tech1}';`), '1');
    });

    await t.test('un administrador gestiona varias ordenes sin saltarse la restriccion (solo bloquea al tecnico, no a quien gestiona)', () => {
      reset();
      start('tickets', ticketA); // tech1 ocupado
      start('tickets', ticketG); // tech2 ocupado, orden distinta
      // "Gestionar" = leer/editar ambas ordenes libremente (ningun campo de status) y
      // sumar tecnicos LIBRES a cualquiera de las dos — nada de esto pasa por la regla,
      // que solo mira al TECNICO que se intenta sumar, nunca a quien ejecuta la accion.
      query(`update public.tickets set ticket_number='T-A-edit' where id='${ticketA}';`);
      query(`update public.tickets set ticket_number='T-G-edit' where id='${ticketG}';`);
      addAssignee('ticket', ticketA, tech3, 'support');
      assert.equal(query(`select ticket_number from public.tickets where id='${ticketA}';`), 'T-A-edit');
      assert.equal(query(`select ticket_number from public.tickets where id='${ticketG}';`), 'T-G-edit');
      assert.equal(query(`select count(*) from public.job_assignees where technician_id='${tech3}';`), '1');
    });

    await t.test('concurrencia cruzada: el propio tecnico iniciando Y un admin sumandolo a otro en curso — solo uno de los dos tiene exito', async () => {
      reset();
      start('tickets', ticketG); // tech2 lider de G, ya en curso — candidato a sumar a tech1
      const outcomes = await Promise.all([
        queryAsync(`begin; update public.tickets set status='in_progress' where id='${ticketB}'; select pg_sleep(0.3); commit;`), // tech1 se auto-inicia en B
        queryAsync(`begin; insert into public.job_assignees (job_type, job_id, technician_id, role) values ('ticket','${ticketG}','${tech1}','support'); select pg_sleep(0.3); commit;`), // admin suma tech1 a G
      ]);
      assert.equal(outcomes.filter(r => r.code === 0).length, 1, 'exactamente una de las dos debe confirmar');
      const failed = outcomes.find(r => r.code !== 0);
      assert.ok(/ejecución/.test(failed?.output ?? ''));
    });
  } finally {
    try { docker(['stop', container]); } catch { /* Already removed after a startup failure. */ }
  }
});
