// Focused local Supabase Auth/PostgREST integration. Synthetic SQL baseline;
// does not certify production table RLS, Storage, Realtime or a full restore.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const runtime=new URL('../../scripts/inventory-auth-lab/runtime/points-auth-final/',import.meta.url);
mkdirSync(runtime,{recursive:true});
const name=`rayco-points-auth-${process.pid}`, secret=randomBytes(48).toString('hex');
const key=new TextEncoder().encode(secret), password=randomBytes(24).toString('hex');
const authUrl='http://127.0.0.1:54492', restUrl='http://127.0.0.1:54493';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const sql=s=>docker(['exec','-i',name+'-db','psql','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],s).trim();
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const results=[];
let passed=false;
const pass=s=>{results.push(s);console.log('PASS '+s);};
const wait=async fn=>{for(let i=0;i<100;i++){try{if(await fn())return;}catch{} await new Promise(r=>setTimeout(r,300));}throw Error('Local service not ready');};
const env=(filename,lines)=>{const path=new URL(filename,runtime);writeFileSync(path,lines.join('\n')+'\n');return path;};
const {fileURLToPath}=await import('node:url');
const service=await new SignJWT({role:'service_role'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(key);
const authEnv=env('auth.env',[
 'GOTRUE_API_HOST=0.0.0.0','GOTRUE_API_PORT=9999',`API_EXTERNAL_URL=${authUrl}`,`GOTRUE_JWT_ISSUER=${authUrl}`,
 'GOTRUE_SITE_URL=http://127.0.0.1:54492','GOTRUE_DB_DRIVER=postgres',
 `GOTRUE_DB_DATABASE_URL=postgres://postgres:${password}@${name}-db:5432/postgres?search_path=auth`,
 `GOTRUE_JWT_SECRET=${secret}`,'GOTRUE_JWT_AUD=authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
 'GOTRUE_JWT_ADMIN_ROLES=service_role','GOTRUE_JWT_EXP=3600','GOTRUE_EXTERNAL_EMAIL_ENABLED=true',
 'GOTRUE_MAILER_AUTOCONFIRM=true','GOTRUE_RATE_LIMIT_EMAIL_SENT=1000']);
const dbEnv=env('db.env',[`POSTGRES_PASSWORD=${password}`]);
const restEnv=env('rest.env',[`PGRST_DB_URI=postgres://authenticator:${password}@${name}-db:5432/postgres`,
 'PGRST_DB_SCHEMAS=public','PGRST_DB_ANON_ROLE=anon',`PGRST_JWT_SECRET=${secret}`,'PGRST_JWT_AUD=authenticated']);
const proxy=new URL('Caddyfile',runtime);
writeFileSync(proxy,`{\n admin off\n auto_https off\n}\n:9999 {\n reverse_proxy ${name}-auth:9999\n}\n:3000 {\n reverse_proxy ${name}-rest:3000\n}\n`);
const rpc=async(token,fn,body)=>{
 const r=await fetch(`${restUrl}/rpc/${fn}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};
};
const ok=r=>{assert.ok(r.status===200||r.status===204,JSON.stringify(r));return r.body;};
const denied=r=>{assert.ok(r.status>=400&&r.status<500,JSON.stringify(r));};
const accounts={};
try{
 docker(['network','create','--internal',name]);
 docker(['run','-d','--pull=never','--name',name+'-db','--network',name,'--tmpfs','/var/lib/postgresql/data','--env-file',fileURLToPath(dbEnv),'postgres:17']);
 await wait(()=>{docker(['exec',name+'-db','pg_isready','-h','127.0.0.1','-U','postgres']);return true;});
 sql(file('./jobWorkSessionsSchema.sql'));
 sql(`create or replace function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create role authenticator login noinherit password '${password}';grant anon,authenticated,service_role to authenticator;
 alter table profiles add column full_name text,add column email text;
 alter table tickets add column points integer,add column category text default 'no_service',add column client_id uuid,
 add column created_at timestamptz default '2026-11-02 15:00Z',add column resolved_at timestamptz,add column closed_at timestamptz,add column imputable_a_tecnico boolean default false;
 alter table installations add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 15:00Z';
 alter table routines add column points numeric,add column completed_at timestamptz,add column created_at timestamptz default '2026-11-02 15:00Z';`);
 sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)[0]);
 for(const p of ['./workOrderPointsContributionBaseline.sql','./pointConfirmationRankingBaseline.sql','./workOrderPointsDefaultPrivileges.sql',
 '../../supabase/migrations/20261024180000_work_order_points.sql','../../supabase/migrations/20261024190000_field_order_points_readonly.sql','../../supabase/migrations/20261024200000_work_order_point_confirmations.sql'])sql(file(p));
 pass('180000 → 190000 → 200000, unchanged SQL and source hash');
 docker(['run','-d','--pull=never','--name',name+'-auth','--network',name,'--env-file',fileURLToPath(authEnv),'supabase/gotrue:v2.197.0']);
 docker(['run','-d','--pull=never','--name',name+'-rest','--network',name,'--env-file',fileURLToPath(restEnv),'postgrest/postgrest:v14.18']);
 docker(['create','--pull=never','--name',name+'-edge','--network',name,'-p','127.0.0.1:54492:9999','-p','127.0.0.1:54493:3000','--mount',`type=bind,src=${fileURLToPath(proxy)},dst=/etc/caddy/Caddyfile,readonly`,'caddy:2']);
 docker(['network','connect','bridge',name+'-edge']);docker(['start',name+'-edge']);
 await wait(async()=> (await fetch(authUrl+'/health')).ok);
 await wait(async()=> (await fetch(restUrl)).ok);
 for(const [label,role,active] of [['admin','ADMIN',true],['super','SUPERADMIN',true],['leader','TECNICO_RED',true],['helper','TECNICO_RED',true],['outsider','TECNICO_RED',true],['inactive','TECNICO_RED',false]]){
  const email=`${label}@points-lab.example`, userPassword=randomBytes(24).toString('hex');
  const created=await fetch(authUrl+'/admin/users',{method:'POST',headers:{Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify({email,password:userPassword,email_confirm:true})});
  assert.equal(created.status,200);const user=await created.json();
  sql(`insert into profiles(id,role,active) values('${user.id}','${role}',${active});`);
  const login=await fetch(authUrl+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:userPassword})});
  assert.equal(login.status,200);const session=await login.json();
  const verified=await jwtVerify(session.access_token,key,{issuer:authUrl,audience:'authenticated'});
  assert.equal(verified.payload.sub,user.id);assert.equal(verified.payload.role,'authenticated');
  accounts[label]={id:user.id,token:session.access_token};pass('Auth real + signed JWT '+label);
 }
 for(const [kind,table] of [['ticket','tickets'],['installation','installations'],['routine','routines']]){
  const job=crypto.randomUUID(),ctx={p_job_type:kind,p_job_id:job};
  sql(`insert into ${table}(id,points,status,assigned_to,${kind==='ticket'?'resolved_at':'completed_at'}) values('${job}',12,'${kind==='ticket'?'resolved':'completed'}','${accounts.leader.id}','2026-11-03 15:00Z');
  insert into job_assignees values('${kind}','${job}','${accounts.leader.id}','leader'),('${kind}','${job}','${accounts.helper.id}','support');`);
  for(const role of ['leader','helper']){const read=ok(await rpc(accounts[role].token,'my_field_order_points',ctx));assert.ok(JSON.stringify(read).includes('12'));}
  assert.equal(ok(await rpc(accounts.outsider.token,'my_field_order_points',ctx)),null);
  denied(await rpc(accounts.inactive.token,'my_field_order_points',ctx));
  for(const role of ['leader','helper','outsider','inactive']){
   denied(await rpc(accounts[role].token,'adjust_work_order_points',{...ctx,p_points:14,p_expected_points:12,p_reason:'Unauthorized'}));
   denied(await rpc(accounts[role].token,'confirm_work_order_points',{...ctx,p_points:12,p_expected_token:'invalid',p_reason:'Unauthorized',p_confirmed:true}));
  }
  pass(kind+': own points leader/helper; outsider/inactive denied; technicians cannot adjust/confirm');
  const adjustment={...ctx,p_points:14,p_expected_points:12,p_reason:'Synthetic authorized adjustment'};
  ok(await rpc(accounts.admin.token,'adjust_work_order_points',adjustment));
  denied(await rpc(accounts.admin.token,'adjust_work_order_points',adjustment));
  for(const role of ['leader','helper'])assert.ok(JSON.stringify(ok(await rpc(accounts[role].token,'my_field_order_points',ctx))).includes('14'));
  const review=ok(await rpc(accounts.super.token,'work_order_point_review',ctx));
  const confirmation={...ctx,p_points:14,p_expected_token:review.token,p_reason:'Synthetic verification',p_confirmed:true};
  const pair=await Promise.all([rpc(accounts.admin.token,'confirm_work_order_points',confirmation),rpc(accounts.super.token,'confirm_work_order_points',confirmation)]);
  const first=ok(pair[0]),second=ok(pair[1]);assert.equal(first.id,second.id);
  assert.equal(ok(await rpc(accounts.super.token,'confirm_work_order_points',confirmation)).id,first.id);
  assert.equal(sql(`select count(*) from work_order_point_changes where job_id='${job}';`),'1');
  assert.equal(sql(`select count(*) from work_order_point_confirmations where job_id='${job}';`),'1');
  denied(await rpc(accounts.admin.token,'adjust_work_order_points',{...ctx,p_points:16,p_expected_points:14,p_reason:'Late'}));
  assert.throws(()=>sql(`update ${table} set status='in_progress' where id='${job}';`),/./);
  assert.throws(()=>sql(`delete from job_assignees where job_id='${job}';`),/./);
  // Synthetic clock only: never use this owner-level mutation outside this lab.
  sql(`update work_order_point_confirmations set confirmed_at='2026-10-25 15:00Z' where job_id='${job}';`);
  assert.equal(sql(`select count(*) from technician_point_contributions('2026-11-01 05:00Z','2026-12-01 05:00Z');`),'0');
  pass(kind+': admin adjustment/audit once, concurrent ADMIN/SUPERADMIN confirmation once, final guards, October not official');
 }
 for(const table of ['work_order_point_changes','work_order_point_confirmations']){
  const response=await fetch(restUrl+'/'+table,{method:'POST',headers:{Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:'{}'});
  assert.ok(response.status>=400&&response.status<500);pass('service_role direct INSERT denied '+table);
 }
 passed=true;
}finally{
 for(const suffix of ['edge','rest','auth','db'])try{docker(['stop',name+'-'+suffix]);}catch{}
 // No containers or volumes removed: preserve synthetic evidence for diagnosis.
 writeFileSync(new URL('results.json',runtime),JSON.stringify({passed,completed:results.length,checks:results,scope:'Synthetic Auth/PostgREST RPC only; no production, Storage or Realtime',containers:name,recordedAt:new Date().toISOString()},null,2));
}
console.log(`PASS ${results.length} focused integration groups; synthetic containers stopped, retained.`);
