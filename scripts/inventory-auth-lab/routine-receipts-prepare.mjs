// Base ficticia separada: Auth local existente, sin tocar inventory_lab.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {config,root,runtime,project,docker,sql,wait} from './common.mjs';
const c=config(),database='inventory_routine_receipt_lab',name=project+'-routine-receipt-rest';
if(existsSync(runtime+'routine-receipt-prepared.json'))throw Error('Fixture existente: no recrear.');
const compose=JSON.parse(readFileSync(runtime+'compose.json','utf8'));
if(compose.name!==project||!compose.networks.lab.internal)throw Error('Red local inesperada');
const baseline=sql(`select jsonb_object_agg(t,h) from (
 select 'products' t,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) h from inventory_products x union all
 select 'units',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_units x union all
 select 'movements',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_movements x union all
 select 'events',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from inventory_unit_events x union all
 select 'receipts',md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from campo_inventory_operations x)z`);
writeFileSync(runtime+'routine-receipt-existing-baseline.json',baseline);
if(sql(`select count(*) from pg_database where datname='${database}'`)!=='0')throw Error('Base ya existe; conservar y revisar preparación incompleta.');
sql(`create database ${database}`);
const local=s=>docker(['exec','-i',project+'-db','psql','-U','postgres','-d',database,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],s).trim();
const file=p=>readFileSync(root+p,'utf8');
local(file('server/tests/closedOrdersSchema.sql').replace(/^create role .*;\r?\n/gm,''));
local(`create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 alter table routines add column client_id uuid references clients(id),add column contract_id uuid;
 alter table inventory_units add column pending_pickup_by uuid references profiles(id);
 alter table inventory_unit_events add column assigned_to uuid references profiles(id);
 create table service_contracts(id uuid primary key,client_id uuid references clients(id));
 update inventory_products set current_stock=100,unit='metro' where not is_serialized;`);
local(file('supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)[0]);
local(file('supabase/migrations/20261012150000_fase151_proteger_ordenes_cerradas.sql'));
local(`create trigger trg_inventory_unit_events_apply before insert on inventory_unit_events for each row execute function apply_inventory_unit_event();
 create trigger trg_inventory_movements_apply before insert on inventory_movements for each row execute function apply_inventory_movement();`);
for(const migration of ['20261012140000_fase150_sesiones_trabajo.sql','20261012200000_fase150b_fix_track_job_work_session_enum.sql','20261014180000_fase161_devolver_rutinas.sql','20261015180000_fase162_inventario_rutinas.sql'])local(file('supabase/migrations/'+migration));
const base=JSON.parse(readFileSync(runtime+'manifest.json','utf8'));
const admin=JSON.parse(readFileSync(runtime+'transactions-admin.json','utf8'));
for(const uid of [...Object.values(base.users),admin.id])if(!/^[\da-f-]{36}$/.test(uid))throw Error('ID ficticio inválido');
local(`insert into profiles(id,role,active) values ${Object.values(base.users).map(uid=>`('${uid}','TECNICO_RED',true)`).join(',')},('${admin.id}','ADMIN',true);
 grant all on all tables in schema public to authenticated;
 revoke all on routine_inventory_operations from public,anon,authenticated,service_role;
 notify pgrst,'reload schema';`);
const rest=file('scripts/inventory-auth-lab/runtime/rest.env');
if(!rest.includes('@db:5432/inventory_lab'))throw Error('Destino local no reconocido');
writeFileSync(runtime+'routine-receipt-rest.env',rest.replace('@db:5432/inventory_lab','@db:5432/'+database));
docker(['run','-d','--name',name,'--network',project+'_lab','--publish','127.0.0.1:54389:3000','--env-file',runtime+'routine-receipt-rest.env','postgrest/postgrest:v14.18']);
docker(['network','connect',project+'_edge',name]);
await wait(async()=> (await fetch('http://127.0.0.1:54389/')).ok);
writeFileSync(runtime+'routine-receipt-prepared.json',JSON.stringify({database,name,url:'http://127.0.0.1:54389',users:base.users,admin:admin.id}));
console.log('ROUTINE_RECEIPT_LAB_READY: base separada + Fase 162 original, Auth local reutilizado, datos previos intactos.');
