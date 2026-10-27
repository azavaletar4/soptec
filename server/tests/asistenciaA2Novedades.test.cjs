const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('A2 PostgreSQL aislado: novedades (vacaciones/descanso/permiso/media jornada)', { timeout: 60000 }, async t => {
 const container = `attendance-a2-${process.pid}-${Date.now()}`;
 const docker = (args, input) => execFileSync('docker', args, { input, encoding:'utf8', windowsHide:true, stdio:['pipe','pipe','pipe'] }).trim();
 const args = ['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'];
 const sql = q => docker(args,q);
 const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const as = (n,q) => sql(`set role authenticated; set request.jwt.claim.sub='${id(n)}'; ${q}`);
 const read = p => readFileSync(path.join(__dirname,p),'utf8');
 const today = `(now() at time zone 'America/Lima')::date`;
 // SUPERADMIN=1, ADMIN=2, TECNICO_RED=3, TECNICO_RED inactivo=4, CLIENTE=5, ADMIN=7
 const crear = (op, user, tipo, desde, hasta, turno='null', hi='null', hf='null', motivo='null') =>
  `select estado from asistencia_novedad_crear('${id(op)}','${id(user)}','${tipo}',${desde},${hasta},${turno},${hi},${hf},${motivo});`;
 const cancelar = (novedadId, version, motivo="'revisado'") => `select estado from asistencia_novedad_cancelar('${id(novedadId)}',${version},${motivo});`;
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
  sql(read('../../supabase/migrations/20261027010000_asistencia_a0_a1.sql'));
  sql(read('../../supabase/migrations/20261028000000_asistencia_a2_novedades.sql'));
  sql(`insert into profiles(id,role,active) values
   ('${id(1)}','SUPERADMIN',true),('${id(2)}','ADMIN',true),('${id(3)}','TECNICO_RED',true),
   ('${id(4)}','TECNICO_RED',false),('${id(5)}','CLIENTE',true),('${id(7)}','ADMIN',true);
   grant select,insert,update,delete on all tables in schema public to authenticated;
   grant usage on all sequences in schema public to authenticated;`);

  await t.test('solo SUPERADMIN crea novedades; ADMIN/técnico y anónimo son rechazados',()=>{
   assert.throws(()=>as(2,crear(100,3,'vacaciones',`${today}+5`,`${today}+9`)));
   assert.throws(()=>as(3,crear(101,3,'vacaciones',`${today}+5`,`${today}+9`)));
   assert.throws(()=>sql(`set role anon; ${crear(102,3,'vacaciones',`${today}+5`,`${today}+9`)}`));
   assert.equal(sql('select count(*) from asistencia_novedades;'),'0');
  });

  await t.test('SUPERADMIN programa vacaciones por rango; rechaza SUPERADMIN, inactivo, cliente y rol no obligado como objetivo',()=>{
   assert.equal(as(1,crear(1,3,'vacaciones',`${today}+5`,`${today}+9`)),'activa');
   assert.throws(()=>as(1,crear(2,1,'vacaciones',`${today}+5`,`${today}+9`)),/exento/);
   assert.throws(()=>as(1,crear(3,4,'vacaciones',`${today}+20`,`${today}+21`)),/inactivo/);
   assert.throws(()=>as(1,crear(4,5,'vacaciones',`${today}+20`,`${today}+21`)),/obligación/);
  });

  await t.test('no se programan novedades retroactivas',()=>{
   assert.throws(()=>as(1,crear(5,2,'descanso_programado',`${today}-1`,`${today}`)),/pasadas/);
  });

  await t.test('medias jornadas y permisos por horas exigen un solo día y campos consistentes',()=>{
   assert.equal(as(1,crear(6,2,'media_jornada',`${today}+1`,`${today}+1`,"'manana'")),'activa');
   assert.throws(()=>as(1,crear(7,2,'media_jornada',`${today}+2`,`${today}+3`,"'manana'")));
   assert.throws(()=>as(1,crear(8,7,'media_jornada',`${today}+2`,`${today}+2`)));
   assert.equal(as(1,crear(9,7,'permiso_horas',`${today}+2`,`${today}+2`,'null',"'09:00'","'11:00'")),'activa');
   assert.throws(()=>as(1,crear(10,7,'permiso_horas',`${today}+3`,`${today}+3`,'null',"'11:00'","'09:00'")));
   assert.throws(()=>as(1,crear(11,7,'permiso_horas',`${today}+3`,`${today}+4`,'null',"'09:00'","'11:00'")));
  });

  await t.test('no se permiten novedades activas solapadas por colaborador',()=>{
   assert.throws(()=>as(1,crear(20,3,'descanso_programado',`${today}+7`,`${today}+7`)),/superpone/);
   assert.equal(as(1,crear(21,3,'descanso_programado',`${today}+10`,`${today}+10`)),'activa');
  });

  await t.test('idempotencia por operación: mismo UUID repite resultado, datos distintos se rechazan',()=>{
   assert.equal(as(1,crear(1,3,'vacaciones',`${today}+5`,`${today}+9`)),'activa');
   assert.throws(()=>as(1,crear(1,3,'vacaciones',`${today}+5`,`${today}+10`)),/reutilizada/);
  });

  await t.test('ADMIN/técnico consultan solo sus propias novedades; SUPERADMIN ve todas',()=>{
   assert.equal(as(3,'select count(*) from asistencia_novedades;'),'2'); // vacaciones id1 + descanso id21
   assert.equal(as(2,'select count(*) from asistencia_novedades;'),'1'); // media_jornada id6
   assert.equal(as(7,'select count(*) from asistencia_novedades;'),'1'); // permiso_horas id9
   assert.equal(as(1,'select count(*) from asistencia_novedades;'),'4'); // id1+id6+id9+id21
  });

  await t.test('RLS impide insertar directo; una actualización directa sin RPC no puede dejar estado y auditoría consistentes',()=>{
   assert.throws(()=>as(1,`insert into asistencia_novedades(id,user_id,tipo,fecha_inicio,fecha_fin,created_by) values('${id(99)}','${id(3)}','vacaciones',${today}+30,${today}+31,'${id(1)}');`));
   assert.equal(sql(`select count(*) from asistencia_novedades where id='${id(99)}';`),'0');
   // Sin una política de UPDATE, RLS no habilita ninguna fila para escritura
   // directa — el UPDATE sin RPC no toca ninguna fila (ni error ni cambio).
   as(1,"update asistencia_novedades set estado='cancelada';");
   assert.equal(sql(`select count(*) from asistencia_novedades where estado='cancelada';`),'0');
  });

  await t.test('resumen multiusuario expande por día, sin exponer motivo, y exige rol SUPERADMIN/ADMIN',()=>{
   const rows = JSON.parse(as(2,`select json_agg(r) from asistencia_novedades_resumen(${today},${today}+9) r where r.user_id='${id(3)}';`));
   assert.equal(rows.length, 5); // id1: +5..+9 (5 días)
   assert.deepEqual(Object.keys(rows[0]).sort(), ['fecha','hora_fin','hora_inicio','tipo','turno','user_id']);
   assert.throws(()=>as(3,`select * from asistencia_novedades_resumen(${today},${today}+9);`));
  });

  await t.test('cancelación: solo SUPERADMIN, exige motivo, versión vigente y nunca sobre una novedad ya concluida',()=>{
   const activa = JSON.parse(as(1,`select row_to_json(n) from asistencia_novedades n where n.id='${id(6)}';`));
   assert.throws(()=>as(2,cancelar(6,1)));
   assert.throws(()=>as(1,cancelar(6,1,'null')));
   assert.equal(as(1,cancelar(6,activa.version)),'cancelada');
   assert.throws(()=>as(1,cancelar(6,activa.version)),/cambió/);
   sql(`set request.jwt.claim.sub='${id(1)}'; insert into asistencia_novedades(id,user_id,tipo,fecha_inicio,fecha_fin,created_by) values('${id(50)}','${id(3)}','descanso_programado',${today}-5,${today}-3,'${id(1)}');`);
   assert.throws(()=>as(1,cancelar(50,1)),/concluida/);
  });

  await t.test('auditoría de configuración registra creación/cancelación, lectura exclusiva SUPERADMIN',()=>{
   // 4 creaciones (id1,id6,id9,id21) + 1 cancelación (id6) + 1 fixture histórica (id50) = 6.
   assert.equal(as(1,"select count(*) from asistencia_config_eventos where tabla='asistencia_novedades';"),'6');
   assert.equal(as(2,"select count(*) from asistencia_config_eventos where tabla='asistencia_novedades';"),'0');
  });

  await t.test('creación concurrente sobre el mismo rango: una sola novedad activa prevalece',async()=>{
   const run=q=>new Promise(resolve=>{const p=spawn('docker',args,{windowsHide:true});let err='';p.stderr.on('data',b=>err+=b);p.on('close',code=>resolve({code,err}));p.stdin.end(q);});
   const header=`set role authenticated;set request.jwt.claim.sub='${id(1)}';`;
   const rango=[`${today}+40`,`${today}+41`];
   const results=await Promise.all([
    run(header+crear(200,2,'vacaciones',rango[0],rango[1])),
    run(header+crear(201,2,'vacaciones',rango[0],rango[1])),
   ]);
   assert.equal(results.filter(r=>r.code===0).length,1);
  });

 } finally { try{docker(['stop',container]);}catch{} }
});
