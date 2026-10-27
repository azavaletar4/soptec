const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Verifica scripts/sql/asistencia-a2-rollback.sql de punta a punta: se
// simula actividad real (novedad + horario personal ya creados) ANTES de
// revertir, y se confirma que el rollback nunca borra esos datos, que
// mark_attendance_ingreso vuelve EXACTO a su forma de Fase 117 (capturada
// de produccion), y que las vias de escritura nuevas quedan sin permiso.
test('Rollback de A2/A2.1: conserva datos reales, revierte comportamiento, sin DROP de evidencias', { timeout: 60000 }, async t => {
 const container = `attendance-a2-rollback-${process.pid}-${Date.now()}`;
 const docker = (args, input) => execFileSync('docker', args, { input, encoding:'utf8', windowsHide:true, stdio:['pipe','pipe','pipe'] }).trim();
 const args = ['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
 const sql = q => docker(args,q);
 const norm = s => s.replace(/\r\n/g, '\n'); // el checkout de Windows guarda algunos .sql con CRLF; no cambia la lógica, solo la línea
 const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const as = (n,q) => sql(`set role authenticated; set request.jwt.claim.sub='${id(n)}'; ${q}`);
 const read = p => readFileSync(path.join(__dirname,p),'utf8');
 const today = `(now() at time zone 'America/Lima')::date`;
 try {
  docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;
  for(let i=0;i<60;i++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready);
  sql(`create role anon; create role authenticated; create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create type public.user_role as enum ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION','CLIENTE');
   create table profiles(id uuid primary key,role user_role,active boolean default true);
   create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
   grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  sql(read('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)[0]);
  sql(read('../../supabase/migrations/20261006020000_fase117_control_asistencia.sql'));
  const fase117Def = norm(sql("select pg_get_functiondef('public.mark_attendance_ingreso(numeric,numeric)'::regprocedure);"));
  sql(read('../../supabase/migrations/20261027010000_asistencia_a0_a1.sql'));
  sql(read('../../supabase/migrations/20261028000000_asistencia_a2_novedades.sql'));
  sql(read('../../supabase/migrations/20261028010000_asistencia_a2_horarios_personales.sql'));
  sql(`insert into profiles(id,role,active) values('${id(1)}','SUPERADMIN',true),('${id(2)}','ADMIN',true),('${id(3)}','TECNICO_RED',true);
   grant select,insert,update,delete on all tables in schema public to authenticated;
   grant usage on all sequences in schema public to authenticated;`);
  assert.notEqual(norm(sql("select pg_get_functiondef('public.mark_attendance_ingreso(numeric,numeric)'::regprocedure);")), fase117Def, 'A2.1 ya debe haber modificado la función (precondición del test)');

  await t.test('simula actividad real antes del rollback: una novedad y un horario personal ya creados',()=>{
   assert.equal(as(1,`select estado from asistencia_novedad_crear('${id(10)}','${id(3)}','vacaciones',${today}+5,${today}+9,null,null,null,'vacaciones reales');`),'activa');
   assert.equal(as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(2)}',6,'tarde','14:00','18:00','${id(1)}') returning turno;`),'tarde');
  });

  await t.test('aplica el rollback',()=>{
   sql(read('../../scripts/sql/asistencia-a2-rollback.sql'));
  });

  await t.test('los datos reales creados antes del rollback NUNCA se borran',()=>{
   assert.equal(sql(`select count(*) from asistencia_novedades where id='${id(10)}' and motivo='vacaciones reales';`),'1');
   assert.equal(sql(`select count(*) from asistencia_horarios_personales where user_id='${id(2)}' and dia_semana=6;`),'1');
  });

  await t.test('mark_attendance_ingreso vuelve EXACTO a su forma de Fase 117 (capturada de producción)',()=>{
   assert.equal(norm(sql("select pg_get_functiondef('public.mark_attendance_ingreso(numeric,numeric)'::regprocedure);")), fase117Def);
  });

  await t.test('las RPC de novedades quedan sin permiso de ejecución para authenticated',()=>{
   assert.equal(sql("select has_function_privilege('authenticated','asistencia_novedad_crear(uuid,uuid,text,date,date,text,time,time,text)','execute');"),'f');
   assert.equal(sql("select has_function_privilege('authenticated','asistencia_novedad_cancelar(uuid,integer,text)','execute');"),'f');
   assert.equal(sql("select has_function_privilege('authenticated','asistencia_novedades_resumen(date,date,date,uuid)','execute');"),'f');
  });

  await t.test('horarios_personales ya no admite escritura directa, ni siquiera de SUPERADMIN',()=>{
   assert.throws(()=>as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',5,'manana','08:00','13:00','${id(1)}');`));
   assert.throws(()=>as(1,`update asistencia_horarios_personales set hora_ingreso='09:00' where user_id='${id(2)}' and dia_semana=6;`));
   // La lectura se conserva (igual que A0/A1 conserva lectura de solicitudes).
   assert.equal(as(1,'select count(*) from asistencia_horarios_personales;'),'1');
  });

  await t.test('mark_attendance_ingreso ya no usa el horario personal (vuelve al global, sin regresión visible para quien no tenía uno)',()=>{
   // Sabado real no simulado por reloj: solo se verifica que la función ya
   // no referencia asistencia_horarios_personales en su definición (la
   // precedencia de A2.1 quedó completamente removida del cuerpo).
   assert.doesNotMatch(sql("select pg_get_functiondef('public.mark_attendance_ingreso(numeric,numeric)'::regprocedure);"), /asistencia_horarios_personales|asistencia_novedades/);
  });

 } finally { try{docker(['stop',container]);}catch{} }
});
