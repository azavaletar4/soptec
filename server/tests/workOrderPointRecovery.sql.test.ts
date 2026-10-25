import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const admin='00000000-0000-0000-0000-000000000002';
const tech='00000000-0000-0000-0000-000000000003';
const helper='00000000-0000-0000-0000-000000000004';
const job='10000000-0000-0000-0000-000000000001';

test('Puntos: fallo transaccional y recuperación PostgreSQL sin red',{timeout:120000},async t=>{
  const container=`rayco-points-recovery-${process.pid}-${Date.now()}`;
  const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  const sql=(s:string,db='postgres')=>docker(['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'],s).trim();
  const as=(s:string,db='postgres')=>sql(`set role authenticated;set request.jwt.claim.sub='${admin}';${s}`,db);
  const catalog=(db='postgres')=>sql(`select jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proacl) order by p.proname,p.oid::regprocedure::text) from pg_proc p where p.pronamespace in ('public'::regnamespace,'auth'::regnamespace)),
    'tables',(select jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relacl) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),
    'columns',(select jsonb_agg(jsonb_build_array(table_name,column_name,data_type,is_nullable,column_default) order by table_name,ordinal_position) from information_schema.columns where table_schema='public'),
    'constraints',(select jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname) from pg_constraint where connamespace='public'::regnamespace),
    'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
    'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal));`,db);
  const dump=(name:string)=>docker(['exec',container,'pg_dump','-h','127.0.0.1','-U','postgres','-d','postgres','-Fc','-f',`/tmp/${name}.dump`]);
  const recover=(name:string,db:string)=>{
    docker(['exec',container,'createdb','-h','127.0.0.1','-U','postgres','-T','template0',db]);
    docker(['exec',container,'pg_restore','-h','127.0.0.1','-U','postgres','-d',db,'--clean','--if-exists','--exit-on-error',`/tmp/${name}.dump`]);
  };
  try {
    docker(['run','--rm','-d','--pull=never','--network','none','--name',container,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    let ready=false;for(let n=0;n<60;n++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
    sql(file('./jobWorkSessionsSchema.sql'));
    sql(`alter table profiles add column full_name text,add column email text;
      update profiles set role='TECNICO_RED' where id='${helper}';
      alter table tickets add column points integer,add column category text default 'no_service',add column client_id uuid,
        add column created_at timestamptz default '2026-11-02 06:00Z',add column resolved_at timestamptz,add column closed_at timestamptz,add column imputable_a_tecnico boolean default false;
      alter table installations add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 06:00Z';
      alter table routines add column points numeric,add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 06:00Z';
      grant usage on schema auth to authenticated;
      insert into tickets(id,status,points,assigned_to,resolved_at) values('${job}','resolved',8,'${tech}','2026-11-03 15:00Z');
      insert into job_assignees values('ticket','${job}','${tech}','leader'),('ticket','${job}','${helper}','support');`);
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    sql(file('./workOrderPointsContributionBaseline.sql'));sql(file('./pointConfirmationRankingBaseline.sql'));sql(file('./workOrderPointsDefaultPrivileges.sql'));
    const before=catalog();dump('before');
    const source=sql("select pg_get_functiondef('technician_point_contributions(timestamptz,timestamptz)'::regprocedure);");
    sql(file('../../supabase/migrations/20261024180000_work_order_points.sql'));
    sql(file('../../supabase/migrations/20261024190000_field_order_points_readonly.sql'));
    await t.test('deriva aborta 200000; conserva 180000/190000, sin objetos parciales',()=>{
      sql(source.replace('AS $function$','AS $function$\n-- synthetic source drift\n'));
      assert.throws(()=>sql(file('../../supabase/migrations/20261024200000_work_order_point_confirmations.sql')),/Deriva en fuente compartida/);
      assert.equal(sql("select to_regclass('work_order_point_confirmations') is null;"),'t');
      assert.equal(sql("select to_regprocedure('confirm_work_order_points(text,uuid,numeric,text,text,boolean)') is null;"),'t');
      assert.equal(sql("select to_regclass('work_order_point_changes') is not null and to_regprocedure('my_field_order_points(text,uuid)') is not null;"),'t');
      sql(source);
    });
    sql(file('../../supabase/migrations/20261024200000_work_order_point_confirmations.sql'));
    await t.test('las tres instaladas: restauración previa recupera definiciones/ACL/RLS y datos sin uso',()=>{
      assert.equal(sql('select count(*) from work_order_point_confirmations;'),'0');
      recover('before','points_before');
      assert.equal(catalog('points_before'),before);
      assert.equal(sql('select points from tickets;', 'points_before'),'8');
      assert.equal(sql("select to_regclass('work_order_point_confirmations') is null;",'points_before'),'t');
    });
    const review=JSON.parse(as(`select work_order_point_review('ticket','${job}');`));
    const call=`select confirm_work_order_points('ticket','${job}',12,'${review.token}','Ajuste sintético',true);`;
    const confirmed=JSON.parse(as(call));
    await t.test('una confirmación tras ajustar se conserva ante reintento',()=>{
      assert.equal(JSON.parse(as(call)).id,confirmed.id);
      assert.equal(sql('select count(*) from work_order_point_changes;'),'1');
      assert.equal(sql('select count(*) from work_order_point_confirmations;'),'1');
    });
    const after=catalog();
    const ledger=(db='postgres')=>sql('select jsonb_build_object(\'confirmations\',(select jsonb_agg(to_jsonb(c) order by id) from work_order_point_confirmations c),\'audit\',(select jsonb_agg(to_jsonb(a) order by id) from work_order_point_changes a));',db);
    const data=ledger();dump('after');
    await t.test('recuperación posterior preserva instantáneas/auditoría y guardas definitivas',()=>{
      recover('after','points_after');assert.equal(catalog('points_after'),after);assert.equal(ledger('points_after'),data);
      assert.equal(JSON.parse(as(call,'points_after')).id,confirmed.id);
      assert.throws(()=>as("update tickets set status='open';",'points_after'),/Cierre administrativo definitivo/);
      assert.equal(sql('select count(*) from work_order_point_confirmations;','points_after'),'1');
    });
  } finally {docker(['rm','-f',container]);}
});
