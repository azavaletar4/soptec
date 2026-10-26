import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const root='00000000-0000-0000-0000-000000000001',admin='00000000-0000-0000-0000-000000000002';
const tech='00000000-0000-0000-0000-000000000003',support='00000000-0000-0000-0000-000000000004';
const helper='00000000-0000-0000-0000-000000000007',inactive='00000000-0000-0000-0000-000000000008';
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";

test('Prospectos: cero solo con origen servidor, conversión atómica e idempotente',{timeout:180000},async t=>{
 const name='rayco-prospect-points-'+process.pid+'-'+Date.now();let started=false;
 const docker=(a:string[],input?:string)=>execFileSync('docker',a,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const args=['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1'];
 const sql=(s:string,db='postgres')=>docker([...args,'-d',db],s).trim();
 const as=(s:string,actor=admin,role='authenticated',db='postgres')=>sql(`set role ${role};set request.jwt.claim.sub='${actor}';${s}`,db);
 const data=(doc:string)=>({document_type:'cedula',document_number:doc,first_name:'Persona ficticia',last_name:'Laboratorio',phone:'000000',status:'prospect'});
 const call=(p:string,doc:string,extra:Record<string,unknown>={},ref='null')=>`select convert_prospect_with_installation('${p}',${quote(JSON.stringify({...data(doc),...extra}))}::jsonb,${ref});`;
 const convert=(p:string,doc:string,actor=admin)=>JSON.parse(as(call(p,doc),actor));
 const prospect=()=>sql("insert into prospects(full_name,phone,plan_interes_id,zone_id) values('Prospecto ficticio','000000','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002') returning id;");
 const counts=()=>sql("select jsonb_build_array((select count(*) from clients),(select count(*) from service_contracts),(select count(*) from installations),(select count(*) from prospect_conversion_receipts));");
 const concurrent=(s:string)=>new Promise<string>((resolve,reject)=>{const p=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));p.stdin.end(`set role authenticated;set request.jwt.claim.sub='${admin}';${s}`);});
 try{
  docker(['run','-d','--pull=never','--name',name,'--network','none','--memory','768m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);started=true;
  for(let i=0;i<100;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{}await new Promise(r=>setTimeout(r,150));}
  sql(file('./jobWorkSessionsSchema.sql'));
  sql(`alter table profiles add column full_name text,add column email text;
   insert into profiles values('${helper}','TECNICO_RED',true,'Ayudante ficticio','helper@example.invalid'),('${inactive}','ADMIN',false,'Inactivo','inactive@example.invalid');
   create type document_type as enum('cedula','ruc','pasaporte');create type client_status as enum('prospect','active','suspended','retired');
   create type prospect_estado as enum('interesado','por_contactar','en_negociacion','no_interesado','convertido');
   create table zones(id uuid primary key);insert into zones values('90000000-0000-0000-0000-000000000002');
   create table plans(id uuid primary key,price numeric not null,is_active boolean default true,deleted_at timestamptz);
   insert into plans values('90000000-0000-0000-0000-000000000001',78.50,true,null);
   create table clients(id uuid primary key default gen_random_uuid(),document_type document_type,document_number text unique not null,first_name text,last_name text,phone text,phone_2 text,email text,address text,status client_status default 'prospect');
   create table service_contracts(id uuid primary key default gen_random_uuid(),client_id uuid references clients,plan_id uuid references plans,monthly_fee numeric,installation_address text,zone_id uuid references zones,status text default 'active');
   create table prospects(id uuid primary key default gen_random_uuid(),full_name text not null,phone text not null,plan_interes_id uuid references plans,zone_id uuid references zones,estado prospect_estado default 'por_contactar',converted_client_id uuid references clients,updated_by uuid references profiles);
   create table referidos(referente_client_id uuid references clients,referido_client_id uuid unique references clients,monto_descuento numeric default 25,estado text default 'pendiente');
   alter table tickets add column points integer,add column category text default 'no_service',add column client_id uuid,add column created_at timestamptz default now(),add column resolved_at timestamptz,add column closed_at timestamptz,add column imputable_a_tecnico boolean default false;
   alter table installations add column client_id uuid references clients,add column contract_id uuid references service_contracts,add column created_at timestamptz default now(),add column completed_at timestamptz;
   alter table routines add column points numeric,add column completed_at timestamptz,add column created_at timestamptz default now();
   insert into installations(id,status,created_at,completed_at) values('80000000-0000-0000-0000-000000000099','completed','2026-10-01 15:00Z','2026-10-02 15:00Z');
   grant all on all tables in schema public to authenticated,service_role;`);
  sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
  for(const p of ['./workOrderPointsContributionBaseline.sql','./pointConfirmationRankingBaseline.sql','./workOrderPointsDefaultPrivileges.sql','../../supabase/migrations/20261024180000_work_order_points.sql','../../supabase/migrations/20261024190000_field_order_points_readonly.sql','../../supabase/migrations/20261024200000_work_order_point_confirmations.sql'])sql(file(p));
  const historical=sql("select to_jsonb(t) from installations t where id='80000000-0000-0000-0000-000000000099';");
  sql(file('../../supabase/migrations/20261024210000_prospect_conversion_initial_points.sql'));
  await t.test('históricos intactos; cero/null/negativo directos siguen rechazados en los tres tipos',()=>{
   assert.equal(sql("select to_jsonb(t) from installations t where id='80000000-0000-0000-0000-000000000099';"),historical);
   for(const table of ['tickets','installations','routines']){for(const points of ['0','null','-1'])assert.throws(()=>as(`insert into ${table}(points) values(${points});`),/puntos|Cero/);as(`insert into ${table}(points) values(6);`);}
  });
  await t.test('conversión comercial acreditada por backend: 0, plan/fee origen y recibo; reintento mismo resultado',()=>{
   const p=prospect(),r=convert(p,'PC-BASE',support),before=counts();assert.equal(r.initial_points,0);assert.equal(r.replayed,false);assert.equal(sql(`select points from installations where id='${r.installation_id}'`),'0');
   assert.equal(sql(`select monthly_fee from service_contracts where id='${r.contract_id}'`),'78.50');
   assert.equal(sql(`select estado||'|'||converted_client_id from prospects where id='${p}';`),'convertido|'+r.client_id);
   const repeated=convert(p,'PC-BASE',admin);assert.equal(repeated.replayed,true);assert.equal(repeated.installation_id,r.installation_id);assert.equal(counts(),before);
   assert.throws(()=>as(call(p,'PC-OTHER')),/otros datos/);assert.equal(counts(),before);
   const referred=JSON.parse(as(call(prospect(),'PC-REFERRED',{},quote(r.client_id))));assert.equal(sql(`select monto_descuento||'|'||estado from referidos where referido_client_id='${referred.client_id}'`),'25|pendiente');
  });
  await t.test('identidad, origen y recibo no falsificables desde anon/técnico/inactivo/service_role',()=>{
   const p=prospect(),before=counts();for(const actor of [tech,helper,inactive])assert.throws(()=>as(call(p,'PC-ROLE'),actor),/personal comercial activo/);
   for(const role of ['anon','service_role'])assert.throws(()=>as(call(p,'PC-ROLE'),admin,role),/permission denied/);
   for(const key of ['points','prospect_id','monthly_fee','created_at'])assert.throws(()=>as(call(p,'PC-FORGE',{[key]:key==='points'?0:'forged'})),/Campos no permitidos/);
   assert.throws(()=>as(`insert into prospect_conversion_receipts(prospect_id) values('${p}');`),/permission denied/);
   assert.throws(()=>as(`insert into prospect_conversion_receipts(prospect_id) values('${p}');`,admin,'service_role'),/permission denied/);
   const real=convert(p,'PC-ORIGIN');assert.throws(()=>as(`insert into installations(client_id,contract_id,points) values('${real.client_id}','${real.contract_id}',0);`),/Cero puntos/);
   assert.throws(()=>as(`update installations set points=0 where id='80000000-0000-0000-0000-000000000099';`),/Cero puntos/);
   assert.throws(()=>as(`update installations set contract_id=null where id='${real.installation_id}';`),/Cero puntos/);
   assert.notEqual(counts(),before);
  });
  await t.test('fallo tardío revierte cliente/contrato/Alta/recibo/estado; reintento puede completar',()=>{
   const p=prospect(),before=counts();assert.throws(()=>as(call(p,'PC-ROLLBACK',{},"'ffffffff-ffff-ffff-ffff-ffffffffffff'")),/foreign key/);assert.equal(counts(),before);assert.equal(sql(`select estado from prospects where id='${p}'`),'por_contactar');
   const r=convert(p,'PC-ROLLBACK');assert.equal(r.initial_points,0);
  });
  await t.test('concurrencia del mismo Prospecto crea un solo conjunto y devuelve mismos IDs',async()=>{
   sql("create function lab_slow_receipt() returns trigger language plpgsql as $$begin perform pg_sleep(0.3);return new;end$$;create trigger lab_slow after insert on prospect_conversion_receipts for each row execute function lab_slow_receipt();");
   const p=prospect();const replies=await Promise.all([concurrent(call(p,'PC-RACE')),concurrent(call(p,'PC-RACE'))]);const a=JSON.parse(replies[0]),b=JSON.parse(replies[1]);assert.equal(a.client_id,b.client_id);assert.equal(a.contract_id,b.contract_id);assert.equal(a.installation_id,b.installation_id);
   assert.equal(sql("select count(*) from clients where document_number='PC-RACE'"),'1');assert.equal(sql(`select count(*) from prospect_conversion_receipts where prospect_id='${p}'`),'1');
  });
  await t.test('dos Prospectos con mismo documento: un éxito, otro sin conversión parcial',async()=>{
   const p1=prospect(),p2=prospect();const replies=await Promise.allSettled([concurrent(call(p1,'PC-SAME-DOC')),concurrent(call(p2,'pc-same-doc'))]);assert.equal(replies.filter(r=>r.status==='fulfilled').length,1);assert.equal(sql("select count(*) from clients where lower(document_number)='pc-same-doc'"),'1');assert.equal(sql(`select count(*) from prospect_conversion_receipts where prospect_id in('${p1}','${p2}')`),'1');
   const before=counts();sql("insert into clients(document_number,first_name,last_name) values(' Existing-Doc ','Previo','Ficticio');");const p3=prospect();assert.throws(()=>as(call(p3,'existing-doc')),/Ya existe un cliente/);assert.equal(sql("select count(*) from clients where lower(btrim(document_number))='existing-doc'"),'1');assert.equal(sql(`select count(*) from prospect_conversion_receipts where prospect_id='${p3}'`),'0');assert.notEqual(counts(),before);
  });
  await t.test('cero no confirma; ADMIN asigna >0 en octubre con auditoría; reparto y bloqueo final intactos',()=>{
   const p=prospect(),r=convert(p,'PC-CONFIRM');const id=r.installation_id;
   sql(`insert into job_assignees values('installation','${id}','${tech}','leader'),('installation','${id}','${helper}','support');update installations set status='completed',created_at='2026-10-25 15:00Z',completed_at='2026-10-25 16:00Z' where id='${id}';`);
   const read=()=>JSON.parse(as(`select work_order_point_review('installation','${id}');`));let review=read();assert.equal(review.historical,true);assert.equal(review.prospectPointsPending,true);
   assert.throws(()=>as(`select confirm_work_order_points('installation','${id}',0,'${review.token}','No',true);`),/Puntos inválidos/);
   for(const actor of [tech,helper,support,inactive])assert.throws(()=>as(`select adjust_work_order_points('installation','${id}',12,0,'asignar');`,actor),/ADMIN/);
   as(`select adjust_work_order_points('installation','${id}',12,0,'Asignar puntos antes de confirmar');`);assert.equal(sql(`select old_points||'|'||new_points from work_order_point_changes where job_id='${id}'`),'0|12');
   assert.throws(()=>as(`update installations set points=0 where id='${id}';`),/solo pueden ser cero/);
   review=read();assert.equal(review.prospectPointsPending,false);const confirm=`select confirm_work_order_points('installation','${id}',12,'${review.token}','Confirmar',true);`;const first=JSON.parse(as(confirm));assert.equal(JSON.parse(as(confirm,root)).id,first.id);assert.deepEqual(first.crew.map((c:{points:number})=>c.points),[6,6]);
   assert.equal(sql(`select count(*) from work_order_point_changes where job_id='${id}'`),'1');
   for(const s of [`update installations set status='pending' where id='${id}';`,`delete from installations where id='${id}';`,`delete from job_assignees where job_id='${id}';`,`select adjust_work_order_points('installation','${id}',14,12,'Tardío');`])assert.throws(()=>as(s,root),/Cierre administrativo definitivo/);
   assert.equal(sql("select count(*) from technician_point_contributions('2026-11-01 05:00Z','2026-12-01 05:00Z');"),'0');
  });
  await t.test('confirmación positiva desde cero puede asignar/auditar/cerrar en una sola llamada SUPERADMIN',()=>{
   const p=prospect(),r=convert(p,'PC-ASSIGN-CONFIRM');sql(`insert into job_assignees values('installation','${r.installation_id}','${tech}','leader');update installations set status='completed',completed_at=now() where id='${r.installation_id}';`);
   const review=JSON.parse(as(`select work_order_point_review('installation','${r.installation_id}');`,root));const c=JSON.parse(as(`select confirm_work_order_points('installation','${r.installation_id}',9,'${review.token}','Asignar y confirmar',true);`,root));assert.equal(c.points,9);assert.equal(sql(`select count(*) from work_order_point_changes where job_id='${r.installation_id}'`),'1');
  });
  await t.test('recuperación del recibo conserva idempotencia, origen privado y asignación posterior',()=>{
   const p=prospect(),r=convert(p,'PC-RECOVERY');const receipts=sql('select jsonb_agg(to_jsonb(r) order by prospect_id) from prospect_conversion_receipts r;');
   docker(['exec',name,'pg_dump','-h','127.0.0.1','-U','postgres','-Fc','-f','/tmp/prospect-recovery.dump','postgres']);
   docker(['exec',name,'createdb','-h','127.0.0.1','-U','postgres','-T','template0','prospect_recovered']);
   docker(['exec',name,'pg_restore','-h','127.0.0.1','-U','postgres','--exit-on-error','--single-transaction','-d','prospect_recovered','/tmp/prospect-recovery.dump']);
   assert.equal(sql('select jsonb_agg(to_jsonb(r) order by prospect_id) from prospect_conversion_receipts r;','prospect_recovered'),receipts);
   const replay=JSON.parse(as(call(p,'PC-RECOVERY'),admin,'authenticated','prospect_recovered'));assert.equal(replay.replayed,true);assert.equal(replay.installation_id,r.installation_id);
   assert.equal(sql(`select points from installations where id='${r.installation_id}';`,'prospect_recovered'),'0');
   assert.equal(sql("select has_table_privilege('authenticated','prospect_conversion_receipts','INSERT');",'prospect_recovered'),'f');
   as(`select adjust_work_order_points('installation','${r.installation_id}',8,0,'Asignación después de recuperación');`,admin,'authenticated','prospect_recovered');
   assert.equal(sql(`select old_points||'|'||new_points from work_order_point_changes where job_id='${r.installation_id}';`,'prospect_recovered'),'0|8');
  });
  assert.equal(sql("select to_jsonb(t) from installations t where id='80000000-0000-0000-0000-000000000099';"),historical);
 }finally{if(started)docker(['stop',name]);}
});
