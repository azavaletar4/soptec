const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('A0/A1 PostgreSQL aislado: permisos, historial, duplicados, auditoría y concurrencia', { timeout: 60000 }, async t => {
 const container = `attendance-a0-a1-${process.pid}-${Date.now()}`;
 const docker = (args, input) => execFileSync('docker', args, { input, encoding:'utf8', windowsHide:true, stdio:['pipe','pipe','pipe'] }).trim();
 const args = ['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
 const sql = q => docker(args,q);
 const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const as = (n,q) => sql(`set role authenticated; set request.jwt.claim.sub='${id(n)}'; ${q}`);
 const read = p => readFileSync(path.join(__dirname,p),'utf8');
 const today = `(now() at time zone 'America/Lima')::date`;
 const report = (op, reason='salud', date=today) => `select estado from reportar_ausencia_hoy('${id(op)}',${date},'${reason}',null);`;
 const resolve = (op, decision='aprobada', version=1) => `select estado from resolver_ausencia('${id(op)}',${version},'${decision}','revisado');`;
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
  sql(`insert into profiles(id,role,active) values('${id(1)}','SUPERADMIN',true),('${id(2)}','ADMIN',true),('${id(3)}','TECNICO_RED',true),('${id(4)}','TECNICO_RED',false),('${id(5)}','CLIENTE',true),('${id(6)}','TECNICO_RED',true),('${id(7)}','ADMIN',true);
   insert into asistencia_registros(user_id,fecha,hora_ingreso,estado,minutos_tardanza,inicio_almuerzo) values
   ('${id(3)}',${today}-2,now()-interval '2 days','Puntual',0,null),
   ('${id(1)}',${today}-2,now()-interval '2 days','Tardanza',60,null),
   ('${id(1)}',${today},now()-interval '2 hours','Tardanza',60,now()-interval '1 hour');
   grant select,insert,update,delete on all tables in schema public to authenticated;
   grant usage on all sequences in schema public to authenticated;`);
  const history = `select json_agg(r order by r.id)::text from asistencia_registros r where fecha<${today};`;
  const snapshot = sql(history);
  const superSnapshot = sql(`select json_agg(r order by r.id)::text from asistencia_registros r where user_id='${id(1)}';`);
  sql(read('../../supabase/migrations/20261027010000_asistencia_a0_a1.sql'));
  await t.test('migración conserva íntegras marcaciones históricas, incluyendo SUPERADMIN con tardanza previa',()=>{
   assert.equal(sql(history),snapshot);
   assert.equal(sql(`select json_agg(r order by r.id)::text from asistencia_registros r where user_id='${id(1)}';`),superSnapshot);
  });
  await t.test('ADMIN lee configuración pero no puede modificarla ni crear feriados',()=>{
   assert.equal(as(2,'select count(*) from company_settings;'),'1');
   as(2,'update company_settings set tolerancia_min=99;');
   assert.equal(sql('select tolerancia_min from company_settings;'),'5');
   assert.throws(()=>as(2,`insert into feriados(fecha,nombre) values(${today}+1,'No autorizado');`));
  });
  await t.test('SUPERADMIN configura y no modifica feriados históricos',()=>{
   as(1,'update company_settings set tolerancia_min=6;');assert.equal(sql('select tolerancia_min from company_settings;'),'6');
   as(1,`insert into feriados(fecha,nombre) values(${today}+1,'Futuro');`);
   assert.throws(()=>as(1,`insert into feriados(fecha,nombre) values(${today}-1,'Pasado');`));
   assert.equal(as(1,'select count(*) from asistencia_config_eventos;'),'2');
   assert.equal(as(2,'select count(*) from asistencia_config_eventos;'),'0');
  });
  await t.test('ADMIN y técnico reportan ausencia propia pendiente sin marcar',()=>{
   assert.equal(as(2,report(20)),'pendiente');assert.equal(as(3,report(30)),'pendiente');
   assert.equal(sql(`select count(*) from asistencia_registros where fecha=${today} and user_id<>'${id(1)}';`),'0');
   assert.equal(sql('select count(*) from asistencia_solicitud_eventos;'),'2');
  });
  await t.test('idempotencia y rechazo de duplicados, payload distinto y fecha retroactiva',()=>{
   assert.equal(as(3,report(30)),'pendiente');
   assert.throws(()=>as(3,report(31)));assert.throws(()=>as(3,report(30,'otros')));
   assert.throws(()=>as(6,report(60,'salud',`${today}-1`)));
   assert.equal(sql('select count(*) from asistencia_solicitud_eventos;'),'2');
  });
  await t.test('anónimo, inactivo y cliente no reportan; ADMIN/técnico no resuelven',()=>{
   assert.throws(()=>sql(`set role anon; ${report(80)}`));
   assert.throws(()=>as(4,report(40)));assert.throws(()=>as(5,report(50)));
   assert.throws(()=>as(2,resolve(20)));assert.throws(()=>as(3,resolve(30)));
  });
  await t.test('RLS impide escrituras directas y protege motivos ajenos',()=>{
   assert.throws(()=>as(3,`insert into asistencia_solicitudes(id,user_id,fecha,motivo) values('${id(32)}','${id(3)}',${today},'otros');`));
   assert.throws(()=>as(3,"update asistencia_solicitudes set estado='aprobada';"));
   assert.throws(()=>as(1,'delete from asistencia_solicitud_eventos;'));
   assert.equal(as(2,'select count(*) from asistencia_solicitudes;'),'1');
   assert.equal(as(2,`select count(*) from asistencia_ausencias_resumen(${today},${today});`),'2');
   assert.throws(()=>as(3,`select * from asistencia_ausencias_resumen(${today},${today});`));
  });
  await t.test('aprobación/rechazo atómicos y versión obsoleta rechazada',()=>{
   assert.equal(as(1,resolve(20)),'aprobada');assert.equal(as(1,resolve(30,'rechazada')),'rechazada');
   assert.throws(()=>as(1,resolve(30,'aprobada')));
   assert.equal(sql('select count(*) from asistencia_solicitud_eventos;'),'4');
   assert.equal(as(3,report(33)),'pendiente');
  });
  await t.test('decisiones concurrentes: una sola transición y un evento',async()=>{
   const run=q=>new Promise(resolve=>{const p=spawn('docker',args,{windowsHide:true});let err='';p.stderr.on('data',b=>err+=b);p.on('close',code=>resolve({code,err}));p.stdin.end(q);});
   const header=`set role authenticated;set request.jwt.claim.sub='${id(1)}';`;
   const results=await Promise.all([run(header+resolve(33)),run(header+resolve(33,'rechazada'))]);
   assert.equal(results.filter(r=>r.code===0).length,1);
   assert.equal(sql(`select count(*) from asistencia_solicitud_eventos where solicitud_id='${id(33)}';`),'2');
  });
  await t.test('privacidad de auditoría propia y restricciones de paginación',()=>{
   assert.equal(as(2,`select count(*) from asistencia_solicitud_eventos where solicitud_id='${id(30)}';`),'0');
   assert.throws(()=>as(2,`select * from asistencia_ausencias_resumen(${today}-63,${today});`));
   assert.throws(()=>as(2,`select * from asistencia_ausencias_resumen(${today},${today},${today},null);`));
  });
  await t.test('resumen paginado completo sin exponer motivos para 550 trabajadores ficticios',()=>{
   sql(`insert into profiles(id,role) select md5('attendance-fixture-'||n)::uuid,'TECNICO_RED' from generate_series(1,550)n;
    insert into asistencia_solicitudes(id,user_id,fecha,motivo) select md5('request-fixture-'||n)::uuid,md5('attendance-fixture-'||n)::uuid,${today},'salud' from generate_series(1,550)n;`);
   const first=JSON.parse(as(2,`select json_agg(r) from asistencia_ausencias_resumen(${today},${today}) r;`));
   assert.equal(first.length,500);
   assert.deepEqual(Object.keys(first[0]).sort(),['estado','fecha','user_id']);
   const last=first.at(-1);
   const next=JSON.parse(as(2,`select json_agg(r) from asistencia_ausencias_resumen(${today},${today},'${last.fecha}','${last.user_id}')r;`));
   assert.equal(new Set([...first,...next].map(r=>r.user_id)).size,552);
  });
  await t.test('historial protegido incluso ante DELETE en cascada',()=>{
   assert.throws(()=>sql(`update asistencia_registros set estado='Falta' where fecha<${today};`));
   assert.throws(()=>sql('delete from asistencia_registros;'));
   assert.throws(()=>sql(`delete from profiles where id='${id(3)}';`));
   assert.equal(sql(history),snapshot);
  });
  await t.test('validación de motivo/observación y fecha Perú aun con sesión en otro huso',()=>{
   assert.throws(()=>as(7,report(70,'no_permitido')));
   assert.throws(()=>as(7,`select * from reportar_ausencia_hoy('${id(70)}',${today},'salud',repeat('x',1001));`));
   assert.equal(as(7,`set timezone='Pacific/Tongatapu';${report(70)}`),'pendiente');
   assert.equal(as(7,`select fecha=${today} from asistencia_solicitudes where id='${id(70)}';`),'t');
  });
  await t.test('marcación real impide aprobar ausencia completa, conserva solicitud y marcas',()=>{
   assert.equal(as(6,report(60)),'pendiente');
   // Fixture de un ingreso real, no se invoca GPS ni servicios externos.
   sql(`set request.jwt.claim.sub='${id(6)}';insert into asistencia_registros(user_id,fecha,hora_ingreso) values('${id(6)}',${today},now());`);
   assert.throws(()=>as(1,resolve(60)));
   assert.equal(sql(`select estado from asistencia_solicitudes where id='${id(60)}';`),'pendiente');
   assert.equal(sql(`select count(*) from asistencia_registros where user_id='${id(6)}';`),'1');
  });
  await t.test('SUPERADMIN exento: no reporta ni modifica marcas por RPC; conserva lectura e historial',()=>{
   assert.throws(()=>as(1,report(10)),/No autorizado/);
   assert.equal(sql(`select count(*) from asistencia_solicitudes where user_id='${id(1)}';`),'0');
   // Solicitud previa ficticia: se conserva para auditoría, fuera del resumen laboral.
   sql(`insert into asistencia_solicitudes(id,user_id,fecha,motivo) values('${id(10)}','${id(1)}',${today},'salud');`);
   assert.throws(()=>as(1,'select * from mark_attendance_fin_almuerzo(null,null);'),/Marcación no autorizada/);
   assert.throws(()=>as(1,'select * from mark_attendance_salida(null,null);'),/Marcación no autorizada/);
   assert.equal(as(1,`select json_agg(r order by r.id)::text from asistencia_registros r where user_id='${id(1)}';`),superSnapshot);
   assert.equal(as(1,`select count(*) from asistencia_ausencias_resumen(${today},${today}) where user_id='${id(1)}';`),'0');
  });
  await t.test('ADMIN conserva RPC de marcación y técnico también',()=>{
   // Domingo/feriado podrían bloquear ingreso legítimamente: se comprueban
   // permisos y validación propia del RPC, no se altera el reloj del servidor.
   assert.equal(sql("select has_function_privilege('authenticated','mark_attendance_ingreso(numeric,numeric)','execute');"),'t');
   assert.equal(sql("select has_function_privilege('anon','mark_attendance_ingreso(numeric,numeric)','execute');"),'f');
   for(const n of [2,3,7]) { try { as(n,'select id from mark_attendance_ingreso(null,null);'); } catch(e) { assert.match(String(e.stderr),/domingo|feriado/i); } }
  });
 } finally { try{docker(['stop',container]);}catch{} }
});
