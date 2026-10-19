import fs from'node:fs';import path from'node:path';import{spawnSync}from'node:child_process';import{createClient}from'@supabase/supabase-js';
import{config,root,backup,save,docker,sql,wait,hash,localFetch}from'./custody-integral-lab-common.mjs';
const c=config();const q=v=>"'"+String(v).replaceAll("'","''")+"'";
if(!fs.existsSync(path.join(c.directory,'fixture.json'))){
await wait(async()=>(await localFetch(c.gateway+'/auth/v1/health')).ok);
const usersFile=path.join(c.directory,'synthetic-users.json');const users=fs.existsSync(usersFile)?JSON.parse(fs.readFileSync(usersFile)):{};
const admin=createClient(c.gateway,c.serviceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:localFetch}});
for(const account of c.accounts){if(users[account.role])continue;const{data,error}=await admin.auth.admin.createUser({email:account.email,password:account.password,email_confirm:true,user_metadata:{full_name:'LAB '+account.role,username:'lab-custody-'+account.role}});if(error)throw Error('SYNTHETIC_AUTH_CREATE_'+error.code);users[account.role]=data.user.id;fs.writeFileSync(usersFile,JSON.stringify(users,null,2),{mode:0o600});}
const id=n=>'d1650000-0000-4000-8000-'+String(n).padStart(12,'0');
const f={users,material:id(1),model:id(2),category:id(3),zone:id(4),nap:id(5),jobs:[]};
for(const [index,kind]of['installation','ticket','routine'].entries())for(const materials of[true,false]){const n=10+index*10+(materials?0:5);f.jobs.push({kind,materials,id:id(n),clientId:id(n+1),contractId:id(n+2),unitId:id(n+3)});}
if(sql("select count(*) from clients where id::text like 'd1650000-%';")!=='0')throw Error('FIXTURE_PREFIX_ALREADY_PRESENT');
const result=spawnSync('node',[path.join(root,'scripts/prepare-material-custody-pilot.cjs')],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error('CANDIDATE_CHANGED');
if(sql("select count(*) from custody_integral_lab.identity where marker='synthetic-only';")!=='1')throw Error('ISOLATION_MARKER');
if(!fs.existsSync(path.join(c.directory,'candidates-applied.json'))){
 docker(['exec','-i',c.project+'-db','psql','-X','-q','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],fs.readFileSync(path.join(root,'scripts/inventory-auth-lab/runtime/material-custody-pilot-atomic.sql'),'utf8'));
 save(path.join(c.directory,'candidates-applied.json'),{isolatedOnly:true,versions:['20261019160000','20261019170000']});
}
// All inserted operational IDs are synthetic. Existing cloned operational rows are read only.
let statements='BEGIN;\n';
for(const account of c.accounts)statements+=`insert into profiles(id,email,username,full_name,role,active,must_change_password) values(${q(users[account.role])},${q(account.email)},${q('lab-custody-'+account.role)},${q('LAB '+account.role)},${q(account.role==='admin'?'ADMIN':'TECNICO_RED')},true,false) on conflict(id) do update set role=excluded.role,active=true,must_change_password=false;\n`;
statements+=`insert into zones(id,name)values('${f.zone}','LAB Custodia aislada');
insert into infra_elementos(id,name,zone_id,puertos_total)values('${f.nap}','LAB NAP aislada','${f.zone}',16);
insert into inventory_categories(id,slug,name)values('${f.category}','lab-custodia-integral','LAB Material aislado');
insert into inventory_products(id,name,category_id,unit,is_serialized,current_stock,is_active)values('${f.material}','LAB Consumible','${f.category}','unidad',false,1000,true),('${f.model}','LAB ONU',(select id from inventory_categories where slug='onu'),'unidad',true,0,true);\n`;
for(const [i,job]of f.jobs.entries()){
 statements+=`insert into clients(id,document_type,document_number,first_name,last_name,zone_id,address)values('${job.clientId}','pasaporte','LAB-CUSTODY-${i}','LAB Ficticio ${i}','Sin datos reales','${f.zone}','Laboratorio aislado');
insert into service_contracts(id,client_id,contract_number,client_code,zone_id,status)values('${job.contractId}','${job.clientId}','LAB-CUSTODY-${i}','LAB-CUSTODY-${i}','${f.zone}','active');\n`;
 if(job.kind==='installation')statements+=`insert into installations(id,client_id,contract_id,status,assigned_to,created_by)values('${job.id}','${job.clientId}','${job.contractId}','scheduled','${users.leader}','${users.admin}');\n`;
 else if(job.kind==='ticket')statements+=`insert into tickets(id,client_id,contract_id,title,status,assigned_to,created_by)values('${job.id}','${job.clientId}','${job.contractId}','LAB Averia sintetica','open','${users.leader}','${users.admin}');\n`;
 else statements+=`insert into routines(id,client_id,contract_id,title,category,status,assigned_to,created_by)values('${job.id}','${job.clientId}','${job.contractId}','LAB Rutina sintetica','otro','scheduled','${users.leader}','${users.admin}');\n`;
 statements+=`insert into job_assignees(job_type,job_id,technician_id,role)values('${job.kind}','${job.id}','${users.leader}','leader'),('${job.kind}','${job.id}','${users.support}','support');
insert into inventory_units(id,product_id,serial_number,status)values('${job.unitId}','${f.model}','LAB-ONU-${i}','in_stock');\n`;
}
statements+='COMMIT;';
sql(statements);save(path.join(c.directory,'fixture.json'),f);
}
// Reconstruct file backend with original object versions; source files never modified.
if(fs.existsSync(path.join(c.directory,'storage-restored.json')))throw Error('STORAGE_ALREADY_RESTORED_PRESERVE');
const manifest=JSON.parse(fs.readFileSync(path.join(backup,'storage-manifest.json')));const staging=path.join(c.directory,'storage-backend-restored');if(!fs.existsSync(staging))fs.mkdirSync(staging);
const metadata=[];
for(const object of manifest.objects){const bytes=fs.readFileSync(path.join(backup,object.archiveFile));if(hash(bytes)!==object.sha256)throw Error('ORIGINAL_BLOB_HASH');const relative=['lab-objects','custody-lab',object.bucket_id,...object.name.split('/'),...(object.version?[object.version]:[])];const target=path.resolve(staging,...relative);if(!target.startsWith(staging+path.sep))throw Error('UNSAFE_BLOB_PATH');fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target)){if(hash(fs.readFileSync(target))!==object.sha256)throw Error('EXISTING_RESTORED_BLOB_DIFFERS');}else fs.writeFileSync(target,bytes,{flag:'wx'});metadata.push({file:'/var/lib/storage/'+relative.join('/'),type:object.metadata.mimetype,cache:object.metadata.cacheControl});}
if(!fs.existsSync(path.join(c.directory,'backend-metadata.json')))save(path.join(c.directory,'backend-metadata.json'),metadata);
docker(['cp',staging+'/.',c.project+'-storage:/var/lib/storage']);
docker(['cp',path.join(c.directory,'backend-metadata.json'),c.project+'-storage:/tmp/backend-metadata.json']);
const uid=docker(['exec',c.project+'-storage','id','-u']),gid=docker(['exec',c.project+'-storage','id','-g']);if(!/^\d+$/.test(uid)||!/^\d+$/.test(gid))throw Error('LOCAL_STORAGE_IDENTITY');
docker(['exec','--user','0',c.project+'-storage','chown','-R',uid+':'+gid,'/var/lib/storage/lab-objects']);
const setMetadata="const fs=require('fs');const x=require('fs-xattr');(async()=>{for(const o of JSON.parse(fs.readFileSync('/tmp/backend-metadata.json'))){if(o.type)x.setAttributeSync(o.file,'user.supabase.content-type',o.type);if(o.cache)x.setAttributeSync(o.file,'user.supabase.cache-control',o.cache);}console.log('RESTORED_BLOB_METADATA_OK')})().catch(e=>{console.error('BLOB_METADATA_ERROR_'+e.code);process.exit(1)})";
docker(['exec',c.project+'-storage','node','-e',setMetadata]);
save(path.join(c.directory,'storage-restored.json'),{objects:manifest.objects.length,originalSHA256Verified:true,destructiveOriginalFileTests:false});
console.log('SYNTHETIC_FIXTURES_AND_RESTORED_STORAGE_READY; 6 orders; new local users; candidates isolated only');
