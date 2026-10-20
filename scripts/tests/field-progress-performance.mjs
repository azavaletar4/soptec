// Synthetic growth benchmark; no credentials, no network, no production rows.
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const read=p=>readFileSync(p,'utf8');
const cloud=JSON.parse(read('scripts/inventory-auth-lab/runtime/field-progress-cloud-preflight-private.json'));
const category=JSON.parse(read('docs/MI-AVANCE-PREFLIGHT-CLOUD.json')).performance.header.ticketCategories;
const container=`smartrayco-progress-perf-${process.pid}-${Date.now()}`;
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const sql=s=>docker(['exec','-i',container,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],s).trim();
const tech=n=>`00000000-0000-0000-0000-${String(1000+n).padStart(12,'0')}`;
const admin='00000000-0000-0000-0000-000000000002';
const context=uid=>`set timezone='UTC'; set role authenticated; set request.jwt.claim.sub='${uid}'; set request.jwt.claims='{}'; set statement_timeout='15s';`;
const report={synthetic:true,network:'none',postgresImage:'postgres:17',realRowsCopied:0,cloudFunctionMd5:cloud.functions.find(f=>f.name==='get_technician_ranking').md5,cases:[]};
try{
  docker(['run','--rm','-d','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;
  for(let n=0;n<60;n++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.ok(ready);
  sql(read('server/tests/closedOrdersSchema.sql'));
  sql(`alter table profiles add column full_name text,add column email text;
    create type ticket_category as enum (${category.map(c=>"'"+c+"'").join(',')});
    alter table tickets add column category ticket_category,add column points integer,add column client_id uuid,
      add column resolved_at timestamptz,add column closed_at timestamptz,add column created_at timestamptz,
      add column imputable_a_tecnico boolean;
    alter table installations add column completed_at timestamptz,add column client_id uuid,add column contract_id uuid;
    alter table routines add column completed_at timestamptz,add column points numeric,add column zone_id uuid,
      add column nap_elemento_id uuid,add column contract_id uuid;
    grant usage on schema auth to authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for(const name of ['uid','current_user_role','get_technician_ranking'])sql(cloud.functions.find(f=>f.name===name).definition);
  sql(cloud.functions.find(f=>f.name==='get_technician_ranking').definition.replace('public.get_technician_ranking','public.original_ranking'));
  for(const index of cloud.indexes.filter(i=>['tickets','installations','routines','job_assignees'].includes(i.tablename)&&!i.indexname.endsWith('_pkey')))sql(index.indexdef+';');
  sql(read('docs/sql/mi-avance-candidate.sql'));
  for(const shape of [
    {name:'current_volume',tickets:cloud.volumes.tickets,installations:cloud.volumes.installations,routines:cloud.volumes.routines,technicians:cloud.volumes.activeTechnicians},
    {name:'growth_100k',tickets:50000,installations:30000,routines:20000,technicians:60},
  ]){
    sql(`truncate tickets,installations,routines,job_assignees cascade;
      insert into profiles(id,role,active,full_name) select ('00000000-0000-0000-0000-'||lpad((1000+n)::text,12,'0'))::uuid,'TECNICO_RED',true,'Synthetic '||n from generate_series(1,${shape.technicians})n on conflict(id) do nothing;
      insert into tickets(id,status,assigned_to,category,points,client_id,resolved_at,closed_at,created_at,imputable_a_tecnico,ticket_number)
      select md5('ticket'||n)::uuid,case when n%10=0 then 'open'::ticket_status else 'resolved'::ticket_status end,
        ('00000000-0000-0000-0000-'||lpad((1001+n%${shape.technicians})::text,12,'0'))::uuid,
        (array['no_service','slow_speed','equipment','reconnection_relocation','other']::ticket_category[])[n%5+1],
        case when n%3=0 then null else n%11 end,md5('client'||(n/2))::uuid,
        date_trunc('day',now())-(n%365)*interval '1 day',null,
        date_trunc('day',now())-(n%365)*interval '1 day'-interval '1 hour',n%3=0,'SYN-T-'||n
        from generate_series(1,${shape.tickets})n;
      insert into installations(id,status,assigned_to,completed_at)
      select md5('install'||n)::uuid,'completed',('00000000-0000-0000-0000-'||lpad((1001+n%${shape.technicians})::text,12,'0'))::uuid,
        date_trunc('day',now())-(n%365)*interval '1 day' from generate_series(1,${shape.installations})n;
      insert into routines(id,status,assigned_to,completed_at,points,routine_number)
      select md5('routine'||n)::uuid,'completed',('00000000-0000-0000-0000-'||lpad((1001+n%${shape.technicians})::text,12,'0'))::uuid,
        date_trunc('day',now())-(n%365)*interval '1 day',case when n%4=0 then null else n%13 end,'SYN-R-'||n from generate_series(1,${shape.routines})n;
      insert into job_assignees(job_type,job_id,technician_id,role)
      select 'ticket',id,assigned_to,'leader' from tickets union all select 'installation',id,assigned_to,'leader' from installations
        union all select 'routine',id,assigned_to,'leader' from routines;
      insert into job_assignees(job_type,job_id,technician_id,role)
      select j.job_type,j.job_id,('00000000-0000-0000-0000-'||lpad((1001+((substring(j.technician_id::text,25)::int-1001)+offsets.n)%${shape.technicians})::text,12,'0'))::uuid,'support'
      from job_assignees j cross join generate_series(1,3)offsets(n)
      where (offsets.n=1 and substring(j.job_id::text,1,1) in ('a','b','c','d')) or
        (offsets.n=2 and substring(j.job_id::text,1,1)='e') or (offsets.n=3 and substring(j.job_id::text,1,1)='e');
      analyze tickets; analyze installations; analyze routines; analyze job_assignees; analyze profiles;`);
    const same=sql(context(admin)+`select
      (select jsonb_agg(to_jsonb(r)) from get_technician_ranking(extract(month from now())::int,extract(year from now())::int)r)
      is not distinct from (select jsonb_agg(to_jsonb(r)) from original_ranking(extract(month from now())::int,extract(year from now())::int)r);`);
    assert.equal(same,'t');
    const benchmarks=[];
    const queries={original_ranking:{uid:admin,query:'select count(*) from original_ranking(extract(month from now())::int,extract(year from now())::int)'},
      candidate_ranking:{uid:admin,query:'select count(*) from get_technician_ranking(extract(month from now())::int,extract(year from now())::int)'},
      progress:{uid:tech(1),query:'select my_field_progress()'},
      period_ranking:{uid:tech(1),query:"select get_technician_period_ranking('month')"},
      job_detail:{uid:tech(1),query:`select my_field_job_points('ticket',(select id from tickets where assigned_to='${tech(1)}' and status='resolved' limit 1))`}};
    for(const [name,{uid,query}]of Object.entries(queries)){
      const samples=[];
      for(let n=0;n<3;n++){
        const [plan]=JSON.parse(sql(context(uid)+'explain (analyze,buffers,format json) '+query+';'));
        samples.push({executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],sharedHitBlocks:plan.Plan['Shared Hit Blocks'],sharedReadBlocks:plan.Plan['Shared Read Blocks']});
      }
      benchmarks.push({name,samples});
    }
    report.cases.push({...shape,assignmentRows:Number(sql('select count(*) from job_assignees;')),rankEquivalent:true,
      responseBytes:Number(sql(context(tech(1))+'select octet_length(my_field_progress()::text);')),benchmarks});
    console.log(JSON.stringify({shape:shape.name,rankEquivalent:true,benchmarks:benchmarks.map(b=>({name:b.name,executionMs:b.samples.map(s=>s.executionMs)}))}));
  }
  writeFileSync('docs/MI-AVANCE-RENDIMIENTO-LOCAL.json',JSON.stringify(report,null,2)+'\n');
}finally{try{docker(['rm','-f',container]);}catch{}}
