import fs from'node:fs';import path from'node:path';import{spawnSync}from'node:child_process';import{randomBytes,randomUUID}from'node:crypto';import{generateKeyPair,exportJWK,importJWK,SignJWT}from'jose';
import{root,pointer,backup,hash,save,config,docker,sql,compose,wait,localFetch}from'./custody-integral-lab-common.mjs';
// CORS para que el bundle real servido por Vite (otro origen/puerto) pueda
// llamar al gateway real -- Caddy debe responder el preflight el mismo
// (@preflight, sin pasar por el proxy) y el header_down del upstream debe
// ir SOLO con el set (sin "-Nombre" antes): con delete+set en la misma
// lista, Caddy 2 deja de aplicar el header_down entero en la respuesta real
// (confirmado en vivo) -- probado con curl contra auth/rest/storage reales.
const caddyfile=ui=>'{\n admin off\n auto_https off\n}\n:8000 {\n @preflight method OPTIONS\n handle @preflight {\n  header Access-Control-Allow-Origin "'+ui+'"\n  header Access-Control-Allow-Methods "GET, POST, PATCH, PUT, DELETE, OPTIONS"\n  header Access-Control-Allow-Headers "{http.request.header.Access-Control-Request-Headers}"\n  header Access-Control-Allow-Credentials "true"\n  respond 204\n }\n handle_path /auth/v1/* {\n  reverse_proxy auth:9999 {\n   header_down Access-Control-Allow-Origin "'+ui+'"\n  }\n }\n handle_path /rest/v1/* {\n  reverse_proxy rest:3000 {\n   header_down Access-Control-Allow-Origin "'+ui+'"\n  }\n }\n handle_path /storage/v1/* {\n  reverse_proxy storage:5000 {\n   header_down Access-Control-Allow-Origin "'+ui+'"\n  }\n }\n}\n';
const phase=process.argv[2];let c;
try{
if(phase==='prepare'){
 const directory=path.resolve(process.argv[3]);if(path.dirname(directory)!==path.join(process.env.LOCALAPPDATA,'SmartRaycoLabs')||!path.basename(directory).startsWith('custodia_integral_'))throw Error('PRIVATE_DIRECTORY');
 if(fs.existsSync(pointer))throw Error('PRESERVE_EXISTING_LAB');
 if(hash(fs.readFileSync(path.join(backup,'completo.dump')))!=='ab583ee88d49bbee3746e0ee89f721307bb4459352ff5b01ef3ab2cf9478af9a')throw Error('BACKUP_HASH');
 if(hash(fs.readFileSync(path.join(backup,'integral-manifest.json')))!=='2acbc7fd993d05a717f3be27430bbdc1f9510e948068b0e74c1af8c525e33682')throw Error('MANIFEST_HASH');
 const secret=()=>randomBytes(32).toString('hex');const{privateKey,publicKey}=await generateKeyPair('ES256',{extractable:true});const kid=randomUUID();
 const priv={...await exportJWK(privateKey),kid,alg:'ES256',use:'sig'},pub={...await exportJWK(publicKey),kid,alg:'ES256',use:'sig'};
 const legacy=secret(),oct={kty:'oct',k:Buffer.from(legacy).toString('base64url'),alg:'HS256',kid:'lab-hs256'};
 const token=role=>new SignJWT({role,aud:'authenticated'}).setProtectedHeader({alg:'HS256',kid:'lab-hs256'}).setIssuedAt().setExpirationTime('7d').sign(Buffer.from(legacy));
 c={directory,project:'smartrayco-custody-integral-'+Date.now(),gateway:'http://127.0.0.1:54421',ui:'http://127.0.0.1:54422',api:'http://127.0.0.1:54423',dbPassword:secret(),legacy,anonKey:await token('anon'),serviceKey:await token('service_role'),jwks:{keys:[pub,oct]},accounts:['admin','leader','support','outsider'].map(role=>({role,email:role+'@custody-integral.invalid',password:secret()}))};
 save(path.join(directory,'config.json'),c);save(pointer,{directory,project:c.project});
 fs.writeFileSync(path.join(directory,'bootstrap.pass'),c.dbPassword+'\n',{flag:'wx',mode:0o600});
 const env=(name,values)=>fs.writeFileSync(path.join(directory,name),Object.entries(values).map(([k,v])=>k+'='+String(v)).join('\n')+'\n',{flag:'wx',mode:0o600});
 env('auth.env',{GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:9999,API_EXTERNAL_URL:c.gateway+'/auth/v1',GOTRUE_JWT_ISSUER:c.gateway+'/auth/v1',GOTRUE_SITE_URL:c.ui,GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:${c.dbPassword}@db:5432/postgres?search_path=auth`,GOTRUE_JWT_SECRET:legacy,GOTRUE_JWT_KEYS:JSON.stringify([priv]),GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_DISABLE_SIGNUP:true,GOTRUE_EXTERNAL_EMAIL_ENABLED:true,GOTRUE_MAILER_AUTOCONFIRM:true,GOTRUE_EXTERNAL_PHONE_ENABLED:false,GOTRUE_RATE_LIMIT_EMAIL_SENT:1000,GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED:false});
 env('rest.env',{PGRST_DB_URI:`postgres://authenticator:${c.dbPassword}@db:5432/postgres`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:JSON.stringify(c.jwks),PGRST_JWT_AUD:'authenticated',PGRST_DB_MAX_ROWS:1000});
 env('storage.env',{ANON_KEY:c.anonKey,SERVICE_KEY:c.serviceKey,POSTGREST_URL:'http://rest:3000',AUTH_JWT_SECRET:legacy,JWT_JWKS:JSON.stringify(c.jwks),DATABASE_URL:`postgres://supabase_storage_admin:${c.dbPassword}@db:5432/postgres`,STORAGE_PUBLIC_URL:c.gateway,FILE_SIZE_LIMIT:52428800,STORAGE_BACKEND:'file',GLOBAL_S3_BUCKET:'lab-objects',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:'custody-lab',REGION:'local',ENABLE_IMAGE_TRANSFORMATION:false,DB_ALLOW_MIGRATION_REFRESH:false,LOG_LEVEL:'error'});
 const scriptDir=path.join(root,'scripts/tests').replaceAll('\\','/');
 save(path.join(directory,'compose.json'),{name:c.project,services:{
 db:{image:'supabase/postgres:17.6.1.136',container_name:c.project+'-db',user:'postgres',entrypoint:['sh','/scripts/custody-integral-lab-db.sh'],environment:{PGDATA:'/var/lib/postgresql/data/custody'},volumes:['pg:/var/lib/postgresql/data',scriptDir+':/scripts:ro',directory.replaceAll('\\','/')+':/private:ro'],networks:['lab'],shm_size:'256mb',mem_limit:'3g',healthcheck:{test:['CMD-SHELL','pg_isready -h /tmp -U supabase_admin -d postgres'],interval:'2s',timeout:'2s',retries:30}},
 auth:{image:'supabase/gotrue:v2.197.0',container_name:c.project+'-auth',env_file:['auth.env'],networks:['lab']},
 rest:{image:'postgrest/postgrest:v14.18',container_name:c.project+'-rest',env_file:['rest.env'],networks:['lab']},
 storage:{image:'supabase/storage-api:v1.81.0',container_name:c.project+'-storage',env_file:['storage.env'],volumes:['objects:/var/lib/storage'],networks:['lab']},
 edge:{image:'caddy:2',container_name:c.project+'-edge',ports:['127.0.0.1:54421:8000'],volumes:['./Caddyfile:/etc/caddy/Caddyfile:ro'],read_only:true,networks:['lab','edge']}
 },volumes:{pg:{},objects:{}},networks:{lab:{internal:true},edge:{}}});
 fs.writeFileSync(path.join(directory,'Caddyfile'),caddyfile(c.ui),{flag:'wx'});
 console.log(JSON.stringify({prepared:true,directory,project:c.project,credentials:'new local only'}));
}else{
 c=config();
 if(phase==='restore'){
  if(fs.existsSync(path.join(c.directory,'restored.json')))throw Error('PRESERVE_RESTORED_DATABASE');
  compose(c,['up','-d','--pull','never','db']);await wait(()=>{try{return docker(['exec',c.project+'-db','pg_isready','-h','/tmp','-U','supabase_admin','-d','postgres']).includes('accepting');}catch{return false;}});
  docker(['cp',path.join(backup,'roles.sql'),c.project+'-db:/tmp/roles.sql']);
  docker(['cp',path.join(backup,'completo.dump'),c.project+'-db:/tmp/completo.dump']);
  docker(['cp',path.join(backup,'database-config-source.json'),c.project+'-db:/tmp/database-config-source.json']);
  const restore=`set -eu\nsed '/^CREATE ROLE supabase_admin;$/d' /tmp/roles.sql >/tmp/roles-adapted.sql\npsql -h /tmp -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/roles-adapted.sql >/tmp/roles.log 2>/tmp/roles.err\npg_restore --exit-on-error --single-transaction -h /tmp -U supabase_admin -d postgres /tmp/completo.dump >/tmp/restore.log 2>/tmp/restore.err\n`;
  docker(['exec','-i',c.project+'-db','sh'],restore);
  sql("alter database postgres owner to postgres; create schema custody_integral_lab; create table custody_integral_lab.identity(marker text primary key); insert into custody_integral_lab.identity values('synthetic-only');");
  sql(['authenticator','supabase_auth_admin','supabase_storage_admin'].map(role=>`alter role ${role} password '${c.dbPassword}';`).join('\n'));
  save(path.join(c.directory,'restored.json'),{restored:true,backupSHA256:hash(fs.readFileSync(path.join(backup,'completo.dump'))),counts:JSON.parse(sql("select json_build_object('clients',(select count(*) from clients),'contracts',(select count(*) from service_contracts),'storageObjects',(select count(*) from storage.objects),'custodyEvents',(select count(*) from technician_material_custody_events));"))});
  const schema=sql("select json_build_object('columns',(select json_agg(x) from(select table_name,column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name in ('clients','profiles','service_contracts','installations','tickets','routines','job_assignees','inventory_products','inventory_categories','inventory_units','inventory_unit_events','zones','infra_elementos','work_order_closures','work_order_photos') order by table_name,ordinal_position)x),'enums',(select json_object_agg(typname,labels) from(select t.typname,json_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname)x),'storageMigrations',(select json_agg(x) from(select * from storage.migrations order by id)x),'storagePolicies',(select json_agg(x) from(select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage')x));");
  save(path.join(c.directory,'schema.json'),JSON.parse(schema));
  console.log('RESTORED_NEW_ISOLATED_DATABASE; archived database untouched');
 }else if(phase==='services'){
  if(!fs.existsSync(path.join(c.directory,'restored.json')))throw Error('RESTORE_FIRST');
  docker(['exec',c.project+'-db','sh','-c','grep -q "0.0.0.0/0 scram-sha-256" "$PGDATA/pg_hba.conf" || printf "\\nhost all all 0.0.0.0/0 scram-sha-256\\n" >>"$PGDATA/pg_hba.conf"']);
  sql('select pg_reload_conf();');
  const storageEnv=path.join(c.directory,'storage.env');
  if(!fs.readFileSync(storageEnv,'utf8').includes('DB_MIGRATIONS_FREEZE_AT='))fs.appendFileSync(storageEnv,'DB_MIGRATIONS_FREEZE_AT=revoke-grants-to-unused-operations\n');
  fs.writeFileSync(storageEnv,fs.readFileSync(storageEnv,'utf8').replace('DB_ALLOW_MIGRATION_REFRESH=false','DB_ALLOW_MIGRATION_REFRESH=true'));
  const authEnv=path.join(c.directory,'auth.env');let authText=fs.readFileSync(authEnv,'utf8');
  authText=authText.replace(/^GOTRUE_JWT_KEYS=(.*)$/m,(_,value)=>'GOTRUE_JWT_KEYS='+JSON.stringify(JSON.parse(value).map(key=>({...key,key_ops:['sign','verify']}))));
  fs.writeFileSync(authEnv,authText);
  const signingJwk=JSON.parse(authText.match(/^GOTRUE_JWT_KEYS=(.*)$/m)[1])[0];const signingKey=await importJWK(signingJwk,'ES256');
  const apiToken=role=>new SignJWT({role,aud:'authenticated'}).setProtectedHeader({alg:'ES256',kid:signingJwk.kid}).setIssuedAt().setExpirationTime('7d').sign(signingKey);
  c.anonKey=await apiToken('anon');c.serviceKey=await apiToken('service_role');fs.writeFileSync(path.join(c.directory,'config.json'),JSON.stringify(c,null,2));
  fs.writeFileSync(storageEnv,fs.readFileSync(storageEnv,'utf8').replace(/^ANON_KEY=.*$/m,'ANON_KEY='+c.anonKey).replace(/^SERVICE_KEY=.*$/m,'SERVICE_KEY='+c.serviceKey));
  fs.writeFileSync(path.join(c.directory,'Caddyfile'),caddyfile(c.ui));
  compose(c,['up','-d','--pull','never','auth','rest','storage','edge']);
  console.log('LOCAL_SERVICES_STARTED; internal database network; localhost gateway only');
 }else if(phase==='seed')await import('./custody-integral-lab-seed.mjs');
 else if(phase==='api')await import('./custody-integral-lab-api.mjs');
 else if(phase==='browser')await import('./custody-integral-lab-browser.mjs');
 else if(phase==='stop'){compose(c,['stop']);console.log('OWN_LAB_STOPPED; volumes and evidence preserved');}
 else if(phase==='status'){
  console.log(compose(c,['ps','-a','--format','{{.Name}} {{.State}}']));
  for(const name of ['auth','rest','storage']){
   const r=spawnSync('docker',['logs','--tail','8',c.project+'-'+name],{encoding:'utf8',windowsHide:true});const t=r.stdout+r.stderr;
   fs.writeFileSync(path.join(c.directory,name+'-startup-'+Date.now()+'.log'),t);
   let message=t.split('\n').filter(Boolean).slice(-1)[0]||'';
   for(const secret of [c.dbPassword,c.legacy,c.serviceKey,c.anonKey])message=message.replaceAll(secret,'[redacted]');
   message=message.replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[private-db-url]');
   console.log(JSON.stringify({service:name,message:message.slice(0,500)}));
  }
  for(const p of ['/auth/v1/health','/storage/v1/status','/rest/v1/']){const r=await localFetch(c.gateway+p);console.log(p+':'+r.status);}
 }
 else throw Error('PHASE');
}
}catch(error){if(c?.directory)fs.writeFileSync(path.join(c.directory,'failure-'+Date.now()+'.json'),JSON.stringify({phase,message:error.message,privateError:error.privateError||null}));console.error('ISOLATED_LAB_BLOCKED:'+error.message+'; private evidence preserved');process.exitCode=1;}
