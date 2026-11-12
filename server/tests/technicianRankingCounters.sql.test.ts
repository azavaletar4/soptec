import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tech = '00000000-0000-0000-0000-000000000003';
const helper = '00000000-0000-0000-0000-000000000004';
const admin = '00000000-0000-0000-0000-000000000002';
const candidate = file('../queries/technicianRankingCounters.sql');
const baseline = file('./technicianRankingCountersBaseline.sql');
const declaration = baseline.slice(baseline.indexOf('CREATE OR REPLACE FUNCTION'), baseline.indexOf('AS $function$'));

test('Ranking: consulta candidata en PostgreSQL aislado, sin red ni datos reales', { timeout: 180000 }, async t => {
  const container = `rayco-ranking-counters-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, {
    input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const sql = (query: string) => docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1',
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], query).trim();
  const installCandidate = () => sql(`${declaration} AS $function$\n${candidate}\n$function$;`);
  const rows = (start = '2026-11-01 05:00Z', end = '2026-12-01 05:00Z') => JSON.parse(sql(
    `select coalesce(jsonb_agg(r order by technician_id),'[]') from technician_ranking_between('${start}','${end}') r;`,
  ));
  const stableFields = (data: any[]) => data.map(({ averias_count, rutinas_count, ...rest }) => rest);
  const compare = (start?: string, end?: string) => {
    sql(baseline);
    const before = rows(start, end);
    installCandidate();
    const after = rows(start, end);
    assert.deepEqual(stableFields(after), stableFields(before), 'Puntos, ranking, Altas, reconexiones y penalizaciones intactos');
    return { before, after };
  };
  let sequence = 0;
  const reset = () => sql('truncate work_order_point_confirmations,work_order_point_changes,tickets,installations,routines,job_assignees;');
  const add = (kind: 'ticket' | 'routine' | 'installation', options: {
    category?: string; points?: number; crew?: boolean; confirm?: boolean;
    done?: string; confirmedAt?: string; createdAt?: string; status?: string;
  } = {}) => {
    const id = `10000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`;
    const table = { ticket: 'tickets', routine: 'routines', installation: 'installations' }[kind];
    const status = options.status ?? (kind === 'ticket' ? 'resolved' : 'completed');
    const done = options.done ?? '2026-11-06 14:32Z';
    const points = options.points ?? 2;
    sql(`insert into ${table}(id,points,status,assigned_to,created_at,${kind === 'ticket' ? 'resolved_at' : 'completed_at'}${kind === 'ticket' ? ',category' : ''})
      values('${id}',${points},'${status}','${tech}','${options.createdAt ?? '2026-11-02 06:00Z'}','${done}'${kind === 'ticket' ? `,'${options.category ?? 'other'}'` : ''});`);
    if (options.crew) sql(`insert into job_assignees values('${kind}','${id}','${tech}','leader'),('${kind}','${id}','${helper}','support');`);
    if (options.confirm !== false) {
      sql(`set role authenticated;set request.jwt.claim.sub='${admin}';
        select confirm_work_order_points('${kind}','${id}',${points},work_order_point_review('${kind}','${id}')->>'token','Caso sintetico de ranking',true);`);
      // Reloj de fixture local: nunca se ejecuta contra Supabase.
      sql(`update work_order_point_confirmations set confirmed_at='${options.confirmedAt ?? '2026-11-06 15:18Z'}' where job_id='${id}';`);
    }
    return id;
  };
  try {
    docker(['run', '--rm', '-d', '--pull=never', '--name', container, '--network', 'none',
      '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'PostgreSQL local disponible');
    sql(file('./jobWorkSessionsSchema.sql'));
    sql(`alter table profiles add column full_name text,add column email text;
      update profiles set full_name='Tecnico sintetico'; update profiles set role='TECNICO_RED' where id='${helper}';
      alter table tickets add column points integer,add column category text default 'other',add column client_id uuid,
        add column created_at timestamptz default '2026-11-02 06:00Z',add column resolved_at timestamptz,add column closed_at timestamptz,add column imputable_a_tecnico boolean default false;
      alter table installations add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 06:00Z';
      alter table routines add column points numeric,add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 06:00Z';
      grant usage on schema auth to authenticated;`);
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    sql(file('./workOrderPointsContributionBaseline.sql'));
    sql(file('./pointConfirmationRankingBaseline.sql'));
    sql(file('./workOrderPointsDefaultPrivileges.sql'));
    for (const migration of ['20261024180000_work_order_points', '20261024190000_field_order_points_readonly',
      '20261024200000_work_order_point_confirmations', '20261102220000_technician_points_october_november_boundary']) {
      sql(file(`../../supabase/migrations/${migration}.sql`)); // Solo contenedor local aislado.
    }
    const periodFunction = file('../../supabase/migrations/20261020170000_mi_avance_personal_ranking_compartido.sql')
      .match(/create function public\.get_technician_period_ranking[\s\S]*?end \$\$;/)![0];
    sql(periodFunction);
    const sourceDefinition = sql("select pg_get_functiondef('technician_point_contributions(timestamptz,timestamptz)'::regprocedure);");

    await t.test('Reproduce TCK: ticket other confirmado, contador 0 -> 1 y puntos 2 -> 2', () => {
      reset(); add('ticket');
      const { before, after } = compare();
      assert.equal(before[0].averias_count, 0);
      assert.equal(after[0].averias_count, 1);
      assert.equal(after[0].total_points, 2);
      for (const period of ['day', 'week', 'month']) {
        const result = JSON.parse(sql(`set role service_role;select get_technician_period_ranking('${period}','2026-11-06');`));
        assert.equal(result.ranking[0].averias_count, 1);
        assert.equal(result.ranking[0].total_points, 2);
      }
      assert.equal(JSON.parse(sql('set role service_role;select to_jsonb(r) from get_technician_ranking(11,2026) r;')).averias_count, 1);
    });

    await t.test('Solo categorias tecnicas u other acreditado; billing e installation no son averias', () => {
      reset();
      for (const category of ['no_service', 'slow_speed', 'equipment', 'other', 'billing', 'installation', 'reconnection_relocation']) add('ticket', { category });
      add('routine', { points: 3 }); add('installation', { points: 10 });
      const { after } = compare();
      assert.equal(after[0].averias_count, 4);
      assert.equal(after[0].reconexiones_count, 1);
      assert.equal(after[0].rutinas_count, 1);
      assert.equal(after[0].installations_count, 1);
      assert.equal(after[0].total_points, 27);
    });

    await t.test('Rutinas y averias sin confirmar o pendientes no cuentan', () => {
      reset();
      add('routine'); add('routine', { confirm: false }); add('routine', { status: 'pending', confirm: false });
      add('ticket', { confirm: false }); add('ticket', { status: 'open', confirm: false });
      const { before, after } = compare();
      assert.deepEqual(after, before);
      assert.equal(after[0].rutinas_count, 1);
      assert.equal(after[0].averias_count, 0);
    });

    await t.test('Cada integrante recibe un trabajo; el reparto de puntos permanece igual', () => {
      reset(); add('ticket', { crew: true }); add('routine', { crew: true }); add('installation', { crew: true, points: 10 });
      const { after } = compare();
      assert.equal(after.length, 2);
      for (const row of after) {
        assert.equal(row.averias_count, 1); assert.equal(row.rutinas_count, 1);
        assert.equal(row.installations_count, 1); assert.equal(row.total_points, 7);
      }
    });

    await t.test('Fecha de confirmacion, limites Lima [inicio,fin), creacion antes del corte', () => {
      reset();
      add('ticket', { createdAt: '2026-10-31 23:00Z', done: '2026-11-06 04:59Z', confirmedAt: '2026-11-06 05:00Z' });
      add('routine', { done: '2026-11-06 04:59Z', confirmedAt: '2026-11-07 05:00Z' });
      assert.deepEqual(compare('2026-11-05 05:00Z', '2026-11-06 05:00Z').after, []);
      const { after } = compare('2026-11-06 05:00Z', '2026-11-07 05:00Z');
      assert.equal(after[0].averias_count, 1); assert.equal(after[0].rutinas_count, 0);
      assert.equal(compare('2026-11-07 05:00Z', '2026-11-08 05:00Z').after[0].rutinas_count, 1);
    });

    await t.test('Historico de octubre intacto y semana que cruza el corte sin duplicar', () => {
      reset();
      for (const category of ['other', 'no_service', 'reconnection_relocation']) add('ticket', {
        category, confirm: false, createdAt: '2026-10-25 06:00Z', done: '2026-10-30 15:00Z',
      });
      add('routine', { confirm: false, createdAt: '2026-10-25 06:00Z', done: '2026-10-30 15:00Z' });
      add('installation', { confirm: false, createdAt: '2026-10-25 06:00Z', done: '2026-10-30 15:00Z' });
      const october = compare('2026-10-01 05:00Z', '2026-11-01 05:00Z');
      assert.deepEqual(october.after, october.before);
      add('ticket', { done: '2026-11-01 06:00Z', confirmedAt: '2026-11-01 07:00Z' });
      const { after } = compare('2026-10-26 05:00Z', '2026-11-02 05:00Z');
      assert.equal(after[0].averias_count, 2); assert.equal(after[0].rutinas_count, 1);
    });

    await t.test('Defensa ante varios aportes de una orden: un contador, sumas y penalizaciones intactas', () => {
      reset(); add('ticket', { crew: true }); add('routine', { crew: true });
      // Simula registros relacionados duplicados sin alterar el origen real del puntaje.
      sql(sourceDefinition.replace('public.technician_point_contributions(', 'public.ranking_test_original_contributions('));
      sql(`create or replace function technician_point_contributions(p_start timestamptz,p_end timestamptz)
        returns table(technician_id uuid,job_type text,job_id uuid,occurred_at timestamptz,kind text,category text,crew_size bigint,points numeric)
        language sql stable as $$
          select * from ranking_test_original_contributions(p_start,p_end)
          union all select * from ranking_test_original_contributions(p_start,p_end)
          union all select technician_id,job_type,job_id,occurred_at,'recurrence',category,crew_size,0.5
            from ranking_test_original_contributions(p_start,p_end) where job_type='ticket' and kind='work'
        $$;`);
      const { before, after } = compare();
      for (const row of before) { assert.equal(row.rutinas_count, 2); assert.equal(row.reincidencias_count, 1); }
      for (const row of after) {
        assert.equal(row.averias_count, 1); assert.equal(row.rutinas_count, 1);
        assert.equal(row.reincidencias_count, 1); assert.equal(row.total_points, 3.5);
      }
      sql(sourceDefinition);
    });

    assert.equal(sql("select pg_get_functiondef('technician_point_contributions(timestamptz,timestamptz)'::regprocedure);"), sourceDefinition);
  } finally {
    docker(['rm', '-f', container]);
  }
});
