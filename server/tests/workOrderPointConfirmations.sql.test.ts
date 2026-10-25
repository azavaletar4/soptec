import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const admin='00000000-0000-0000-0000-000000000002';
const root='00000000-0000-0000-0000-000000000001';
const tech='00000000-0000-0000-0000-000000000003';
const helper='00000000-0000-0000-0000-000000000004';
const id='10000000-0000-0000-0000-000000000001';
test('Confirmación administrativa: tres órdenes, PostgreSQL sin red ni datos reales',{timeout:180000},async t=>{
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
    sql(file('../../supabase/migrations/20261024180000_work_order_points.sql'));
    sql(file('../../supabase/migrations/20261024190000_field_order_points_readonly.sql'));
    sql(file('../../supabase/migrations/20261024200000_work_order_point_confirmations.sql'));
    for(const [table,kind] of [['tickets','ticket'],['installations','installation'],['routines','routine']]) {
      await t.test(`${kind}: finalización técnica no acredita; confirmación explícita y única`,()=>{
        reset(table,kind);assert.deepEqual(totals(),[0,0]);
        const r=review(kind);assert.equal(r.finished,true);assert.equal(r.crew.length,2);assert.equal(r.definitiveClosure,true);
        for(const actor of [tech,helper,'00000000-0000-0000-0000-000000000005','']){
          assert.throws(()=>as(call(kind,r.token),actor),/Solo ADMIN/);
          assert.throws(()=>as(`update ${table} set points=18;`,actor),/Solo ADMIN/);
          assert.throws(()=>json(`select work_order_point_review('${kind}','${id}');`,actor),/Solo ADMIN/);
        }
        assert.throws(()=>as(call(kind,r.token,12,'false')),/explícitamente/);
        assert.throws(()=>as(call(kind,r.token,12,'null')),/explícitamente/);
        const first=json(call(kind,r.token));assert.equal(first.points,12);
        assert.equal(json(call(kind,r.token),root).id,first.id);
        officialDate();assert.deepEqual(totals(),[2,12]);
        assert.equal(json(call(kind,r.token)).id,first.id);assert.deepEqual(totals(),[2,12]);
        assert.equal(sql('select count(*) from work_order_point_confirmations;'),'1');
        assert.equal(sql('select count(*) from work_order_point_changes;'),'0');
        assert.throws(()=>as(`select adjust_work_order_points('${kind}','${id}',18,12,'cambio tardío');`),/Cierre administrativo definitivo/);
        assert.throws(()=>as(call(kind,r.token,18)),/confirmación vigente/);
        assert.equal(json(`select my_field_job_points('${kind}','${id}');`,tech)[0].points,6);
        const state=sql(`select status from ${table};`);assert.equal(state,kind==='ticket'?'resolved':'completed');
      });
      await t.test(`${kind}: modificación y confirmación atómicas con auditoría`,()=>{
        reset(table,kind);const r=review(kind);
        assert.throws(()=>as(call(kind,r.token,18,'true',"''")),/Motivo obligatorio/);
        assert.equal(sql('select count(*) from work_order_point_confirmations;'),'0');
        json(call(kind,r.token,18),root);officialDate();assert.deepEqual(totals(),[2,18]);
        assert.equal(sql(`select points from ${table};`),'18');
        assert.equal(as('select old_points||\'|\'||new_points||\'|\'||changed_by from work_order_point_changes;'),`12|18|${root}`);
        json(call(kind,r.token,18));assert.equal(sql('select count(*) from work_order_point_changes;'),'1');
        // Si falla el registro final, la edición y su auditoría se revierten.
        reset(table,kind);
        sql("create function fail_point_confirmation() returns trigger language plpgsql as $$begin raise exception 'Fallo final simulado';end$$;create trigger fail_confirmation before insert on work_order_point_confirmations for each row execute function fail_point_confirmation();");
        try {assert.throws(()=>as(call(kind,review(kind).token,18)),/Fallo final/);assert.equal(sql(`select points from ${table};`),'12');assert.equal(sql('select count(*) from work_order_point_changes;'),'0');}
        finally{sql('drop trigger fail_confirmation on work_order_point_confirmations;drop function fail_point_confirmation();');}
      });
      await t.test(`${kind}: cierre definitivo rechaza reapertura, cancelación y cambios directos/RPC`,()=>{
        reset(table,kind);const old=review(kind);
        sql(`delete from job_assignees where technician_id='${helper}';`);
        assert.throws(()=>as(call(kind,old.token)),/cuadrilla cambió/);
        const r=review(kind);json(call(kind,r.token));officialDate();assert.deepEqual(totals(),[1,12]);
        for(const actor of [admin,root,tech,helper]){
          for(const change of [`status='${kind==='ticket'?'open':'pending'}'`,'points=18',`assigned_to='${helper}'`,`${kind==='ticket'?'resolved_at':'completed_at'}='2026-11-20'`]){
            assert.throws(()=>as(`update ${table} set ${change};`,actor),/Cierre administrativo definitivo/);
          }
          assert.throws(()=>as(`delete from ${table};`,actor),/Cierre administrativo definitivo/);
          assert.throws(()=>as(`insert into job_assignees values('${kind}','${id}','${helper}','support');`,actor),/Cierre administrativo definitivo/);
          assert.throws(()=>as(`update job_assignees set role='support';`,actor),/Cierre administrativo definitivo/);
          assert.throws(()=>as('delete from job_assignees;',actor),/Cierre administrativo definitivo/);
        }
        if(kind==='ticket')assert.throws(()=>as("update tickets set category='other';"),/Cierre administrativo definitivo/);
        else assert.throws(()=>as(`update ${table} set status='cancelled';`),/Cierre administrativo definitivo/);
        // Aun una RPC SECURITY DEFINER con permisos demasiado amplios queda guardada.
        sql(`create function test_reopen() returns void language plpgsql security definer set search_path=public as $body$begin update ${table} set status='${kind==='ticket'?'open':'pending'}';end$body$;`);
        try{assert.throws(()=>as('select test_reopen();'),/Cierre administrativo definitivo/);}
        finally{sql('drop function test_reopen();');}
        assert.equal(json(call(kind,r.token)).id,r.confirmation?.id||review(kind).confirmation.id);
        assert.deepEqual(totals(),[1,12]);assert.equal(sql('select count(*) from work_order_point_confirmations;'),'1');
        assert.equal(sql('select count(*) from work_order_point_confirmations where invalidated_at is not null;'),'0');
        assert.equal(as(`select work_order_is_final('${kind}','${id}');`,tech),'t');
      });
      await t.test(`${kind}: abiertas, sin cuadrilla e históricos de octubre`,()=>{
        reset(table,kind,false);assert.throws(()=>as(call(kind,review(kind).token)),/todavía no ha terminado/);
        reset(table,kind);sql(`delete from job_assignees;update ${table} set assigned_to=null;`);
        assert.throws(()=>as(call(kind,review(kind).token)),/Asigna la cuadrilla/);
        reset(table,kind,true,true);
        const before=sql("select jsonb_agg(to_jsonb(c) order by technician_id) from technician_point_contributions_legacy('2026-10-01','2026-11-01 05:00Z')c;");
        assert.throws(()=>as(call(kind,review(kind).token,18)),/históricos de octubre/);
        json(call(kind,review(kind).token));officialDate();assert.deepEqual(totals(),[0,0]);
        assert.equal(sql("select jsonb_agg(to_jsonb(c) order by technician_id) from technician_point_contributions('2026-10-01','2026-11-01 05:00Z')c;"),before);
        assert.equal(sql(`select points from ${table};`),'12');
      });
    }
    await t.test('dos confirmaciones concurrentes: mismo id, un solo reparto',async()=>{
      reset('routines','routine');const token=review('routine').token;
      const run=()=>new Promise<{code:number|null;out:string}>((resolve,reject)=>{
        const p=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);p.on('error',reject);p.on('close',code=>resolve({code,out:out.trim()}));
        p.stdin.end(`set role authenticated;set request.jwt.claim.sub='${admin}';${call('routine',token)}`);
      });
      const results=await Promise.all([run(),run()]);assert.deepEqual(results.map(r=>r.code),[0,0]);
      assert.equal(JSON.parse(results[0].out).id,JSON.parse(results[1].out).id);
      officialDate();assert.deepEqual(totals(),[2,12]);
    });
    await t.test('RLS/privilegios: sin escrituras directas, inactivos, anon y service_role',()=>{
      reset('tickets','ticket');const token=review('ticket').token;json(call('ticket',token));
      assert.equal(as('select count(*) from work_order_point_confirmations;',tech),'0');
      for(const actor of [admin,tech]){
        assert.throws(()=>as('delete from work_order_point_confirmations;',actor),/permission denied/);
        assert.throws(()=>as('update work_order_point_confirmations set points=99;',actor),/permission denied/);
        assert.throws(()=>as("insert into work_order_point_confirmations(job_type) values('ticket');",actor),/permission denied/);
      }
      sql(`update profiles set active=false where id='${admin}';`);
      assert.throws(()=>as(call('ticket',token)),/Solo ADMIN/);sql(`update profiles set active=true where id='${admin}';`);
      for(const role of ['anon','service_role'])assert.throws(()=>sql(`set role ${role};${call('ticket',token)}`),/permission denied/);
      assert.throws(()=>as("select * from technician_point_contributions('2026-11-01','2026-12-01');"),/permission denied/);
    });
    await t.test('reportes: octubre idéntico, noviembre solo confirmados; límites Lima',()=>{
      reset('tickets','ticket');assert.equal(json("select jsonb_agg(r) from ticket_report_points('2026-11-01 05:00Z','2026-12-01 04:59:59.999999Z')r;"),null);
      json(call('ticket',review('ticket').token));officialDate();
      assert.equal(json("select jsonb_build_object('points',sum(points)) from ticket_report_points('2026-11-01 05:00Z','2026-12-01 04:59:59.999999Z');").points,12);
      assert.throws(()=>sql("update tickets set created_at='2026-10-02';"),/Cierre administrativo definitivo/);
      sql(`insert into tickets(points,status,created_at,resolved_at,assigned_to) values(7,'resolved','2026-10-02','2026-10-03','${tech}');`);
      assert.equal(json("select jsonb_build_object('points',sum(points)) from ticket_report_points('2026-10-01','2026-11-01 04:59:59.999999Z');").points,7);
      assert.equal(json("select jsonb_build_object('points',sum(points)) from ticket_report_points('2026-10-01','2026-12-01 04:59:59.999999Z');").points,19);
      assert.deepEqual(totals('2026-11-13 15:00Z','2026-11-13 15:00:00.000001Z'),[2,12]);
      assert.deepEqual(totals('2026-11-13 14:00Z','2026-11-13 15:00Z'),[0,0]);
    });
    await t.test('nueva avería después del cierre no recalcula ni penaliza la anterior',()=>{
      reset('tickets','ticket');sql(`update tickets set client_id='20000000-0000-0000-0000-000000000001';`);
      json(call('ticket',review('ticket').token));officialDate();
      sql(`insert into tickets(points,status,client_id,category,created_at,imputable_a_tecnico) values
        (5,'open','20000000-0000-0000-0000-000000000001','no_service','2026-11-13',true),
        (5,'open','20000000-0000-0000-0000-000000000001','equipment','2026-11-14',true);`);
      assert.deepEqual(totals(),[2,12]);
      assert.equal(json("select jsonb_build_object('points',sum(points)) from ticket_report_points('2026-11-01','2026-12-01');").points,12);
      assert.equal(review('ticket').confirmation.recurrence_penalty,0);
    });
    await t.test('descuento existente se revisa y congela, incluso si cambia la nueva avería',()=>{
      reset('tickets','ticket');sql(`update tickets set client_id='20000000-0000-0000-0000-000000000001';`);
      const stale=review('ticket');
      sql(`insert into tickets(points,status,client_id,category,created_at,imputable_a_tecnico) values(5,'open','20000000-0000-0000-0000-000000000001','equipment','2026-11-13',true);`);
      assert.throws(()=>json(call('ticket',stale.token)),/cuadrilla cambió/);
      const r=review('ticket');assert.equal(r.recurrencePenalty,5);
      const c=json(call('ticket',r.token));assert.equal(c.recurrence_penalty,5);assert.equal(c.crew[0].netPoints,3.5);
      officialDate();assert.deepEqual(totals(),[4,7]);
      sql(`update tickets set imputable_a_tecnico=false,category='other' where id<>'${id}';`);
      assert.deepEqual(totals(),[4,7]);
    });
    await t.test('tres integrantes, fallback líder y ticket cerrado sin confirmación',()=>{
      reset('tickets','ticket');
      sql("insert into profiles(id,role,active,full_name) values('00000000-0000-0000-0000-000000000099','TECNICO_RED',true,'Tercer técnico');");
      sql(`insert into job_assignees values('ticket','${id}','00000000-0000-0000-0000-000000000099','support');update tickets set status='closed',category='other';`);
      assert.deepEqual(totals(),[0,0]);json(call('ticket',review('ticket').token));officialDate();assert.deepEqual(totals(),[3,12]);
      assert.equal(sql("select min(points)||'|'||max(points) from technician_point_contributions('2026-11-01 05:00Z','2026-12-01 05:00Z');").split('|').map(Number).every(n=>n===4),true);
      assert.equal(sql('select status from tickets;'),'closed');
      reset('installations','installation');sql('delete from job_assignees;');
      assert.equal(review('installation').crew.length,1);json(call('installation',review('installation').token));officialDate();assert.deepEqual(totals(),[1,12]);
    });
    await t.test('corte de noviembre en Lima: terminadas en octubre no se trasladan al oficial',()=>{
      reset('routines','routine');sql("update routines set completed_at='2026-11-01 04:59:59.999999Z';");
      assert.equal(review('routine').historical,true);json(call('routine',review('routine').token));officialDate();assert.deepEqual(totals(),[0,0]);
      reset('routines','routine');sql("update routines set completed_at='2026-11-01 05:00:00Z';");
      assert.equal(review('routine').historical,false);json(call('routine',review('routine').token));officialDate();assert.deepEqual(totals(),[2,12]);
      // Tampoco una orden creada en pruebas pasa a oficial por reabrirse.
      reset('routines','routine');sql("update routines set created_at='2026-10-10';");
      assert.equal(review('routine').historical,true);json(call('routine',review('routine').token));officialDate();assert.deepEqual(totals(),[0,0]);
      assert.throws(()=>sql("update routines set status='pending';"),/Cierre administrativo definitivo/);
      officialDate();assert.deepEqual(totals(),[0,0]);
    });
    await t.test('reportes históricos conservan NULL/0, categorías y regla de líder previas',()=>{
      reset('tickets','ticket');
      // Semilla histórica anterior a las guardas: solo dentro del contenedor.
      sql(`alter table tickets disable trigger guard_work_order_points;
        insert into tickets(points,status,created_at,resolved_at,assigned_to,category) values
        (null,'resolved','2026-10-02','2026-10-03','${tech}','no_service'),
        (0,'resolved','2026-10-02','2026-10-03','${tech}','equipment'),
        (7,'resolved','2026-10-02','2026-10-03','${tech}','other');
        alter table tickets enable trigger guard_work_order_points;`);
      const r=json("select jsonb_agg(r) from ticket_report_points('2026-10-01','2026-11-01 04:59:59.999999Z')r;");
      assert.equal(r.length,1);assert.equal(r[0].ticket_count,3);assert.equal(r[0].points,7);
      assert.equal(sql(`select (select jsonb_agg(to_jsonb(c) order by job_id,technician_id,kind) from technician_point_contributions('2026-10-01','2026-11-01 05:00Z')c)
        is not distinct from (select jsonb_agg(to_jsonb(c) order by job_id,technician_id,kind) from technician_point_contributions_legacy('2026-10-01','2026-11-01 05:00Z')c);`),'t');
    });
    await t.test('endpoint mensual: noviembre no incluye las últimas horas de octubre en Lima',()=>{
      reset('routines','routine');sql("update routines set completed_at='2026-11-01 04:59:59Z';");
      assert.equal(as('select count(*) from get_technician_ranking(11,2026);'),'0');
      reset('routines','routine');json(call('routine',review('routine').token));officialDate();
      assert.equal(as('select sum(total_points) from get_technician_ranking(11,2026);'),'12.0');
      assert.equal(sql("select count(*) from technician_point_contributions('2026-11-01 05:00Z','2026-12-01 05:00Z');"),'2');
    });
    await t.test('pendientes conservan reapertura, corrección y cambios de cuadrilla',()=>{
      for(const [table,kind] of [['tickets','ticket'],['installations','installation'],['routines','routine']]){
        reset(table,kind);
        assert.equal(as(`select work_order_is_final('${kind}','${id}');`,tech),'f');
        as(`update ${table} set status='${kind==='ticket'?'open':'pending'}';`,root);
        as(`select adjust_work_order_points('${kind}','${id}',18,12,'Corrección antes de cierre');`,root);
        as(`delete from job_assignees where technician_id='${helper}';`,root);
        as(`update ${table} set status='${kind==='ticket'?'resolved':'completed'}';`,root);
        assert.equal(review(kind).points,18);assert.equal(review(kind).crew.length,1);
        assert.deepEqual(totals(),[0,0]);
      }
    });
    await t.test('RPCs reales de devolver/postergar: pendientes sí, definitivas no',()=>{
      sql(`create table ticket_comments(ticket_id uuid,author_id uuid,body text);
        create table routine_returns(routine_id uuid,technician_id uuid,reason text,crew_snapshot jsonb);
        create table installation_postponements(installation_id uuid,technician_id uuid,reason text,crew_snapshot jsonb);`);
      const functions=[
        ['return_ticket','../../supabase/migrations/20261005010000_fase99_tecnico_devuelve_ticket.sql'],
        ['return_routine','../../supabase/migrations/20261014180000_fase161_devolver_rutinas.sql'],
        ['postpone_installation','../../supabase/migrations/20261017010000_fase163_postergar_instalaciones.sql'],
      ];
      for(const [name,path] of functions) sql(file(path).match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))![0]);
      for(const [table,kind,rpc] of [['tickets','ticket','return_ticket'],['routines','routine','return_routine'],['installations','installation','postpone_installation']]){
        reset(table,kind,false);sql(`update ${table} set status='in_progress';`);
        as(`select ${rpc}('${id}','Motivo de prueba');`,tech);
        assert.equal(sql(`select status from ${table};`),kind==='ticket'?'open':'pending');
        reset(table,kind);sql('truncate ticket_comments;');
        json(call(kind,review(kind).token));
        assert.throws(()=>as(`select ${rpc}('${id}','Intento tras cierre');`,tech),/Cierre administrativo definitivo|en progreso/);
        assert.equal(sql('select count(*) from ticket_comments;'),'0');
        assert.equal(sql(`select status from ${table};`),kind==='ticket'?'resolved':'completed');
      }
    });
    await t.test('DELETE: guardas y devolución Fase 59 son transaccionales, sin escrituras previas',()=>{
      reset('tickets','ticket',false);
      sql(`create table inventory_movements(id uuid primary key default gen_random_uuid(),product_id uuid,movement_type text,quantity numeric,
        reason text,ticket_id uuid references tickets(id) on delete set null,installation_id uuid,reverses_movement_id uuid);
        insert into inventory_movements(product_id,movement_type,quantity,ticket_id) values('20000000-0000-0000-0000-000000000001','egreso',3,'${id}');`);
      const reversals=file('../../supabase/migrations/20261002000000_fase59_devolucion_automatica_inventario.sql');
      for(const name of ['reverse_egreso_movements','reverse_inventory_on_ticket_delete'])
        sql(reversals.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'))![0]);
      sql('create trigger trg_tickets_reverse_on_delete before delete on tickets for each row execute function reverse_inventory_on_ticket_delete();');
      as('delete from tickets;');
      assert.equal(sql("select count(*) from inventory_movements where movement_type='ingreso';"),'1');
      as('delete from tickets;');assert.equal(sql("select count(*) from inventory_movements where movement_type='ingreso';"),'1');
      sql(`insert into tickets(id,points,status,assigned_to,resolved_at) values('${id}',12,'resolved','${tech}','2026-11-12');
        insert into inventory_movements(product_id,movement_type,quantity,ticket_id) values('20000000-0000-0000-0000-000000000001','egreso',4,'${id}');`);
      json(call('ticket',review('ticket').token));
      assert.throws(()=>as('delete from tickets;'),/Cierre administrativo definitivo/);
      assert.equal(sql("select count(*) from inventory_movements where movement_type='ingreso';"),'1');
      assert.equal(sql('select count(*) from tickets;'),'1');
    });
  }finally{docker(['rm','-f',container]);}
});
