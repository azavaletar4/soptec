import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tech = '00000000-0000-0000-0000-000000000003';
const other = '00000000-0000-0000-0000-000000000005';
const admin = '00000000-0000-0000-0000-000000000002';
const support = '00000000-0000-0000-0000-000000000006';
const clientRole = '00000000-0000-0000-0000-000000000007';

test('Mi Avance: SQL compartido, calendario Perú, aislamiento y rollback', { timeout: 180000 }, async t => {
  const container = `smartrayco-progress-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const sql = (s: string) => docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'], s).trim();
  const as = (s: string, uid = tech, zone = 'UTC') => sql(`set timezone='${zone}'; set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
  const json = (s: string, uid = tech) => JSON.parse(as(s,uid) || 'null');
  const old = file('../../supabase/migrations/20261007010000_fase130_rutinas_puntaje_ranking.sql');
  try {
    docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    let ready = false;
    for(let n=0;n<60;n++) { try { docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']); ready=true; break; } catch { await new Promise(r=>setTimeout(r,100)); } }
    assert.ok(ready);
    sql(file('./closedOrdersSchema.sql'));
    sql(`alter table profiles add column full_name text, add column email text;
      alter table installations add column completed_at timestamptz;
      alter table tickets add column category text, add column points integer, add column client_id uuid,
        add column resolved_at timestamptz, add column closed_at timestamptz,
        add column created_at timestamptz, add column imputable_a_tecnico boolean default false;
      alter table routines add column completed_at timestamptz;
      insert into profiles(id,role) values ('${other}','TECNICO_RED'),('${support}','SOPORTE'),('${clientRole}','CLIENTE') on conflict do nothing;
      grant usage on schema auth to authenticated;
      grant select on profiles to authenticated;`);
    sql("update profiles set full_name='Técnico de prueba',email='private@example.invalid';");
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    // Exact public-schema defaults observed in the read-only cloud preflight.
    sql('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
    sql(old);
    const originalMD5 = sql("select md5(prosrc) from pg_proc where oid='get_technician_ranking(int,int)'::regprocedure;");
    sql(old.slice(old.indexOf('create function'),old.indexOf('revoke all')).replace('get_technician_ranking','original_ranking'));
    // Diverse deterministic fixtures: zero/null/manual points, ignored categories,
    // canceled/open jobs, inactive technicians, uneven crews and month edges.
    sql(`insert into installations(id,status,assigned_to,completed_at)
      select md5('i'||n)::uuid, case when n%7=0 then 'cancelled'::installation_status else 'completed'::installation_status end,
        '${tech}', '2026-01-01 04:59:59+00'::timestamptz + n*interval '17 hours' from generate_series(1,520)n;
      insert into routines(id,status,assigned_to,completed_at,points)
      select md5('r'||n)::uuid,case when n%7=0 then 'cancelled'::routine_status else 'completed'::routine_status end,
        '${tech}', '2026-01-01 05:00+00'::timestamptz+n*interval '19 hours', case when n%3=0 then null else n%13 end from generate_series(1,420)n;
      insert into tickets(id,status,assigned_to,client_id,category,points,resolved_at,closed_at,created_at,imputable_a_tecnico)
      select md5('t'||n)::uuid,case when n%9=0 then 'open'::ticket_status when n%2=0 then 'closed'::ticket_status else 'resolved'::ticket_status end,
        '${tech}',md5('client'||(n/3))::uuid,
        (array['no_service','slow_speed','equipment','reconnection_relocation','installation'])[n%5+1],
        case when n%3=0 then null else n%11 end,
        case when n%4=0 then null else '2026-01-01 05:00+00'::timestamptz+n*interval '14 hours' end,
        '2026-01-01 05:00+00'::timestamptz+n*interval '15 hours',
        '2026-01-01 05:00+00'::timestamptz+n*interval '13 hours',n%2=0 from generate_series(1,650)n;
      insert into job_assignees(job_type,job_id,technician_id,role)
      select 'installation',id,'${tech}','leader' from installations where substring(id::text,1,1) in ('a','b','c');
      insert into job_assignees(job_type,job_id,technician_id,role)
      select job_type,job_id,'${other}','support' from job_assignees;
      insert into job_assignees(job_type,job_id,technician_id,role)
      select 'ticket',id,'${other}','support' from tickets where substring(id::text,1,1) in ('a','b');
      insert into job_assignees(job_type,job_id,technician_id,role)
      select 'routine',id,'${other}','support' from routines where substring(id::text,1,1) in ('a','b');`);
    sql(file('../../docs/sql/mi-avance-candidate.sql'));

    await t.test('ranking idéntico a Fase 130: todas las columnas, 12 meses y tres zonas', () => {
      for (const zone of ['UTC','America/Lima','Asia/Tokyo']) {
        assert.equal(as(`select count(*) from generate_series(1,12)m where
          (select jsonb_agg(to_jsonb(r)) from get_technician_ranking(m,2026)r)
          is distinct from (select jsonb_agg(to_jsonb(r)) from original_ranking(m,2026)r);`,admin,zone),'0');
      }
    });
    await t.test('técnicos, administración y soporte consultan ranking; cliente/anon denegados', () => {
      assert.ok(Number(as('select count(*) from get_technician_ranking(1,2026);',admin))>0);
      assert.ok(Number(as('select count(*) from get_technician_ranking(1,2026);',support))>0);
      assert.ok(Number(sql('set role service_role; select count(*) from get_technician_ranking(1,2026);'))>0);
      assert.ok(Number(as('select count(*) from get_technician_ranking(1,2026);','00000000-0000-0000-0000-000000000001'))>0);
      for(const uid of [tech,other]) assert.ok(Number(as('select count(*) from get_technician_ranking(1,2026);',uid))>0);
      assert.equal(as('select count(*) from get_technician_ranking(1,2026);',clientRole),'0');
      assert.throws(()=>sql('set role anon; select * from get_technician_ranking(1,2026);'),/permission denied/);
    });
    await t.test('función interna no es invocable por authenticated/anon/service_role', () => {
      for(const role of ['authenticated','anon','service_role']) {
        assert.throws(()=>sql(`set role ${role}; select * from technician_point_contributions(now(),now());`),/permission denied/);
        assert.throws(()=>sql(`set role ${role}; select * from technician_ranking_between(now(),now());`),/permission denied/);
      }
    });
    await t.test('consulta personal exige técnico activo y no admite parámetro de identidad', () => {
      for(const uid of [admin,support,clientRole,'']) assert.throws(()=>as('select my_field_progress();',uid),/Exclusivo/);
      assert.throws(()=>as(`select my_field_progress('${other}'::uuid);`),/does not exist/);
      sql(`update profiles set active=false where id='${other}';`);
      assert.throws(()=>as('select my_field_progress();',other),/Exclusivo/);
      sql(`update profiles set active=true where id='${other}';`);
      assert.throws(()=>sql('set role anon; select my_field_progress();'),/permission denied/);
    });
    await t.test('aislamiento de respuestas y límites personales independientes de zona de sesión', () => {
      sql(`insert into installations(id,status,assigned_to,completed_at) values
        (md5('only-tech')::uuid,'completed','${tech}',now()),
        (md5('only-other')::uuid,'completed','${other}',now());`);
      const a=json('select my_field_progress();'); const b=json('select my_field_progress();',other);
      const techId=sql("select md5('only-tech')::uuid;"); const otherId=sql("select md5('only-other')::uuid;");
      assert.ok(a.contributions.some((e:any)=>e.jobId===techId));
      assert.ok(!a.contributions.some((e:any)=>e.jobId===otherId));
      assert.ok(b.contributions.some((e:any)=>e.jobId===otherId));
      assert.ok(!b.contributions.some((e:any)=>e.jobId===techId));
      const periods = JSON.parse(as("select my_field_progress()->'periods';",tech,'Asia/Tokyo'));
      for(const key of ['today','week','month']) {
        assert.equal(Date.parse(a.periods[key].start),Date.parse(periods[key].start));
        assert.equal(Date.parse(a.periods[key].end),Date.parse(periods[key].end));
        assert.equal(new Date(a.periods[key].start).getUTCHours(),5);
      }
      assert.equal(new Date(a.periods.week.start).getUTCDay(),1);
      assert.equal(new Date(a.periods.month.start).getUTCDate(),1);
      assert.equal(Date.parse(a.periods.today.end)-Date.parse(a.periods.today.start),86400000);
    });
    await t.test('total mensual personal coincide con ranking original en Perú, incluidos descuentos', () => {
      const personal=json('select my_field_progress();');
      const expected=as(`select coalesce((select total_points from original_ranking(
        extract(month from now() at time zone 'America/Lima')::int,
        extract(year from now() at time zone 'America/Lima')::int) where technician_id='${tech}'),0);`,admin,'America/Lima');
      assert.equal(personal.periods.month.points,Number(expected));
    });
    await t.test('medianoche Perú inclusiva al inicio y exclusiva al final; semana cruza año', () => {
      sql(`insert into installations(id,status,assigned_to,completed_at) values
        (md5('before')::uuid,'completed','${tech}','2025-12-29 04:59:59+00'),
        (md5('start')::uuid,'completed','${tech}','2025-12-29 05:00+00'),
        (md5('last')::uuid,'completed','${tech}','2026-01-05 04:59:59+00'),
        (md5('end')::uuid,'completed','${tech}','2026-01-05 05:00+00');`);
      assert.equal(sql(`select count(*) from technician_point_contributions('2025-12-29 05:00+00','2026-01-05 05:00+00') where job_id in (md5('before')::uuid,md5('start')::uuid,md5('last')::uuid,md5('end')::uuid);`),'2');
    });
    await t.test('detalle histórico usa la misma fuente y nunca revela el aporte de otro técnico', () => {
      const job=sql("select md5('before')::uuid;");
      assert.equal(json(`select my_field_job_points('installation','${job}');`)[0].points,10);
      assert.equal(json(`select my_field_job_points('installation','${job}');`,other),null);
      assert.throws(()=>as(`select my_field_job_points('installation','${job}');`,admin),/Exclusivo/);
      assert.equal(json(`select my_field_job_points('invalid','${job}');`),null);
    });
    await t.test('cero manual, rutina NULL y tres integrantes conservan atribución exacta', () => {
      sql(`insert into tickets(id,status,assigned_to,category,points,resolved_at) values
        (md5('zero')::uuid,'resolved','${tech}','equipment',0,now()),
        (md5('default')::uuid,'closed','${tech}','reconnection_relocation',null,null);
        update tickets set closed_at=now() where id=md5('default')::uuid;
        insert into routines(id,status,assigned_to,points,completed_at) values(md5('null-routine')::uuid,'completed','${tech}',null,now());
        insert into installations(id,status,assigned_to,completed_at) values(md5('three')::uuid,'completed','${admin}',now());
        insert into job_assignees values ('installation',md5('three')::uuid,'${tech}','leader'),
          ('installation',md5('three')::uuid,'${other}','support'),('installation',md5('three')::uuid,'${support}','support');`);
      assert.equal(json("select my_field_job_points('ticket',md5('zero')::uuid);")[0].points,0);
      assert.equal(json("select my_field_job_points('ticket',md5('default')::uuid);")[0].points,3);
      assert.equal(json("select my_field_job_points('routine',md5('null-routine')::uuid);")[0].points,0);
      const three=json("select my_field_job_points('installation',md5('three')::uuid);");
      assert.equal(three[0].crewSize,3);
      assert.ok(Math.abs(three[0].points-10/3)<1e-12);
      assert.equal(sql(`select count(*) from technician_point_contributions(now()-interval '1 minute',now()+interval '1 minute') where job_id=md5('three')::uuid and technician_id='${admin}';`),'0');
    });
    await t.test('tipo real tickets.points integer: conserva truncamiento existente del reparto', () => {
      sql(`insert into tickets(id,status,assigned_to,category,points,resolved_at) values
        (md5('integer-share')::uuid,'resolved','${tech}','equipment',5,now());
        insert into job_assignees values ('ticket',md5('integer-share')::uuid,'${tech}','leader'),
          ('ticket',md5('integer-share')::uuid,'${other}','support');`);
      assert.equal(json("select my_field_job_points('ticket',md5('integer-share')::uuid);")[0].points,2);
    });
    await t.test('reincidencia al día siete, imputable, una sola penalización y reparto', () => {
      sql(`insert into tickets(id,status,assigned_to,client_id,category,resolved_at,created_at,imputable_a_tecnico) values
        (md5('first')::uuid,'resolved','${tech}',md5('repeat-client')::uuid,'equipment','2026-10-01 05:00+00','2026-09-30+00',false),
        (md5('repeat')::uuid,'open','${other}',md5('repeat-client')::uuid,'equipment',null,'2026-10-08 05:00+00',true),
        (md5('repeat2')::uuid,'open','${other}',md5('repeat-client')::uuid,'equipment',null,'2026-10-02 05:00+00',true);
        insert into job_assignees values ('ticket',md5('first')::uuid,'${tech}','leader'),('ticket',md5('first')::uuid,'${other}','support');`);
      assert.equal(sql("select sum(points)||'|'||count(*) from technician_point_contributions('2026-10-01 05:00+00','2026-10-02 05:00+00') where kind='recurrence' and job_id=md5('first')::uuid;"),'5.0000000000000000|2');
      sql("update tickets set imputable_a_tecnico=false where id=md5('repeat2')::uuid; update tickets set created_at='2026-10-08 05:00:00.001+00' where id=md5('repeat')::uuid;");
      assert.equal(sql("select count(*) from technician_point_contributions('2026-10-01 05:00+00','2026-10-02 05:00+00') where kind='recurrence' and job_id=md5('first')::uuid;"),'0');
    });
    await t.test('ranking diario/semanal/mensual compartido entre técnicos, ADMIN y SUPERADMIN', () => {
      for(const period of ['day','week','month']) {
        const baseline=json(`select get_technician_period_ranking('${period}','2026-01-15');`);
        assert.ok(baseline.ranking.length>0);
        assert.equal(baseline.timezone,'America/Lima');
        assert.equal(new Date(baseline.start).getUTCHours(),5);
        for(const uid of [other,admin,'00000000-0000-0000-0000-000000000001']) {
          const result=json(`select get_technician_period_ranking('${period}','2026-01-15');`,uid);
          assert.deepEqual(result.ranking,baseline.ranking);
        }
      }
      assert.throws(()=>as("select get_technician_period_ranking('month','2026-01-15');",clientRole),/exclusivo/);
      assert.throws(()=>as("select get_technician_period_ranking('month','2026-01-15');",''),/exclusivo/);
      assert.throws(()=>sql("set role anon; select get_technician_period_ranking('month','2026-01-15');"),/permission denied/);
      sql(`update profiles set active=false where id='${other}';`);
      assert.throws(()=>as("select get_technician_period_ranking('month','2026-01-15');",other),/exclusivo/);
      sql(`update profiles set active=true where id='${other}';`);
    });
    await t.test('ranking comparte solo agregados, sin emails ni detalle ajeno', () => {
      sql(`update profiles set full_name=null,email='SENSITIVE-EMAIL@example.invalid' where id='${other}';`);
      const payload=json("select get_technician_period_ranking('month','2026-01-15');");
      const keys=['technician_id','technician_name','installations_count','averias_count','reconexiones_count','rutinas_count','reincidencias_count','total_points','ranking'].sort();
      for(const row of payload.ranking) assert.deepEqual(Object.keys(row).sort(),keys);
      assert.doesNotMatch(JSON.stringify(payload),/SENSITIVE|@|client|contract|salary|jobId|ticket_number/);
      assert.doesNotMatch(as('select row_to_json(r) from get_technician_ranking(1,2026)r;'),/SENSITIVE|@/);
      sql(`update profiles set full_name='Técnico de prueba' where id='${other}';`);
    });
    await t.test('períodos del ranking coinciden con Mi Avance y validan fechas', () => {
      const date=sql("select (now() at time zone 'America/Lima')::date;");
      const own=json('select my_field_progress();');
      for(const [period,key] of [['day','today'],['week','week'],['month','month']]) {
        const result=json(`select get_technician_period_ranking('${period}','${date}');`);
        assert.equal(result.ranking.find((r:any)=>r.technician_id===tech)?.total_points??0,own.periods[key!].points);
        assert.equal(Date.parse(result.start),Date.parse(own.periods[key!].start));
        assert.equal(Date.parse(result.end),Date.parse(own.periods[key!].end));
      }
      const week=json("select get_technician_period_ranking('week','2026-01-01');");
      assert.equal(Date.parse(week.start),Date.parse('2025-12-29T05:00:00Z'));
      assert.equal(Date.parse(week.end),Date.parse('2026-01-05T05:00:00Z'));
      assert.throws(()=>as("select get_technician_period_ranking('invalid','2026-01-01');"),/Periodo invalido/);
      assert.throws(()=>as("select get_technician_period_ranking('day','1999-01-01');"),/rango/);
    });
    await t.test('guard de drift impide reaplicar; rollback restaura cálculo y mantiene anon bloqueado', () => {
      assert.throws(()=>sql(file('../../docs/sql/mi-avance-candidate.sql')),/Ranking definition drift/);
      sql(file('../../docs/sql/mi-avance-rollback.sql'));
      assert.notEqual(sql("select md5(prosrc) from pg_proc where oid='get_technician_ranking(int,int)'::regprocedure;"),originalMD5);
      assert.equal(sql("select to_regprocedure('my_field_progress()') is null;"),'t');
      assert.equal(sql("select has_function_privilege('anon','get_technician_ranking(int,int)','EXECUTE');"),'f');
    });
    await t.test('rollback recomendado conserva ranking compartido y deniega anon', () => {
      // Restore the original source only inside this disposable fixture so the
      // candidate's original-source guard can be exercised a second time.
      sql(old.slice(old.indexOf('create function'),old.indexOf('revoke all')).replace('create function','create or replace function'));
      sql(file('../../docs/sql/mi-avance-candidate.sql'));
      sql(file('../../docs/sql/mi-avance-rollback-private.sql'));
      assert.equal(as(`select count(*) from generate_series(1,12)m where
        (select jsonb_agg(to_jsonb(r)) from get_technician_ranking(m,2026)r)
        is distinct from (select jsonb_agg(to_jsonb(r)) from original_ranking(m,2026)r);`,admin),'0');
      assert.ok(Number(as('select count(*) from get_technician_ranking(10,2026);'))>0);
      assert.throws(()=>sql('set role anon; select * from get_technician_ranking(10,2026);'),/permission denied/);
      assert.equal(sql("select to_regprocedure('my_field_progress()') is null and to_regprocedure('technician_point_contributions(timestamptz,timestamptz)') is null;"),'t');
    });
  } finally { try { docker(['rm','-f',container]); } catch {} }
});
