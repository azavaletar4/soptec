import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const file=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const admin='00000000-0000-0000-0000-000000000002',root='00000000-0000-0000-0000-000000000001';
const tech='00000000-0000-0000-0000-000000000003',helper='00000000-0000-0000-0000-000000000007';
const inactive='00000000-0000-0000-0000-000000000008';
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";

test('Ajuste pendiente: piloto tras terminación técnica, sin tocar históricos ni confirmaciones definitivas',{timeout:180000},async t=>{
 const container='rayco-pending-points-'+process.pid+'-'+Date.now();let started=false;
 const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const sql=(s:string)=>docker(['exec','-i',container,'psql','-h','127.0.0.1','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1'],s).trim();
 const as=(s:string,actor=admin,role='authenticated')=>sql(`set role ${role};set request.jwt.claim.sub='${actor}';${s}`);
 const read=(kind:string,id:string)=>JSON.parse(as(`select work_order_point_review('${kind}','${id}');`));
 const adjust=(kind:string,id:string,next=5,expected=2,reason="'Revisión del trabajo terminado'")=>`select adjust_work_order_points('${kind}','${id}',${next},${expected},${reason});`;
 const confirm=(kind:string,id:string,token:string,points=5,reason="''")=>`select confirm_work_order_points('${kind}','${id}',${points},'${token}',${reason},true);`;
 const order=(table:string,kind:string,time='2026-10-26 04:32:23Z',created='2026-10-26 04:29:03Z')=>{
  const id=sql(`insert into ${table}(points,status,assigned_to,created_at,${kind==='ticket'?'resolved_at':'completed_at'}) values(2,'${kind==='ticket'?'resolved':'completed'}','${tech}','${created}','${time}') returning id;`);
  sql(`insert into job_assignees values('${kind}','${id}','${tech}','leader'),('${kind}','${id}','${helper}','support');`);return id;
 };
 try{
  docker(['run','-d','--pull=never','--name',container,'--network','none','--memory','768m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);started=true;
  let ready=false;for(let n=0;n<80;n++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  sql(file('./jobWorkSessionsSchema.sql'));
  sql(`alter table profiles add column full_name text,add column email text;
   insert into profiles values('${helper}','TECNICO_RED',true,'Ayudante ficticio','helper@example.invalid'),('${inactive}','ADMIN',false,'Inactivo','inactive@example.invalid');
   create type document_type as enum('cedula','ruc','pasaporte');create type client_status as enum('prospect','active','suspended','retired');
   create type prospect_estado as enum('interesado','por_contactar','en_negociacion','no_interesado','convertido');
   create table zones(id uuid primary key);
   create table plans(id uuid primary key,price numeric not null,is_active boolean default true,deleted_at timestamptz);
   create table clients(id uuid primary key default gen_random_uuid(),document_type document_type,document_number text unique not null,first_name text,last_name text,phone text,phone_2 text,email text,address text,status client_status default 'prospect');
   create table service_contracts(id uuid primary key default gen_random_uuid(),client_id uuid references clients,plan_id uuid references plans,monthly_fee numeric,installation_address text,zone_id uuid references zones,status text default 'active');
   create table prospects(id uuid primary key default gen_random_uuid(),full_name text,phone text,plan_interes_id uuid references plans,zone_id uuid references zones,estado prospect_estado default 'por_contactar',converted_client_id uuid references clients,updated_by uuid references profiles);
   create table referidos(referente_client_id uuid references clients,referido_client_id uuid unique references clients,monto_descuento numeric default 25,estado text default 'pendiente');
   alter table tickets add column points integer,add column category text default 'no_service',add column client_id uuid,add column created_at timestamptz default now(),add column resolved_at timestamptz,add column closed_at timestamptz,add column imputable_a_tecnico boolean default false;
   alter table installations add column client_id uuid references clients,add column contract_id uuid references service_contracts,add column created_at timestamptz default now(),add column completed_at timestamptz;
   alter table routines add column points numeric,add column created_at timestamptz default now(),add column completed_at timestamptz;
   grant usage on schema auth to authenticated;`);
  sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
  sql(file('./workOrderPointsContributionBaseline.sql'));sql(file('./pointConfirmationRankingBaseline.sql'));sql(file('./workOrderPointsDefaultPrivileges.sql'));
  for(const name of ['20261024180000_work_order_points.sql','20261024190000_field_order_points_readonly.sql','20261024200000_work_order_point_confirmations.sql','20261024210000_prospect_conversion_initial_points.sql'])sql(file('../../supabase/migrations/'+name));
  const historic:Record<string,string>={};
  for(const [table,kind]of [['tickets','ticket'],['installations','installation'],['routines','routine']])historic[kind]=order(table,kind,'2026-10-12 15:00Z','2026-10-10 15:00Z');
  const alreadyFinal=order('tickets','ticket','2026-11-12 15:00Z','2026-11-11 15:00Z');
  const frozen=JSON.parse(as(confirm('ticket',alreadyFinal,read('ticket',alreadyFinal).token,2)));
  const frozenRow=sql(`select to_jsonb(c) from work_order_point_confirmations c where id='${frozen.id}';`);
  const beforeHistory=Object.entries(historic).map(([kind,id])=>sql(`select to_jsonb(t) from ${kind==='ticket'?'tickets':kind==='installation'?'installations':'routines'} t where id='${id}';`));
  const rankingSource=sql("select md5(prosrc) from pg_proc where oid='technician_point_contributions(timestamptz,timestamptz)'::regprocedure;");
  const pilot=order('tickets','ticket');
  await t.test('reproduce el fallo aplicado: una Avería nueva de octubre es histórica y rechaza 2 → 5',()=>{
   assert.equal(read('ticket',pilot).historical,true);assert.throws(()=>as(adjust('ticket',pilot)),/históricos de octubre/);
  });
  sql(file('../../supabase/migrations/20261026050000_work_order_points_pending_adjustment.sql'));
  for(const [table,kind]of [['tickets','ticket'],['installations','installation'],['routines','routine']]){
   await t.test(`${kind}: ADMIN ajusta 2 → 5 después de terminar; líder/ayudante ven 2,5; confirmación congela`,()=>{
    const id=kind==='ticket'?pilot:order(table,kind);const prior=read(kind,id);assert.equal(prior.historical,true);assert.equal(prior.canAdjustPoints,true);
    for(const actor of [tech,helper,inactive,'00000000-0000-0000-0000-000000000004']){
     assert.throws(()=>as(adjust(kind,id),actor),/Solo ADMIN/);assert.throws(()=>as(confirm(kind,id,prior.token),actor),/ADMIN/);
    }
    assert.throws(()=>as(adjust(kind,id,5,2,"''")),/Motivo obligatorio/);
    assert.throws(()=>as(`update ${table} set points=5 where id='${id}';`),/motivo obligatorio/);
    as(adjust(kind,id));assert.equal(sql(`select points from ${table} where id='${id}';`),'5');
    assert.equal(as(`select old_points||'|'||new_points||'|'||changed_by||'|'||reason from work_order_point_changes where job_id='${id}';`),`2|5|${admin}|Revisión del trabajo terminado`);
    for(const actor of [tech,helper]){const points=JSON.parse(as(`select my_field_order_points('${kind}','${id}');`,actor));assert.equal(points.jobPoints,5);assert.equal(points.personalPoints,2.5);}
    assert.throws(()=>as(adjust(kind,id,8,2)),/puntaje cambió/);
    assert.throws(()=>as(confirm(kind,id,prior.token)),/cambió/);
    const current=read(kind,id),c=JSON.parse(as(confirm(kind,id,current.token)));assert.equal(c.points,5);assert.deepEqual(c.crew.map((m:{points:number})=>m.points),[2.5,2.5]);
    assert.equal(read(kind,id).canAdjustPoints,false);
    assert.equal(JSON.parse(as(confirm(kind,id,current.token))).id,c.id);assert.equal(sql(`select count(*) from work_order_point_changes where job_id='${id}';`),'1');
    for(const mutation of [adjust(kind,id,8,5),`update ${table} set status='${kind==='ticket'?'open':'pending'}' where id='${id}';`,`delete from ${table} where id='${id}';`,`delete from job_assignees where job_type='${kind}' and job_id='${id}';`])assert.throws(()=>as(mutation,root),/Cierre administrativo definitivo/);
   });
   await t.test(`${kind}: modal puede ajustar y confirmar atómicamente como SUPERADMIN con motivo`,()=>{
    const id=order(table,kind),r=read(kind,id);assert.throws(()=>as(confirm(kind,id,r.token,5),root),/Motivo obligatorio/);
    assert.equal(sql(`select points from ${table} where id='${id}';`),'2');
    const c=JSON.parse(as(confirm(kind,id,r.token,5,"'Revisión en modal'"),root));assert.equal(c.points,5);assert.deepEqual(c.crew.map((m:{points:number})=>m.points),[2.5,2.5]);
    assert.equal(sql(`select count(*) from work_order_point_changes where job_id='${id}' and changed_by='${root}';`),'1');
   });
   await t.test(`${kind}: terminaciones anteriores a activación permanecen protegidas e idénticas`,()=>{
    const id=historic[kind],r=read(kind,id);assert.equal(r.canAdjustPoints,false);
    assert.throws(()=>as(adjust(kind,id)),/históricos anteriores a la activación/);assert.throws(()=>as(confirm(kind,id,r.token,5,"'Intento histórico rechazado'")),/históricos anteriores a la activación/);
   });
  }
  await t.test('históricos, confirmación previa, RLS y acreditación oficial permanecen intactos',()=>{
   Object.entries(historic).forEach(([kind,id],i)=>assert.equal(sql(`select to_jsonb(t) from ${kind==='ticket'?'tickets':kind==='installation'?'installations':'routines'} t where id='${id}';`),beforeHistory[i]));
   assert.equal(sql(`select to_jsonb(c) from work_order_point_confirmations c where id='${frozen.id}';`),frozenRow);
   assert.throws(()=>as(adjust('ticket',alreadyFinal,5,2),root),/Cierre administrativo definitivo/);
   assert.equal(sql("select md5(prosrc) from pg_proc where oid='technician_point_contributions(timestamptz,timestamptz)'::regprocedure;"),rankingSource);
   assert.equal(sql("select count(*) from technician_point_contributions('2026-11-01 05:00Z','2026-11-02 05:00Z');"),'0');
   for(const role of ['authenticated','service_role'])for(const table of ['work_order_point_changes','work_order_point_confirmations'])assert.equal(sql(`select has_table_privilege('${role}','${table}','INSERT,UPDATE,DELETE,TRUNCATE');`),'f');
   assert.throws(()=>as(adjust('ticket',pilot),admin,'anon'),/permission denied/);
  });
  await t.test('cero de Prospecto conserva su excepción; una Alta directa no puede obtenerla',()=>{
   const p=sql("insert into prospects(full_name,phone) values('Ficticio','0000') returning id;");
   const receipt=JSON.parse(as(`select convert_prospect_with_installation('${p}',${quote(JSON.stringify({document_number:'LAB-PROSPECT',first_name:'Ficticio',last_name:'Prueba',status:'prospect'}))}::jsonb,null);`));
   const id=receipt.installation_id;sql(`update installations set status='completed',completed_at='2026-10-25 16:00Z' where id='${id}';insert into job_assignees values('installation','${id}','${tech}','leader');`);
   assert.equal(read('installation',id).canAdjustPoints,true);as(adjust('installation',id,5,0));assert.throws(()=>as(`update installations set points=0 where id='${id}';`),/solo pueden ser cero/);
   assert.throws(()=>as('insert into installations(points) values(0);'),/solo para un Alta/);
  });
  await t.test('límite exacto de activación y fecha técnica ausente: no se abre la edición histórica',()=>{
   for(const [table,kind]of [['tickets','ticket'],['installations','installation'],['routines','routine']]){
    const old=order(table,kind,'2026-10-26 04:22:50.999999Z');assert.equal(read(kind,old).canAdjustPoints,false);assert.throws(()=>as(adjust(kind,old)),/históricos/);
    const current=order(table,kind,'2026-10-26 04:22:51Z','2026-10-10 15:00Z');assert.equal(read(kind,current).canAdjustPoints,true);as(adjust(kind,current));
    const missing=order(table,kind);sql(`update ${table} set ${kind==='ticket'?'resolved_at':'completed_at'}=null where id='${missing}';`);
    assert.equal(read(kind,missing).canAdjustPoints,false);assert.throws(()=>as(adjust(kind,missing)),/históricos/);
   }
  });
 }finally{if(started)try{docker(['stop',container]);}catch{}}
});
