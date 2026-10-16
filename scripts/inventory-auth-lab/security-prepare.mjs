import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {root,runtime,project,gateway,config,docker,sql,wait} from './common.mjs';
const database='inventory_security_lab',name=project+'-security-rest',url='http://127.0.0.1:54390';
if(existsSync(runtime+'security-prepared.json'))throw Error('Laboratorio ya preparado; conservar sin reinicializar.');
const c=config();const compose=JSON.parse(readFileSync(runtime+'compose.json','utf8'));
if(compose.name!==project||!compose.networks.lab.internal)throw Error('Laboratorio no aislado');
if(sql(`select count(*) from pg_database where datname='${database}'`)!=='0')throw Error('Base existente; no sobrescribir');
const sourceBefore=sql("select jsonb_build_object('products',(select count(*) from inventory_products),'units',(select count(*) from inventory_units),'movements',(select count(*) from inventory_movements),'events',(select count(*) from inventory_unit_events))");
const dump=docker(['exec',project+'-db','pg_dump','-U','postgres','-d','inventory_lab','--no-owner','--no-privileges']);
sql(`create database ${database}`);
const local=s=>docker(['exec','-i',project+'-db','psql','-U','postgres','-d',database,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],s).trim();
local(dump);
local(`grant all on all tables in schema public to authenticated;
 revoke all on campo_inventory_operations from public,anon,authenticated,service_role;
 alter table routines add column if not exists client_id uuid references clients(id),add column if not exists contract_id uuid references service_contracts(id);
 alter table inventory_units add column if not exists pending_pickup_by uuid references profiles(id);
 alter table inventory_unit_events add column if not exists assigned_to uuid references profiles(id);
 alter table inventory_products add column if not exists category text,add column if not exists price numeric default 0,add column if not exists min_stock numeric default 0;
 alter table inventory_categories add column if not exists name text,add column if not exists icon text,add column if not exists color text,add column if not exists sort_order integer default 0,add column if not exists is_active boolean default true;
 alter table clients add column if not exists first_name text,add column if not exists last_name text;
 alter table service_contracts add column if not exists client_code text,add column if not exists installation_address text;`);
for(const file of ['20261015180000_fase162_inventario_rutinas.sql','20261016020000_fase162_autorizacion_recibos.sql'])local(readFileSync(root+'supabase/migrations/'+file,'utf8'));
const accounts=[...c.accounts,JSON.parse(readFileSync(runtime+'transactions-admin.json','utf8'))];
// GoTrue aqui no tiene el prefijo /auth/v1 (Caddy no lo reescribe); se usa su
// ruta real /signup en vez de supabase-js (que siempre antepone /auth/v1).
for(const role of ['SUPERADMIN','SOPORTE','FACTURACION']){
 const account={role,email:`inventory-security-${role.toLowerCase()}-${Date.now()}@example.test`,password:randomBytes(24).toString('base64url')};
 const response=await fetch(gateway+'/signup',{method:'POST',headers:{'Content-Type':'application/json','apikey':c.anonKey},body:JSON.stringify({email:account.email,password:account.password})});
 const body=await response.json();
 if(!response.ok||!body.user?.id)throw Error('No se pudo crear usuario ficticio '+role+': '+JSON.stringify(body));
 account.id=body.user.id;accounts.push(account);
 local(`insert into profiles(id,role,active) values('${account.id}','${role}',true)`);
}
// El administrador ficticio existente conserva su identidad Auth en la copia.
const admin=accounts.find(a=>a.id&&a.role!=='SUPERADMIN'&&a.role!=='SOPORTE'&&a.role!=='FACTURACION');
if(admin?.id)local(`update profiles set role='ADMIN',active=true where id='${admin.id}'`);
writeFileSync(runtime+'security-accounts.json',JSON.stringify(accounts));
const rest=readFileSync(runtime+'rest.env','utf8');if(!rest.includes('@db:5432/inventory_lab'))throw Error('API no local');
writeFileSync(runtime+'security-rest.env',rest.replace('@db:5432/inventory_lab','@db:5432/'+database));
docker(['run','-d','--name',name,'--network',project+'_lab','--publish','127.0.0.1:54390:3000','--env-file',runtime+'security-rest.env','postgrest/postgrest:v14.18']);
docker(['network','connect',project+'_edge',name]);await wait(async()=> (await fetch(url+'/')).ok);
const sourceAfter=sql("select jsonb_build_object('products',(select count(*) from inventory_products),'units',(select count(*) from inventory_units),'movements',(select count(*) from inventory_movements),'events',(select count(*) from inventory_unit_events))");
if(sourceBefore!==sourceAfter)throw Error('El laboratorio anterior cambio; detener');
writeFileSync(runtime+'security-prepared.json',JSON.stringify({database,name,url,source:'inventory_lab: fictitious data only',sourcePreserved:true}));
console.log('SECURITY_LAB_READY: copia ficticia independiente, Fase 162 local y Auth JWT existentes; sin Cloud');
