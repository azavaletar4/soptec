import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Git on Windows may check SQL out as CRLF; the production prosrc snapshot is LF.
const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const admin='00000000-0000-0000-0000-000000000002';
const root='00000000-0000-0000-0000-000000000001';
const tech='00000000-0000-0000-0000-000000000003';
const helper='00000000-0000-0000-0000-000000000004';
const id='10000000-0000-0000-0000-000000000001';
test('Noviembre: calendario y coherencia de puntos con datos ficticios',{timeout:300000},async t=>{
  const container=`rayco-confirm-${process.pid}-${Date.now()}`;
  const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  const args=['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
  const sql=(s:string)=>docker(args,s).trim();
  const as=(s:string,actor=admin)=>sql(`set role authenticated;set request.jwt.claim.sub='${actor}';${s}`);
  const json=(s:string,actor=admin)=>JSON.parse(as(s,actor)||'null');
  const review=(kind:string)=>json(`select work_order_point_review('${kind}','${id}');`);
  const call=(kind:string,token:string,points=12,confirmed='true',reason="'Verificación administrativa'")=>
    `select confirm_work_order_points('${kind}','${id}',${points},'${token}',${reason},${confirmed});`;
  const totals=(from='2026-11-01 05:00Z',to='2026-12-01 05:00Z')=>sql(`select count(*)||'|'||coalesce(sum(case when kind='recurrence' then -points else points end),0) from technician_point_contributions('${from}','${to}');`).split('|').map(Number);
  const reset=(table:string,kind:string,finished=true,october=false)=>{
    sql('truncate work_order_point_confirmations,work_order_point_changes,tickets,installations,routines,job_assignees;');
    const status=finished?(kind==='ticket'?'resolved':'completed'):(kind==='ticket'?'open':'pending');
    const time=october?'2026-10-12 15:00Z':'2026-11-12 15:00Z';
    sql(`insert into ${table}(id,points,status,assigned_to,${kind==='ticket'?'resolved_at':'completed_at'}) values('${id}',12,'${status}','${tech}',${finished?`'${time}'`:'null'});
      insert into job_assignees values('${kind}','${id}','${tech}','leader'),('${kind}','${id}','${helper}','support');`);
  };
  const officialDate=()=>sql("update work_order_point_confirmations set confirmed_at='2026-11-13 15:00Z';"); // test-only clock fixture, never remote
  try {
    docker(['run','--rm','-d','--pull=never','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    let ready=false;for(let n=0;n<60;n++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
    sql(file('./jobWorkSessionsSchema.sql'));
    sql(`alter table profiles add column full_name text,add column email text;
      update profiles set full_name='Persona de prueba',email='synthetic@example.invalid';update profiles set role='TECNICO_RED' where id='${helper}';
      alter table tickets add column points integer,add column category text default 'no_service',add column client_id uuid,
        add column created_at timestamptz default '2026-11-01 06:00Z',add column resolved_at timestamptz,add column closed_at timestamptz,add column imputable_a_tecnico boolean default false;
      alter table installations add column completed_at timestamptz,add column created_at timestamptz default '2026-11-01 06:00Z';
      alter table routines add column points numeric,add column completed_at timestamptz,add column created_at timestamptz default '2026-11-01 06:00Z';
      grant usage on schema auth to authenticated;`);
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    sql(file('./workOrderPointsContributionBaseline.sql'));
    sql(file('./pointConfirmationRankingBaseline.sql'));
    sql(file('./workOrderPointsDefaultPrivileges.sql'));
    sql(file('../../supabase/migrations/20261024180000_work_order_points.sql'));
    sql(file('../../supabase/migrations/20261024190000_field_order_points_readonly.sql'));
    sql(file('../../supabase/migrations/20261024200000_work_order_point_confirmations.sql'));

    const definitions=file('../../supabase/migrations/20261020170000_mi_avance_personal_ranking_compartido.sql');
    const functionSQL=(name:string)=>{const start=definitions.indexOf('create function public.'+name+'(');assert.ok(start>=0);return definitions.slice(start,definitions.indexOf('end '+String.fromCharCode(36,36)+';',start)+8);};
    const clock=(instant:string)=>sql(functionSQL('my_field_progress').replace('create function','create or replace function').replace('now()',"timestamptz '"+instant+"'"));
    sql(functionSQL('get_technician_period_ranking'));
    clock('2026-11-15 12:00Z');
    const progress=(actor=tech)=>json('select my_field_progress();',actor);
    const detail=(actor=tech)=>json(`select my_field_order_points('ticket','${id}');`,actor);
    const ranking=(actor=tech,date='2026-11-15')=>json(`select get_technician_period_ranking('month','${date}');`,admin).ranking.find((r:any)=>r.technician_id===actor);
    const freeze=(points=4,at='2026-11-13 15:00Z')=>{const c=json(call('ticket',review('ticket').token,points));sql(`update work_order_point_confirmations set confirmed_at='${at}';`);return c;};
    // Correccion candidata solo dentro del contenedor aislado; nunca se conecta a produccion.
    const preserved=()=>sql("select jsonb_agg(jsonb_build_array(proname,md5(prosrc)) order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('technician_point_contributions','technician_point_contributions_legacy','my_field_progress','get_technician_ranking');");
    const beforeDefinitions=preserved();
    if(process.env.POINTS_BASELINE!=='1')sql(file('../../docs/sql/puntos-noviembre-coherencia-candidate.sql'));
    assert.equal(preserved(),beforeDefinitions,'Fuentes canonicas, historico y calendario intactos');
    await t.test('octubre conserva ceros, NULL, categorias y division entera',()=>{
      reset('tickets','ticket');sql('truncate tickets,job_assignees;');
      sql(`alter table tickets disable trigger guard_work_order_points;insert into tickets(id,points,category,status,assigned_to,created_at,resolved_at) values
        ('${id}',4,'other','resolved','${tech}','2026-10-25','2026-10-26'),
        ('10000000-0000-0000-0000-000000000057',null,'other','resolved','${tech}','2026-10-25','2026-10-26'),
        ('10000000-0000-0000-0000-000000000068',3,'no_service','resolved','${tech}','2026-10-25','2026-10-26');
        insert into job_assignees select 'ticket',id,'${tech}','leader' from tickets;
        insert into job_assignees select 'ticket',id,'${helper}','support' from tickets;alter table tickets enable trigger guard_work_order_points;`);
      const rows=(fn:string)=>sql(`select jsonb_agg(to_jsonb(c) order by job_id,technician_id,kind) from ${fn}('2026-10-01 05:00Z','2026-11-01 05:00Z')c;`);
      assert.equal(rows('technician_point_contributions'),rows('technician_point_contributions_legacy'));
      assert.equal(detail().personalPoints,2); // Detalle operativo anterior intacto; no cambia el historico.
      assert.equal(ranking(tech,'2026-10-15').total_points,1);
    });
    await t.test('sin confirmacion: no acredita; detalle distingue puntos configurados',()=>{
      reset('tickets','ticket');assert.deepEqual(totals(),[0,0]);
      assert.equal(progress().periods.month.points,0);assert.equal(ranking(),undefined);
      assert.equal(detail().scoringState,'pending');assert.equal(detail().creditedPoints,0);
      sql('alter table tickets disable trigger guard_work_order_points;update tickets set points=null;alter table tickets enable trigger guard_work_order_points;');assert.equal(detail().creditedPoints,0);assert.deepEqual(totals(),[0,0]);
    });
    await t.test('manual other: 4 totales, 2 por integrante, aparece aun sin otras categorias',()=>{
      reset('tickets','ticket');sql("update tickets set category='other';");const c=freeze();
      for(const actor of [tech,helper]){assert.equal(progress(actor).periods.month.points,2);assert.equal(ranking(actor)?.total_points,2);assert.equal(detail(actor).creditedPoints,2);assert.equal(detail(actor).jobPoints,4);}
      json(call('ticket',c.review_token,4));assert.deepEqual(totals(),[2,4]);
      assert.equal(review('ticket').confirmation.points,4);
    });
    await t.test('descuento congelado: detalle neto, historial y ranking coinciden',()=>{
      reset('tickets','ticket');sql(`update tickets set client_id='20000000-0000-0000-0000-000000000001';insert into tickets(points,status,category,client_id,created_at,imputable_a_tecnico) values(5,'open','equipment','20000000-0000-0000-0000-000000000001','2026-11-13',true);`);
      freeze(12);for(const actor of [tech,helper]){assert.equal(progress(actor).periods.month.points,3.5);assert.equal(ranking(actor).total_points,3.5);assert.equal(detail(actor).personalPoints,6);assert.equal(detail(actor).recurrencePenalty,2.5);assert.equal(detail(actor).creditedPoints,3.5);}
      sql("update tickets set imputable_a_tecnico=false where status='open';");assert.equal(detail().creditedPoints,3.5);assert.equal(progress().periods.month.points,3.5);
    });
    await t.test('reparto decimal congelado y redondeo solo al sumar',()=>{
      reset('tickets','ticket');freeze(3);assert.equal(detail().creditedPoints,1.5);assert.equal(ranking().total_points,1.5);
      reset('tickets','ticket');sql("insert into profiles(id,role,active) values('00000000-0000-0000-0000-000000000099','TECNICO_RED',true);");
      sql(`insert into job_assignees values('ticket','${id}','00000000-0000-0000-0000-000000000099','support');`);freeze(1);
      assert.ok(Math.abs(detail().creditedPoints-1/3)<1e-12);assert.equal(progress().periods.month.points,0.3);assert.equal(ranking().total_points,0.3);
    });
    await t.test('participantes congelados y guardas: responsable y apoyos iguales',()=>{
      reset('tickets','ticket');freeze();
      assert.throws(()=>as(`delete from job_assignees where job_id='${id}';`),/definitivo/);
      // Deriva sintetica como superusuario: prueba que la lectura usa snapshot, no cuadrilla actual.
      sql('alter table job_assignees disable trigger a_guard_final_work_order;delete from job_assignees;alter table job_assignees enable trigger a_guard_final_work_order;');
      assert.equal(detail(helper).creditedPoints,2);assert.equal(ranking(helper).total_points,2);
      sql("update profiles set role='TECNICO_RED' where id='00000000-0000-0000-0000-000000000005';");
      assert.equal(detail('00000000-0000-0000-0000-000000000005'),null);
    });
    await t.test('corte Peru automatico independiente de UTC/Tokio; semana mixta sin duplicar',()=>{
      reset('tickets','ticket');sql("update tickets set created_at='2026-11-01 05:00Z',resolved_at='2026-11-01 05:00Z';");freeze(4,'2026-11-01 05:00Z');
      clock('2026-11-01 04:59:59.999999Z');assert.equal(progress().periods.month.start,'2026-10-01T05:00:00+00:00');assert.equal(progress().periods.month.points,0);
      clock('2026-11-01 05:00Z');for(const zone of ['UTC','America/Lima','Asia/Tokyo']){const p=JSON.parse(as(`set timezone='${zone}';select my_field_progress();`,tech));assert.equal(Date.parse(p.periods.month.start),Date.parse('2026-11-01 05:00Z'));assert.equal(p.periods.month.points,2);assert.equal(p.periods.week.points,2);}
      assert.deepEqual(totals('2026-10-26 05:00Z','2026-11-02 05:00Z'),[2,4]);clock('2026-11-15 12:00Z');
    });
    for(const [table,kind] of [['installations','installation'],['routines','routine']]) await t.test(kind+': confirmacion coherente en detalle, Mi Avance y Ranking',()=>{
      reset(table,kind);const read=(actor:string)=>json(`select my_field_order_points('${kind}','${id}');`,actor);
      assert.equal(read(tech).scoringState,'pending');assert.equal(progress().periods.month.points,0);
      json(call(kind,review(kind).token,12));officialDate();
      for(const actor of [tech,helper]){assert.equal(read(actor).creditedPoints,6);assert.equal(progress(actor).periods.month.points,6);assert.equal(ranking(actor).total_points,6);}
    });
    await t.test('creada o terminada en octubre no pasa al oficial de noviembre',()=>{
      for(const column of ['created_at','resolved_at']){reset('tickets','ticket');sql(`update tickets set ${column}='2026-11-01 04:59:59.999999Z';`);freeze(12);assert.deepEqual(totals(),[0,0]);assert.equal(progress().periods.month.points,0);}
    });
    await t.test('confirmacion en diciembre acredita diciembre, nunca noviembre',()=>{
      reset('tickets','ticket');freeze(4,'2026-12-01 05:00Z');assert.deepEqual(totals(),[0,0]);assert.equal(progress().periods.month.points,0);
      clock('2026-12-01 05:00Z');assert.equal(progress().periods.month.points,2);assert.equal(ranking(tech,'2026-12-01').total_points,2);assert.equal(detail().creditedPoints,2);
      assert.equal(json(`select my_field_job_points('ticket','${id}');`,tech)[0].points,2);
    });
  }finally{docker(['rm','-f',container]);}
});
