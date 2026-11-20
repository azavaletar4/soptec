import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawn} from 'node:child_process';
const proof=JSON.parse(fs.readFileSync(new URL('./fixtures/cable-route-permission-proof.json',import.meta.url)));
const name='map-route-sql-'+process.pid+'-'+Date.now();
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const q=x=>'"'+x.replaceAll('"','""')+'"',lit=x=>"'"+String(x).replaceAll("'","''")+"'";
const sql=text=>docker(['exec','-i',name,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],text);
const id='10000000-0000-4000-8000-000000000001';
const users=Object.fromEntries(proof.userRoleEnum.labels.map((role,i)=>[role,`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const inactive='20000000-0000-4000-8000-999999999999';
const row=()=>JSON.parse(sql(`select to_jsonb(c) from fo_cables c where id='${id}'`));
const as=(uid,query)=>`set role authenticated;set request.jwt.claim.sub=${lit(uid)};${query}`;
const update=(before,point)=>`with changed as (update fo_cables set path=${lit(JSON.stringify(point))}::jsonb where id='${id}' and updated_at=${lit(before.updated_at)}::timestamptz and path=${lit(JSON.stringify(before.path))}::jsonb and map_removed_at is null returning id) select count(*) from changed;`;
test('real RLS and updated_at reproduced locally: permissions, atomic concurrency and logical removal',async t=>{
 const context=docker(['context','show']);assert.match(JSON.parse(docker(['context','inspect',context]))[0].Endpoints.docker.Host,/^(npipe:|unix:|tcp:\/\/(?:localhost|127\.0\.0\.1):)/);
 try{
  docker(['run','--rm','--pull=never','-d','--name',name,'--network=none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  for(let i=0;;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch(e){if(i>60)throw e;await new Promise(r=>setTimeout(r,100));}}
  const columns=proof.table.columns.map(c=>q(c.name)+' '+c.type+(c.default?' default '+c.default:'')+(c.nullable?'':' not null'));
  columns.push('map_removed_at timestamptz');
  sql(`create role authenticated;create role anon;create role service_role;create schema auth;
create type user_role as enum(${proof.userRoleEnum.labels.map(lit).join(',')});
create table profiles(id uuid primary key,role user_role,active boolean);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table fo_cables(${columns.join(',')});${proof.functions.map(f=>f.definition+';').join('\n')}
${proof.table.updatedAtTrigger.definition};
alter table fo_cables enable row level security;
grant usage on schema public,auth to authenticated,anon,service_role;grant all on fo_cables to authenticated,anon,service_role;
${proof.table.policies.map(p=>`create policy ${q(p.name)} on fo_cables for all to authenticated using(${p.using}) with check(${p.check});`).join('\n')}
insert into profiles values ${Object.entries(users).map(([r,u])=>`('${u}','${r}',true)`).join(',')},('${inactive}','SUPERADMIN',false);
insert into fo_cables(id,codigo,tipo,hilos_total,metraje,path) values('${id}','SYNTHETIC','troncal',12,987,'[[0,0],[1,1],[2,2]]');`);
  for(const [role,uid]of Object.entries(users))await t.test(role+' follows actual staff RLS',()=>{const b=row();assert.equal(sql(as(uid,update(b,[[0,0],[1,1.1],[2,2]]))),role==='CLIENTE'?'0':'1');});
  await t.test('inactive SUPERADMIN and unauthenticated cannot update',()=>{const b=row();assert.equal(sql(as(inactive,update(b,[[0,0],[1,2],[2,2]]))),'0');assert.equal(sql('set role anon;'+update(b,[[0,0],[1,2],[2,2]])),'0');});
  await t.test('two simultaneous operators: exactly one succeeds',async()=>{
   const b=row();
   const concurrent=points=>new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',name,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.resume();child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()):reject(Error('LOCAL_SQL_FAILED')));child.stdin.end(as(users.ADMIN,update(b,points)));});
   const results=await Promise.all([concurrent([[0,0],[1,1.2],[2,2]]),concurrent([[0,0],[1,1.3],[2,2]])]);assert.deepEqual(results.sort(),['0','1']);
   const a=row();assert.equal(a.metraje,987);assert.equal(a.codigo,'SYNTHETIC');assert.equal(a.hilos_total,12);assert.notEqual(a.updated_at,b.updated_at);
  });
  await t.test('concurrent change to cable metadata also rejects a stale route',()=>{const b=row();sql(`update fo_cables set notes='ANOTHER OPERATOR' where id='${id}'`);assert.equal(sql(as(users.ADMIN,update(b,[[0,0],[1,2],[2,2]]))),'0');assert.equal(row().notes,'ANOTHER OPERATOR');});
  await t.test('retired cable cannot be changed by editor PATCH',()=>{const b=row();sql(`update fo_cables set map_removed_at=clock_timestamp() where id='${id}'`);assert.equal(sql(as(users.SUPERADMIN,update(b,[[0,0],[1,2],[2,2]]))),'0');});
 }finally{assert.match(name,/^map-route-sql-\d+-\d+$/);docker(['rm','-f',name]);}
});
