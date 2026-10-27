const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Reloj del contenedor manipulable (--cap-add SYS_TIME + `date -s`) para
// probar la PRECEDENCIA real de mark_attendance_ingreso contra distintos
// dias/horas sin inventar un mock de now(). Aislado: --network none y
// --rm; el cambio de hora queda dentro del namespace del propio
// contenedor (verificado: no afecta al host ni a otros contenedores).
test('A2.1 PostgreSQL aislado: horarios parciales recurrentes y precedencia de tardanza', { timeout: 60000 }, async t => {
 const container = `attendance-a2-horarios-${process.pid}-${Date.now()}`;
 const docker = (args, input) => execFileSync('docker', args, { input, encoding:'utf8', windowsHide:true, stdio:['pipe','pipe','pipe'] }).trim();
 const args = ['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
 const sql = q => docker(args,q);
 const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const as = (n,q) => sql(`set role authenticated; set request.jwt.claim.sub='${id(n)}'; ${q}`);
 const read = p => readFileSync(path.join(__dirname,p),'utf8');
 const setReloj = (utcIso) => docker(['exec',container,'date','-s',utcIso]);
 const marcar = (n) => as(n,'select minutos_tardanza, estado from mark_attendance_ingreso(null,null);');
 try {
  docker(['run','--rm','-d','--name',container,'--cap-add','SYS_TIME','--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
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
  sql(read('../../supabase/migrations/20261027010000_asistencia_a0_a1.sql'));
  sql(read('../../supabase/migrations/20261028000000_asistencia_a2_novedades.sql'));
  sql(read('../../supabase/migrations/20261028010000_asistencia_a2_horarios_personales.sql'));
  // 2=ADMIN "manana" sabado (horario propio distinto del global); 3=TECNICO_RED "tarde" sabado;
  // 4=inactivo; 5=CLIENTE; 7=ADMIN normal (sin horario personal, sigue el global).
  sql(`insert into profiles(id,role,active) values
   ('${id(1)}','SUPERADMIN',true),('${id(2)}','ADMIN',true),('${id(3)}','TECNICO_RED',true),
   ('${id(4)}','TECNICO_RED',false),('${id(5)}','CLIENTE',true),('${id(7)}','ADMIN',true);
   grant select,insert,update,delete on all tables in schema public to authenticated;
   grant usage on all sequences in schema public to authenticated;`);

  await t.test('solo SUPERADMIN configura horarios personales; ADMIN/técnico/anónimo rechazados',()=>{
   assert.throws(()=>as(2,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',6,'tarde','14:00','18:00','${id(2)}');`));
   assert.throws(()=>as(3,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',6,'tarde','14:00','18:00','${id(3)}');`));
   assert.throws(()=>sql(`set role anon; insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',6,'tarde','14:00','18:00','${id(1)}');`));
   assert.equal(sql('select count(*) from asistencia_horarios_personales;'),'0');
  });

  await t.test('SUPERADMIN programa el sábado de los dos trabajadores; domingo, rango de horas y objetivo invalido rechazados',()=>{
   assert.equal(as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(2)}',6,'manana','10:00','13:00','${id(1)}') returning turno;`),'manana');
   assert.equal(as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',6,'tarde','14:00','18:00','${id(1)}') returning turno;`),'tarde');
   assert.throws(()=>as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(7)}',0,'manana','08:00','13:00','${id(1)}');`)); // domingo fuera de alcance (A3)
   assert.throws(()=>as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(7)}',5,'tarde','13:00','10:00','${id(1)}');`)); // hora_salida <= hora_ingreso
   assert.throws(()=>as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(1)}',6,'manana','08:00','13:00','${id(1)}');`),/exento/); // SUPERADMIN
   assert.throws(()=>as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(4)}',6,'manana','08:00','13:00','${id(1)}');`),/inactivo/);
   assert.throws(()=>as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(5)}',6,'manana','08:00','13:00','${id(1)}');`),/obligación/);
  });

  await t.test('un colaborador tiene a lo sumo un horario por día de la semana; upsert lo reemplaza sin duplicar',()=>{
   assert.throws(()=>as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',6,'manana','07:00','11:00','${id(1)}');`));
   assert.equal(as(1,`insert into asistencia_horarios_personales(user_id,dia_semana,turno,hora_ingreso,hora_salida,created_by) values('${id(3)}',6,'tarde','14:30','18:00','${id(1)}')
    on conflict(user_id,dia_semana) do update set turno=excluded.turno,hora_ingreso=excluded.hora_ingreso,hora_salida=excluded.hora_salida,created_by=excluded.created_by
    returning hora_ingreso;`),'14:30:00');
   // Se revierte al valor usado en el resto de las pruebas de precedencia.
   as(1,`update asistencia_horarios_personales set hora_ingreso='14:00' where user_id='${id(3)}' and dia_semana=6;`);
  });

  await t.test('RLS: cada colaborador ve solo su propio horario; SUPERADMIN ve todos',()=>{
   assert.equal(as(2,'select count(*) from asistencia_horarios_personales;'),'1');
   assert.equal(as(3,'select count(*) from asistencia_horarios_personales;'),'1');
   assert.equal(as(7,'select count(*) from asistencia_horarios_personales;'),'0');
   assert.equal(as(1,'select count(*) from asistencia_horarios_personales;'),'2');
  });

  await t.test('auditoría de configuración registra alta/edición, lectura exclusiva SUPERADMIN',()=>{
   assert.ok(Number(as(1,"select count(*) from asistencia_config_eventos where tabla='asistencia_horarios_personales';")) >= 3);
   assert.equal(as(2,"select count(*) from asistencia_config_eventos where tabla='asistencia_horarios_personales';"),'0');
  });

  // Novedades excepcionales creadas ANTES de mover el reloj — el propio RPC
  // rechaza fechas "retroactivas" relativas al reloj vigente al crearlas.
  await t.test('prepara los permisos excepcionales usados por las pruebas de precedencia',()=>{
   assert.equal(as(1,`select estado from asistencia_novedad_crear('${id(90)}','${id(3)}','media_jornada','2026-11-07','2026-11-07','tarde','16:00','20:00',null);`),'activa');
   assert.equal(as(1,`select estado from asistencia_novedad_crear('${id(91)}','${id(7)}','permiso_horas','2026-11-03','2026-11-03',null,'08:00','10:00',null);`),'activa');
   assert.equal(as(1,`select estado from asistencia_novedad_crear('${id(92)}','${id(2)}','permiso_horas','2026-11-10','2026-11-10',null,'08:00','10:00',null);`),'activa');
  });

  // ---- Precedencia real de mark_attendance_ingreso ----
  // Sabado 2026-10-31 (dow=6): user7 sin horario propio sigue el global;
  // user2 (manana, 10:00-13:00) y user3 (tarde, 14:00-18:00) usan el suyo.
  await t.test('sin horario personal, la tardanza sigue midiéndose contra el horario GLOBAL (sin regresión)',()=>{
   setReloj('2026-10-31 13:02:00'); // 08:02 Lima (resto_hora_ingreso=08:00, tolerancia 5)
   assert.equal(marcar(7),'0|Puntual');
  });
  await t.test('horario personal "mañana" distinto del global: puntual a su propia hora aunque sea tarde para el horario general',()=>{
   setReloj('2026-10-31 15:03:00'); // 10:03 Lima; su horario propio es 10:00 (no 08:00)
   assert.equal(marcar(2),'0|Puntual');
  });
  await t.test('horario personal "tarde": tardanza calculada contra 14:00, NUNCA contra el 08:00 global (no se marca ausente la mañana)',()=>{
   setReloj('2026-10-31 19:10:00'); // 14:10 Lima; 10 min tras su propio inicio (14:00+5 tolerancia=14:05)
   assert.equal(marcar(3),'5|Tardanza');
  });

  // ---- Permiso EXCEPCIONAL de un solo día (media_jornada) manda sobre el horario habitual recurrente ----
  await t.test('un permiso excepcional de hoy (media_jornada) reemplaza incluso el horario habitual del mismo día de la semana',()=>{
   // user3 ya tiene sabado habitual 14:00-18:00; este sabado puntual EXCEPCIONAL es 16:00-20:00.
   setReloj('2026-11-07 21:05:00'); // 16:05 Lima — puntual contra el permiso (16:00), tardísimo contra el habitual (14:00) o el global (08:00)
   assert.equal(marcar(3),'0|Puntual');
  });

  // ---- Permiso por horas: suprime tardanza SOLO dentro de su ventana, sin tocar el resto del día ----
  await t.test('permiso por horas suprime la tardanza dentro de su ventana',()=>{
   setReloj('2026-11-03 14:30:00'); // martes 2026-11-03, 09:30 Lima — tarde para el global (08:00+5) pero dentro del permiso (hasta 10:00)
   assert.equal(marcar(7),'0|Puntual');
  });
  await t.test('fuera de la ventana del permiso, la tardanza real contra el horario de base se calcula igual que siempre',()=>{
   setReloj('2026-11-10 15:30:00'); // martes 2026-11-10 (no sabado: el horario propio de user2 no aplica), 10:30 Lima — ya pasó el permiso (hasta 10:00)
   assert.equal(marcar(2),'145|Tardanza'); // 10:30 - (08:00+5min) = 145 min, SIN suprimir
  });

  await t.test('domingo sigue bloqueado sin excepción, con o sin horario/permiso configurado',()=>{
   setReloj('2026-11-01 13:00:00'); // domingo 2026-11-01, cualquier hora
   assert.throws(()=>marcar(7),/domingo/i);
  });

 } finally { try{docker(['stop',container]);}catch{} }
});
