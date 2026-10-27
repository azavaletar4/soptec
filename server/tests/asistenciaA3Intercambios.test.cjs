const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('A3 PostgreSQL efímero sin red: intercambio y jornada real', { timeout: 60000 }, async t => {
 const container = `attendance-a3-${process.pid}-${Date.now()}`;
 const docker = (args, input) => execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
 const sql = q => docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'], q);
 const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 let clock = '2026-10-26T12:00:00Z';
 const as = (n,q) => sql(`set test.clock='${clock}'; set role authenticated; set request.jwt.claim.sub='${id(n)}'; ${q}`);
 const read = p => readFileSync(path.join(__dirname,'../..',p),'utf8');
 const crear = (op,user,descanso='2026-11-02',trabajo='2026-11-01',inicio='09:00',fin='18:00') => `select estado from asistencia_intercambio_crear('${id(op)}','${id(user)}','${descanso}','${trabajo}','${inicio}','${fin}');`;
 const mark = n => as(n,'select minutos_tardanza,estado from mark_attendance_ingreso(null,null);');
 try {
  docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready = false;
  for (let i=0;i<80;i++) { try {docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']); ready=true;break;} catch {await new Promise(r=>setTimeout(r,100));} }
  assert.ok(ready);
  sql(`create role anon; create role authenticated; create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create type public.user_role as enum ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION','CLIENTE');
   create table profiles(id uuid primary key,role user_role,active boolean default true);
   create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
   grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
   -- Reloj solo de esta base efímera: no cambia el reloj del SO/host ni las migraciones.
   create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select coalesce(nullif(current_setting('test.clock',true),''),'2026-10-26T12:00:00Z')::timestamptz$$;`);
  sql(read('supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)[0]);
  for (const f of ['20261006020000_fase117_control_asistencia.sql','20261027010000_asistencia_a0_a1.sql','20261028000000_asistencia_a2_novedades.sql','20261028010000_asistencia_a2_horarios_personales.sql']) sql(read('supabase/migrations/'+f));
  sql(`insert into profiles values('${id(1)}','SUPERADMIN',true),('${id(2)}','ADMIN',true),('${id(3)}','TECNICO_RED',true),('${id(4)}','TECNICO_RED',false),('${id(5)}','CLIENTE',true);
   grant select on profiles to authenticated;
   grant select,insert,update,delete on feriados to authenticated;`);
  as(3,'select * from mark_attendance_ingreso(null,null);');
  const before = sql("select md5(coalesce(string_agg(row_to_json(r)::text,',' order by id),'')) from asistencia_registros r;");
  sql(read('supabase/migrations/20261029000000_asistencia_a3_intercambios.sql'));
  await t.test('migración no cambia marcaciones; permisos y rollback vacío conservan A2.1',()=>{
   assert.equal(sql("select md5(coalesce(string_agg(row_to_json(r)::text,',' order by id),'')) from asistencia_registros r;"),before);
   sql(read('scripts/sql/asistencia-a3-rollback.sql'));
   assert.equal(sql("select has_function_privilege('authenticated','mark_attendance_ingreso(numeric,numeric)','execute');"),'t');
   assert.equal(sql("select position('v_intercambio' in pg_get_functiondef('mark_attendance_ingreso(numeric,numeric)'::regprocedure));"),'0');
   // Tablas y evidencia preservadas; reactivar permisos/guards para continuar la prueba.
   sql(`grant execute on function asistencia_intercambio_crear(uuid,uuid,date,date,time,time),asistencia_intercambio_cancelar(uuid,text),asistencia_intercambios_resumen(date,date,date,uuid) to authenticated;`);
   // Reactivar las definiciones A3 eliminadas por rollback, sin recrear datos.
   const migration=read('supabase/migrations/20261029000000_asistencia_a3_intercambios.sql');
   sql(migration.slice(migration.indexOf('-- A2 conserva su RPC;')));
  });
  await t.test('solo SUPERADMIN programa; objetivos exentos/inactivos y fechas contradictorias rechazados',()=>{
   assert.throws(()=>as(2,crear(10,3)),/SUPERADMIN/); assert.throws(()=>as(3,crear(10,3)),/SUPERADMIN/);
   assert.throws(()=>sql(`set role anon; ${crear(10,3)}`),/permission denied/);
   for (const n of [1,4,5]) assert.throws(()=>as(1,crear(10,n)),/activo/);
   assert.throws(()=>as(1,crear(10,3,'2026-10-25')),/pasados/);
   assert.throws(()=>as(1,crear(10,3,'2026-11-01','2026-11-08')),/laborable/);
   assert.throws(()=>as(1,crear(10,3,'2026-11-02','2026-11-03')),/domingo o feriado/);
   assert.throws(()=>as(1,crear(10,3,'2026-11-02','2026-11-01','18:00','09:00')),/inválidos/);
  });
  await t.test('lunes libre y domingo compensatorio en único registro idempotente; sin duplicados ni reutilización de fechas',()=>{
   assert.equal(as(1,crear(10,3)),'activo'); assert.equal(as(1,crear(10,3)),'activo');
   assert.throws(()=>as(1,crear(10,3,'2026-11-03')),/diferentes/);
   assert.throws(()=>as(1,crear(11,3)),/intercambio/);
   assert.throws(()=>as(1,crear(12,3,'2026-11-03')),/intercambio/);
   assert.equal(as(1,crear(13,2,'2026-11-09','2026-11-08')),'activo');
  });
  await t.test('RLS real: ADMIN/técnico ven solo sus intercambios; SUPERADMIN todos; ninguna escritura directa',()=>{
   assert.equal(as(2,'select count(*) from asistencia_intercambios;'),'1');
   assert.equal(as(3,'select count(*) from asistencia_intercambios;'),'1');
   assert.equal(as(1,'select count(*) from asistencia_intercambios;'),'2');
   assert.equal(as(5,'select count(*) from asistencia_intercambios;'),'0');
   for (const n of [1,2,3]) assert.throws(()=>as(n,'delete from asistencia_intercambios;'),/permission denied/);
   assert.throws(()=>as(3,"select * from asistencia_intercambios_resumen('2026-11-01','2026-11-30');"),/autorizado/);
  });
  await t.test('conflictos A2 en ambos sentidos, incluido permiso por horas y feriado posterior',()=>{
   assert.throws(()=>as(1,`select * from asistencia_novedad_crear('${id(20)}','${id(3)}','vacaciones','2026-11-02','2026-11-03');`),/intercambio/);
   as(1,`select * from asistencia_novedad_crear('${id(21)}','${id(3)}','permiso_horas','2026-11-09','2026-11-09',null,'08:00','10:00',null);`);
   assert.throws(()=>as(1,crear(22,3,'2026-11-09','2026-11-08')),/permiso/);
   assert.throws(()=>as(1,"insert into feriados(fecha,nombre) values('2026-11-02','Feriado nuevo');"),/intercambio/);
  });
  await t.test('cancelación atómica auditada, sin permiso personal ni motivo vacío',()=>{
   assert.throws(()=>as(2,`select * from asistencia_intercambio_cancelar('${id(13)}','Cambio');`),/SUPERADMIN/);
   assert.throws(()=>as(1,`select * from asistencia_intercambio_cancelar('${id(13)}','');`),/motivo/);
   assert.equal(as(1,`select estado from asistencia_intercambio_cancelar('${id(13)}','Cambio de planes');`),'cancelado');
   assert.equal(as(1,"select count(*) from asistencia_config_eventos where tabla='asistencia_intercambios';"),'3');
  });
  await t.test('domingo habilitado: ingreso puntual y almuerzo/salida reales; sin intercambio y SUPERADMIN no marcan',()=>{
   clock='2026-11-01T14:03:00Z';
   assert.equal(mark(3),'0|Puntual');
   assert.throws(()=>mark(2),/domingo/); assert.throws(()=>mark(1),/domingo|autorizada/);
   clock='2026-11-01T17:00:00Z'; as(3,'select * from mark_attendance_inicio_almuerzo();');
   clock='2026-11-01T18:00:00Z'; as(3,'select * from mark_attendance_fin_almuerzo(null,null);');
   clock='2026-11-01T23:00:00Z'; assert.equal(as(3,'select estado from mark_attendance_salida(null,null);'),'Finalizado');
   assert.throws(()=>as(1,`select * from asistencia_intercambio_cancelar('${id(10)}','Cambio tardío');`),/comenzó/);
  });
  await t.test('lunes libre no permite ingreso ni solicitud redundante; resumen mensual vincula ambos días',()=>{
   clock='2026-11-02T14:00:00Z'; assert.throws(()=>mark(3),/descanso autorizado/);
   assert.throws(()=>as(3,`select * from reportar_ausencia_hoy('${id(30)}','2026-11-02','otros',null);`),/descanso autorizado/);
   assert.equal(as(2,"select fecha,tipo,fecha_vinculada from asistencia_intercambios_resumen('2026-11-01','2026-11-30');"),'2026-11-01|trabajo|2026-11-02\n2026-11-02|descanso|2026-11-01');
   assert.throws(()=>as(3,"update asistencia_registros set minutos_tardanza=0;"),/permission denied/);
   assert.throws(()=>sql(read('scripts/sql/asistencia-a3-rollback.sql')),/Rollback detenido/);
  });
  await t.test('sábado personal y tardanza A2.1 intactos; SUPERADMIN exento; histórico conservado',()=>{
   const snapshot=sql("select row_to_json(r)::text from asistencia_registros r where user_id='"+id(3)+"' and fecha='2026-11-01';");
   as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',6,'tarde','13:30','19:00','${id(1)}');`);
   clock='2026-11-07T18:40:00Z'; assert.equal(mark(3),'5|Tardanza');
   assert.throws(()=>mark(1),/autorizada/);
   assert.throws(()=>as(1,crear(39,2,'2026-11-07','2026-11-08')),/ya comenzó/);
   assert.equal(sql("select row_to_json(r)::text from asistencia_registros r where user_id='"+id(3)+"' and fecha='2026-11-01';"),snapshot);
  });
  await t.test('feriado compensatorio: horario propio y tardanza real; límites de Perú y jornadas concluidas',()=>{
   clock='2026-11-07T18:40:00Z';
   as(1,"insert into feriados(fecha,nombre) values('2026-11-12','Feriado ficticio');");
   assert.equal(as(1,crear(40,2,'2026-11-13','2026-11-12','10:00','18:00')),'activo');
   clock='2026-11-12T15:12:00Z'; assert.equal(mark(2),'7|Tardanza');
   assert.throws(()=>as(1,crear(41,3,'2026-11-13','2026-11-12','10:00','18:00')),/comenzó/);
   clock='2026-11-13T04:59:00Z';
   assert.equal(as(2,"select (now() at time zone 'America/Lima')::date;"),'2026-11-12');
   assert.throws(()=>as(1,`select * from asistencia_intercambio_cancelar('${id(40)}','Cambio');`),/comenzó/);
  });
  await t.test('concurrencia real: un solo ganador al duplicar o cruzar A2/A3',async()=>{
   const concurrent=q=>new Promise(resolve=>{
    const child=spawn('docker',['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    child.on('exit',code=>resolve({code,output}));child.on('error',e=>resolve({code:-1,output:String(e)}));
    child.stdin.end(`set test.clock='2026-10-26T12:00:00Z';set role authenticated;set request.jwt.claim.sub='${id(1)}';${q}`);
   });
   const duplicate=await Promise.all([concurrent(crear(50,2,'2026-11-23','2026-11-22')),concurrent(crear(51,2,'2026-11-23','2026-11-22'))]);
   assert.equal(duplicate.filter(r=>r.code===0).length,1,JSON.stringify(duplicate));
   const cross=await Promise.all([concurrent(crear(52,2,'2026-11-30','2026-11-29')),concurrent(`select * from asistencia_novedad_crear('${id(53)}','${id(2)}','vacaciones','2026-11-30','2026-11-30');`)]);
   assert.equal(cross.filter(r=>r.code===0).length,1,JSON.stringify(cross));
  });
 } finally { try {docker(['rm','-f',container]);} catch {} }
});
