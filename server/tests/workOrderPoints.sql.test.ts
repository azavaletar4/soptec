import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const admin = '00000000-0000-0000-0000-000000000002';
const tech = '00000000-0000-0000-0000-000000000003';
const other = '00000000-0000-0000-0000-000000000004';
const id = '10000000-0000-0000-0000-000000000001';

test('Puntos de órdenes: PostgreSQL aislado, sin órdenes reales', { timeout: 180000 }, async t => {
  const container = `rayco-points-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const sql = (s: string) => docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],s).trim();
  const as = (s: string, uid=admin) => sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
  const adjust = (kind: string, points: string, old: string, reason="'Revisión administrativa'") =>
    `select adjust_work_order_points('${kind}','${id}',${points},${old},${reason});`;
  const reset = (table: string) => {
    sql('truncate work_order_point_changes,tickets,installations,routines,job_assignees;');
    sql(`insert into ${table}(id,points,assigned_to) values('${id}',5,'${tech}');`);
  };
  try {
    docker(['run','--rm','-d','--pull=never','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
    let ready=false;
    for(let n=0;n<60;n++) { try { docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']); ready=true; break; } catch { await new Promise(r=>setTimeout(r,100)); } }
    assert.ok(ready);
    sql(file('./jobWorkSessionsSchema.sql'));
    sql(`alter table profiles add column full_name text,add column email text;
      alter table tickets add column points integer,add column category text default 'no_service',add column client_id uuid,
        add column created_at timestamptz default '2026-10-01',add column resolved_at timestamptz,add column closed_at timestamptz,
        add column imputable_a_tecnico boolean default false;
      alter table installations add column completed_at timestamptz;
      alter table routines add column points numeric,add column completed_at timestamptz;
      grant usage on schema auth to authenticated;
      create policy profiles_read on profiles for select to authenticated using(true);`);
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    sql(file('./workOrderPointsContributionBaseline.sql'));
    sql(file('./workOrderPointsDefaultPrivileges.sql'));
    const originalSource = sql("select md5(prosrc) from pg_proc where oid='technician_point_contributions(timestamptz,timestamptz)'::regprocedure;");
    // Historical fixtures exist BEFORE migration; migration must not rewrite them.
    sql(`insert into tickets(id,points,status,assigned_to,resolved_at) values('${id}',null,'resolved','${tech}','2026-10-05');
      insert into routines(points,status) values(null,'completed'),(0,'completed');
      insert into installations(status) values('completed');`);
    sql(file('../../supabase/migrations/20261024190000_field_order_points_readonly.sql'));
    // La lectura no depende de aplicar la candidata anterior: Altas sin columna points.
    sql(`update installations set assigned_to='${tech}';`);
    assert.equal(as("select my_field_order_points('installation',(select id from installations limit 1))->>'jobPoints';",tech),'10');
    sql(file('../../supabase/migrations/20261024180000_work_order_points.sql'));
    await t.test('fuente histórica íntegra: no se activa contabilización administrativa incompleta',()=>{
      assert.equal(sql("select md5(prosrc) from pg_proc where oid='technician_point_contributions(timestamptz,timestamptz)'::regprocedure;"), originalSource);
    });
    await t.test('históricos intactos y fallback de avería',()=>{
      assert.equal(sql('select points is null from tickets;'),'t');
      assert.equal(sql('select count(*) from routines where points is null or points=0;'),'2');
      assert.equal(sql('select points is null from installations;'),'t');
      assert.equal(Number(sql("select points from technician_point_contributions('2026-10-01','2026-11-01') where job_type='ticket';")),5);
    });
    await t.test('ACL Supabase: service_role con BYPASSRLS no hereda acceso a auditoría',()=>{
      sql('create table public.points_acl_probe(id integer);');
      try {
        assert.equal(sql("select rolbypassrls from pg_roles where rolname='service_role';"),'t');
        assert.equal(sql("select has_table_privilege('service_role','points_acl_probe','INSERT');"),'t');
        for(const role of ['anon','authenticated','service_role']) {
          for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
            assert.equal(sql(`select has_table_privilege('${role}','work_order_point_changes','${privilege}');`),'f',`${role}: ${privilege}`);
        }
        assert.equal(sql("select has_table_privilege('service_role','work_order_point_changes','SELECT');"),'f');
        assert.equal(sql("select has_table_privilege('authenticated','work_order_point_changes','SELECT');"),'t');
      } finally { sql('drop table public.points_acl_probe;'); }
    });
    for(const [table,kind,terminal] of [['tickets','ticket','resolved'],['installations','installation','completed'],['routines','routine','completed']]) {
      await t.test(`${kind}: creación exige puntos también fuera del formulario`,()=>{
        reset(table);
        for(const value of ['null','0','-1']) assert.throws(()=>as(`insert into ${table}(points) values(${value});`),/puntos mayores/);
        assert.throws(()=>as(`insert into ${table} default values;`),/puntos mayores/);
        as(`insert into ${table}(points) values(8);`);
        assert.equal(sql(`select count(*) from ${table};`),'2');
      });
      await t.test(`${kind}: ajuste auditado, motivo, concurrencia y permisos`,()=>{
        reset(table);
        for(const uid of [tech,other,'00000000-0000-0000-0000-000000000005','']) {
          assert.throws(()=>as(adjust(kind,'8','5'),uid),/Solo ADMIN/);
          assert.throws(()=>as(`update ${table} set points=8 where id='${id}';`,uid),/Solo ADMIN/);
        }
        assert.throws(()=>as(`update ${table} set points=8;`),/motivo obligatorio/);
        for(const value of ['null','0','-1',"'NaN'","'Infinity'"]) assert.throws(()=>as(adjust(kind,value,'5')),/Puntos inválidos/);
        for(const reason of ['null',"''","'  '"]) assert.throws(()=>as(adjust(kind,'8','5',reason)),/Motivo obligatorio/);
        if(kind==='ticket') assert.throws(()=>as(adjust(kind,'1.5','5')),/Puntos inválidos/);
        as(adjust(kind,'8','5'));
        assert.equal(sql(`select points from ${table};`),'8');
        assert.equal(as(`select old_points||'|'||new_points||'|'||changed_by||'|'||reason||'|'||(changed_at<=clock_timestamp()) from work_order_point_changes;`),`5|8|${admin}|Revisión administrativa|true`);
        assert.throws(()=>as(adjust(kind,'9','5')),/puntaje cambió/);
        as(adjust(kind,'8','8')); // no-op must not create duplicate audit rows
        assert.equal(sql('select count(*) from work_order_point_changes;'),'1');
        as(adjust(kind,'9','8'),'00000000-0000-0000-0000-000000000001');
        assert.equal(sql(`select points from ${table};`),'9');
        assert.equal(as('select count(*) from work_order_point_changes;',tech),'0');
        assert.throws(()=>as('delete from work_order_point_changes;'),/permission denied/);
        assert.throws(()=>as("update work_order_point_changes set reason='falso';"),/permission denied/);
      });
      await t.test(`${kind}: cierre de Campo sin cambiar puntos, cierre bloquea ajustes`,()=>{
        reset(table);
        as(`update ${table} set status='${terminal}';`,tech);
        assert.throws(()=>as(adjust(kind,'8','5')),/cerrada/);
        assert.throws(()=>as(`update ${table} set points=8;`),/cerrada/);
        assert.throws(()=>as(`update ${table} set status='${table==='tickets'?'open':'pending'}',points=8;`),/cerrada/);
        assert.equal(sql(`select points from ${table};`),'5');
        assert.equal(sql('select count(*) from work_order_point_changes;'),'0');
      });
      await t.test(`${kind}: auditoría inalterable por API y ajustes autorizados conservados`,()=>{
        reset(table);
        as(adjust(kind,'8','5'));
        as(adjust(kind,'9','8'),'00000000-0000-0000-0000-000000000001');
        const snapshot=sql('select jsonb_agg(to_jsonb(c) order by changed_at,id) from work_order_point_changes c;');
        assert.equal(as('select count(*) from work_order_point_changes;'),'2');
        for(const uid of [tech,other]) {
          assert.throws(()=>as(adjust(kind,'10','9'),uid),/Solo ADMIN/);
          assert.throws(()=>as(`update ${table} set points=10;`,uid),/Solo ADMIN/);
        }
        for(const role of ['anon','authenticated','service_role']) {
          for(const uid of role==='authenticated'?[admin,'00000000-0000-0000-0000-000000000001',tech,other]:['']) {
            const run=(s:string)=>sql(`set role ${role};set request.jwt.claim.sub='${uid}';${s}`);
            for(const statement of [
              `insert into work_order_point_changes(job_type,job_id,old_points,new_points,changed_by,reason) values('${kind}','${id}',9,10,'${admin}','Falsificación');`,
              "update work_order_point_changes set new_points=99,reason='Falso';",
              'delete from work_order_point_changes;',
              'truncate work_order_point_changes;',
            ]) assert.throws(()=>run(statement),/permission denied/,`${role}/${uid}: ${statement}`);
          }
        }
        assert.equal(sql('select jsonb_agg(to_jsonb(c) order by changed_at,id) from work_order_point_changes c;'),snapshot);
        assert.equal(sql(`select points from ${table};`),'9');
      });
    }
    await t.test('reportes y fuente compartida: valor definitivo, reparto y sin duplicación',()=>{
      reset('tickets');
      as(adjust('ticket','12','5'));
      as(adjust('ticket','18','12'));
      sql(`insert into job_assignees values('ticket','${id}','${tech}','leader'),('ticket','${id}','${other}','support');
        update tickets set status='resolved',resolved_at='2026-10-05',category='no_service';`);
      assert.deepEqual(sql("select count(*)||'|'||sum(points) from technician_point_contributions('2026-10-01','2026-11-01');").split('|').map(Number),[2,18]);
      sql(`update tickets set status='closed';`);
      assert.equal(Number(sql("select sum(points) from technician_point_contributions('2026-10-01','2026-11-01');")),18);
    });
    await t.test('contabilización existente intacta: Alta conserva 10 y Rutina su valor actual',()=>{
      for(const [table,kind] of [['installations','installation'],['routines','routine']]) {
        reset(table); as(adjust(kind,'11','5'));
        sql(`update ${table} set status='completed',completed_at='2026-10-05';`);
        assert.equal(Number(sql("select sum(points) from technician_point_contributions('2026-10-01','2026-11-01');")),kind==='installation'?10:11);
      }
    });
    await t.test('reprogramada admite ajuste; cancelada no; admin inactivo no',()=>{
      reset('tickets'); sql("update tickets set status='rescheduled';"); as(adjust('ticket','8','5'));
      sql(`update profiles set active=false where id='${admin}';`);
      assert.throws(()=>as(adjust('ticket','9','8')),/Solo ADMIN/);
      sql(`update profiles set active=true where id='${admin}';`);
      reset('routines'); sql("update routines set status='cancelled';");
      assert.throws(()=>as(adjust('routine','8','5')),/cerrada o cancelada/);
    });
    for (const [table,kind,terminal] of [['tickets','ticket','resolved'],['installations','installation','completed'],['routines','routine','completed']]) {
      await t.test(`${kind}: líder/ayudante ven puntaje abierto, ajuste, terminado y baja de asignación`,()=>{
        reset(table);
        // Convertir otro perfil a técnico de apoyo solo dentro de esta fixture.
        sql(`update profiles set role='TECNICO_RED' where id='${other}';
          insert into job_assignees values('${kind}','${id}','${tech}','leader'),('${kind}','${id}','${other}','support');`);
        const read=(uid=tech)=>JSON.parse(as(`select my_field_order_points('${kind}','${id}');`,uid)||'null');
        for(const uid of [tech,other]) {
          assert.equal(read(uid).jobPoints,5);assert.equal(read(uid).personalPoints,2.5);assert.equal(read(uid).crewSize,2);
        }
        as(adjust(kind,'12','5'));
        assert.equal(read().jobPoints,12);assert.equal(read(other).personalPoints,6);
        for(const uid of [tech,other]) {
          assert.throws(()=>as(adjust(kind,'18','12'),uid),/Solo ADMIN/);
          assert.throws(()=>as(`update ${table} set points=18;`,uid),/Solo ADMIN/);
        }
        const timestamp=kind==='ticket'?'resolved_at':'completed_at';
        as(`update ${table} set status='${terminal}',${timestamp}='2026-10-05';`,tech);
        assert.equal(read(other).jobPoints,12);
        // Reintento de cierre no crea puntos ni auditorías adicionales.
        sql(`update ${table} set status='${terminal}';`);
        assert.equal(read().personalPoints,6);
        // Solo contabilidad vigente de prueba: no certifica finalización administrativa.
        assert.deepEqual(sql("select count(*)||'|'||sum(points) from technician_point_contributions('2026-10-01','2026-11-01');").split('|').map(Number),[2,kind==='installation'?10:12]);
        assert.equal(sql('select count(*) from work_order_point_changes;'),'1');
        sql(`delete from job_assignees where technician_id='${other}';`);
        assert.equal(read(other),null);assert.equal(read().personalPoints,12);
        assert.throws(()=>as(`select my_field_order_points('${kind}','${id}');`,admin),/propio técnico/);
        assert.throws(()=>as(`select my_field_order_points('${kind}','${id}');`,''),/propio técnico/);
        sql(`update profiles set active=false where id='${tech}';`);
        assert.throws(()=>read(),/propio técnico/);
        sql(`update profiles set active=true where id='${tech}';`);
        assert.equal(JSON.parse(as(`select my_field_order_points('${kind}','00000000-0000-0000-0000-000000000099');`,tech)||'null'),null);
      });
    }
    await t.test('consulta: fallback de asignación y permisos SQL, sin escrituras laterales',()=>{
      reset('tickets');
      const read=(uid=tech)=>JSON.parse(as(`select my_field_order_points('ticket','${id}');`,uid)||'null');
      assert.equal(read().personalPoints,5);assert.equal(read(other),null);
      assert.equal(sql('select count(*) from work_order_point_changes;'),'0');
      for(const role of ['anon','service_role']) assert.throws(()=>sql(`set role ${role}; select my_field_order_points('ticket','${id}');`),/permission denied/);
      assert.throws(()=>as(`select my_field_order_points('invalid','${id}');`,tech),/Tipo de orden/);
    });
  } finally { docker(['rm','-f',container]); }
});
