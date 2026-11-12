// Ensayo LOCAL de los archivos de aplicacion/rollback. Docker --network none.
// Del informe privado solo se cargan definiciones de funciones, nunca registros.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const file = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const report = JSON.parse(file('scripts/inventory-auth-lab/runtime/ranking-counters-activation-private.json'))[0];
const manifest = JSON.parse(file('deploy/ranking-counters-20261112/manifest.json'));
const apply = file('deploy/ranking-counters-20261112/apply.sql');
const rollback = file('deploy/ranking-counters-20261112/rollback.sql');
const backup = file('deploy/ranking-counters-20261112/backup.sql');
const container = `rayco-ranking-activation-${process.pid}-${Date.now()}`;
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] });
const sql = text => docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'], text).trim();
const signature = "'public.technician_ranking_between(timestamptz,timestamptz)'::regprocedure";
const definitionMd5 = () => sql(`select md5(pg_get_functiondef(${signature}));`);
const catalog = () => sql(`select to_jsonb(p)-'prosrc' from pg_proc p where oid=${signature};`);
const count = () => JSON.parse(sql("select jsonb_agg(r order by technician_id) from technician_ranking_between('2026-11-01 05:00Z','2026-12-01 05:00Z') r;"));
const stable = data => data.map(({averias_count,rutinas_count,...rest}) => rest);
let passed = 0;
const pass = message => { passed++; console.log(`PASS: ${message}`); };
try {
  docker(['run','--rm','-d','--pull=never','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready = false;
  for (let i=0;i<100;i++) {
    try { docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']); ready=true; break; }
    catch { await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  assert.ok(ready);
  sql(file('server/tests/jobWorkSessionsSchema.sql'));
  sql(`alter table profiles add column full_name text,add column email text;
    update profiles set full_name='Persona sintetica';
    alter table tickets add column points integer,add column category text default 'other',add column client_id uuid,
      add column created_at timestamptz default '2026-11-02 06:00Z',add column resolved_at timestamptz,add column closed_at timestamptz,add column imputable_a_tecnico boolean default false;
    alter table installations add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 06:00Z';
    alter table routines add column points numeric,add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 06:00Z';
    grant usage on schema auth to authenticated;`);
  sql(file('supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)[0]);
  sql(file('server/tests/workOrderPointsContributionBaseline.sql'));
  sql(file('server/tests/pointConfirmationRankingBaseline.sql'));
  sql(file('server/tests/workOrderPointsDefaultPrivileges.sql'));
  for (const migration of ['20261024180000_work_order_points','20261024190000_field_order_points_readonly','20261024200000_work_order_point_confirmations','20261102220000_technician_points_october_november_boundary']) {
    sql(file(`supabase/migrations/${migration}.sql`)); // Esquema sintetico local, sin red.
  }
  for (const fn of report.functions) sql(fn.definition+';');
  const tech='00000000-0000-0000-0000-000000000003';
  const admin='00000000-0000-0000-0000-000000000002';
  const id='10000000-0000-0000-0000-000000000001';
  // Filas inventadas; fechas de prueba para comparar noviembre y el caso diario.
  sql(`insert into tickets(id,points,status,assigned_to,resolved_at,ticket_number) values('${id}',2,'resolved','${tech}','2026-11-06 14:32Z','SYNTHETIC-RANKING');
    insert into work_order_point_confirmations(job_type,job_id,points,crew,technical_completed_at,order_created_at,category,confirmed_by,confirmed_at,review_token)
    values('ticket','${id}',2,'[{"technicianId":"${tech}","points":2,"recurrencePenalty":0}]','2026-11-06 14:32Z','2026-11-02 06:00Z','other','${admin}','2026-11-06 15:18Z','synthetic');`);
  assert.equal(definitionMd5(),manifest.definitionMd5Before);
  const beforeCatalog=catalog(), before=count();
  sql(apply);
  assert.equal(definitionMd5(),manifest.definitionMd5Candidate);
  assert.equal(catalog(),beforeCatalog);
  const after=count();
  assert.equal(before[0].averias_count,0);assert.equal(after[0].averias_count,1);
  assert.equal(after[0].total_points,2);assert.deepEqual(stable(after),stable(before));
  pass('CREATE OR REPLACE exacto; OID, firma, owner, ACL, atributos, dependencias, otras funciones y puntos conservados');
  sql(rollback);
  assert.equal(definitionMd5(),manifest.definitionMd5Before);
  assert.equal(catalog(),beforeCatalog);assert.deepEqual(count(),before);
  pass('rollback exacto restaura definicion, metadatos y ranking original');
  sql(rollback);assert.equal(definitionMd5(),manifest.definitionMd5Before);
  pass('rollback repetido es seguro si la funcion ya coincide con el respaldo');
  const drift=backup.replace('AS $function$','AS $function$\n-- deriva sintetica');
  sql(drift);
  assert.throws(()=>sql(apply),/Deriva en funcion de produccion/);
  assert.throws(()=>sql(rollback),/Deriva posterior/);
  assert.notEqual(definitionMd5(),manifest.definitionMd5Before);
  sql(backup);
  pass('aplicacion y rollback rechazan deriva y no pisan una definicion ajena');
  sql('grant execute on function technician_ranking_between(timestamptz,timestamptz) to authenticated;');
  assert.throws(()=>sql(apply),/Deriva en owner\/permisos/);
  sql('revoke execute on function technician_ranking_between(timestamptz,timestamptz) from authenticated;');
  assert.equal(catalog(),beforeCatalog);
  pass('se rechaza deriva de permisos sin cambiar la funcion');
  const faulty=apply.replace("raise notice 'PASS: contadores esperados; puntos/Altas/posiciones/permisos/dependencias conservados'", "raise exception 'fallo sintetico antes de commit'");
  assert.notEqual(faulty,apply);
  assert.throws(()=>sql(faulty),/fallo sintetico antes de commit/);
  assert.equal(definitionMd5(),manifest.definitionMd5Before);assert.equal(catalog(),beforeCatalog);
  pass('un fallo posterior al reemplazo revierte automaticamente el DDL antes del COMMIT');
  console.log(JSON.stringify({checks:passed,failed:0,network:'none',synthetic:true,remoteChangesExecuted:false}));
} finally { docker(['rm','-f',container]); }
