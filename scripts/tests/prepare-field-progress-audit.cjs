// Mechanical extraction from the candidate: emits SELECT-only cloud audits.
// Definitions/IDs remain in ignored runtime. Reports contain aggregates only.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const write=(p,s)=>fs.writeFileSync(path.join(root,p),s);
const metadata=JSON.parse(read('scripts/inventory-auth-lab/runtime/field-progress-cloud-preflight-private.json'));
const candidate=read('docs/sql/mi-avance-candidate.sql');
const fn=name=>candidate.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))[1];
const helper=fn('technician_point_contributions').trim().replace(/;$/,'');
const inline=(from,to)=>'(select * from ('+helper.replace(/\bp_start\b/g,from).replace(/\bp_end\b/g,to)+') as source(technician_id,job_type,job_id,occurred_at,kind,category,crew_size,points))';
const runtime='scripts/inventory-auth-lab/runtime/';
const start="begin isolation level repeatable read read only;\nset local statement_timeout='10s';\nset local lock_timeout='2s';\n";

if(process.argv.includes('--private-rollback')){
  const deployed=metadata.functions.find(f=>f.name==='get_technician_ranking').definition;
  const restore=deployed.replace("where pr.role = 'TECNICO_RED'", "where pr.role = 'TECNICO_RED'\n      and (current_setting('role',true)='service_role'\n        or public.current_user_role() in ('ADMIN','SUPERADMIN','SOPORTE','TECNICO_RED'))")
    .replace('coalesce(pr.full_name, pr.email)', "coalesce(pr.full_name, 'Técnico')");
  assert.notEqual(restore,deployed);
  const md5=crypto.createHash('md5').update(fn('get_technician_ranking')).digest('hex');
  const result=`-- REVIEW ONLY. Preferred DB rollback: preserve privacy and original scoring.
-- Restore previous frontend; keep staff authentication and anonymous denial.
begin;
do $guard$
begin
 if md5((select prosrc from pg_proc where oid='public.get_technician_ranking(int,int)'::regprocedure)) <> '${md5}' then
   raise exception 'Ranking drift: inspect before private rollback';
 end if;
end $guard$;
drop function public.get_technician_period_ranking(text,date);
drop function public.my_field_job_points(text,uuid);
drop function public.my_field_progress();
${restore.trim().replace(/;$/,'')};
revoke all on function public.get_technician_ranking(int,int) from public,anon;
grant execute on function public.get_technician_ranking(int,int) to authenticated,service_role;
drop function public.technician_ranking_between(timestamptz,timestamptz);
drop function public.technician_point_contributions(timestamptz,timestamptz);
commit;
`;
  write('docs/sql/mi-avance-rollback-private.sql',result);
  write('docs/sql/mi-avance-rollback.sql',result);
  console.log('Prepared privacy-preserving rollback; no database calls.');
  process.exit(0);
}

if(process.argv.includes('--report')){
  const access=JSON.parse(read(runtime+'field-progress-cloud-access-private.json'));
  const raw=read(runtime+'field-progress-cloud-performance-private.txt');
  const calendar=JSON.parse(read(runtime+'field-progress-cloud-calendar-private.json'));
  const chunks=raw.split(/PLAN:([a-z_]+)\r?\n/);
  const header=JSON.parse(chunks[0].trim());
  const plans=[];
  for(let i=1;i<chunks.length;i+=2){
    const [plan]=JSON.parse(chunks[i+1].trim());
    plans.push({name:chunks[i],planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],
      sharedHitBlocks:plan.Plan['Shared Hit Blocks'],sharedReadBlocks:plan.Plan['Shared Read Blocks']});
  }
  const rank=metadata.functions.find(f=>f.name==='get_technician_ranking');
  assert.ok(access.filter(a=>a.kind==='custody').every(a=>a.foreignUnits===0&&a.foreignMaterials===0&&a.foreignRequests===0&&a.directForeignMaterialRows===0&&a.unitsMatch&&a.materialsMatch&&a.requestsMatch));
  assert.equal(header.candidateRankingEqualsInstalled,true);
  const result={at:metadata.at,readOnly:metadata.read_only==='on',connectionTimezone:metadata.timezone,
    functions:metadata.functions.map(({schema,name,identityArgs,owner,md5,execute})=>({schema,name,identityArgs,owner,md5,execute})),
    rankMatchesCandidateGuard:candidate.includes(rank.md5),volumes:metadata.volumes,access,calendar,performance:{header,plans},
    notes:['Plans are SELECT expressions extracted mechanically from candidate; new RPCs are not installed.',
      'SQL role/claim tests validate installed policies, not signed-JWT or APK sessions.']};
  write('docs/MI-AVANCE-PREFLIGHT-CLOUD.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  process.exit(0);
}

let access='-- All active technicians. Claims are transaction-local; no login or data writes.\n'+start;
for(let n=0;n<metadata.volumes.activeTechnicians;n++){
  access+=`select id::text as actor from public.profiles where role='TECNICO_RED' and active order by id offset ${n} limit 1\n\\gset
set local role authenticated;
set local request.jwt.claim.sub=:'actor';
set local request.jwt.claims='{}';
select public.my_inventory_custody()::text as payload\n\\gset
select count(*) filter(where technician_id<>auth.uid()) as foreign_rank_rows from public.get_technician_ranking(
 extract(month from now())::int,extract(year from now())::int)\n\\gset
select count(*) as direct_foreign_materials from public.technician_material_custody where technician_id<>auth.uid()\n\\gset
reset role;
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'kind','custody','case',${n+1},
 'foreignUnits',(select count(*) from jsonb_array_elements(:'payload'::jsonb->'units')u join public.inventory_units i on i.id=(u->>'id')::uuid where i.custody_technician_id is distinct from :'actor'::uuid),
 'foreignMaterials',(select count(*) from jsonb_array_elements(:'payload'::jsonb->'materials')m where not exists(select 1 from public.technician_material_custody c where c.technician_id=:'actor'::uuid and c.product_id=(m->'product'->>'id')::uuid)),
 'foreignRequests',(select count(*) from jsonb_array_elements(:'payload'::jsonb->'pendingReturnRequests')r join public.technician_material_return_requests q on q.id=(r->>'id')::uuid where q.technician_id<>:'actor'::uuid),
 'unitsMatch',jsonb_array_length(:'payload'::jsonb->'units')=(select count(*) from public.inventory_units where custody_technician_id=:'actor'::uuid and status in ('with_technician','pending_return')),
 'materialsMatch',jsonb_array_length(:'payload'::jsonb->'materials')=(select count(*) from public.technician_material_custody where technician_id=:'actor'::uuid and quantity>0)
   and not exists(select 1 from jsonb_array_elements(:'payload'::jsonb->'materials')m join public.technician_material_custody c on c.technician_id=:'actor'::uuid and c.product_id=(m->'product'->>'id')::uuid where c.quantity<>(m->>'quantity')::numeric),
 'requestsMatch',jsonb_array_length(:'payload'::jsonb->'pendingReturnRequests')=(select count(*) from public.technician_material_return_requests where technician_id=:'actor'::uuid and status='pending'),
 'directForeignMaterialRows',:'direct_foreign_materials'::int,'installedForeignRankingRows',:'foreign_rank_rows'::int);
`;
}
access+=`set local role anon;
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'kind','installed_anon_ranking','rows',count(*)) from public.get_technician_ranking(extract(month from now())::int,extract(year from now())::int);
reset role;
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'kind','signature_checks',
 'custodyHasNoActorArgument',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='my_inventory_custody' and p.pronargs>0),
 'newRpcsAbsent',to_regprocedure('public.my_field_progress()') is null and to_regprocedure('public.my_field_job_points(text,uuid)') is null);
rollback;\n`;
write('scripts/tests/field-progress-cloud-access.sql',access);

const params=`select id::text as actor from public.profiles where role='TECNICO_RED' and active order by id limit 1\n\\gset
select id::text as admin_actor from public.profiles where role in ('ADMIN','SUPERADMIN') and active order by id limit 1\n\\gset
set local request.jwt.claim.sub=:'admin_actor';
select (now() at time zone 'America/Lima')::text as local_now,
 (date_trunc('day',now() at time zone 'America/Lima') at time zone 'America/Lima')::text as day_start,
 (date_trunc('week',now() at time zone 'America/Lima') at time zone 'America/Lima')::text as week_start,
 (date_trunc('month',now() at time zone 'America/Lima') at time zone 'America/Lima')::text as month_start,
 (least(date_trunc('week',now() at time zone 'America/Lima'),date_trunc('month',now() at time zone 'America/Lima')) at time zone 'America/Lima')::text as scan_start,
 (greatest(date_trunc('week',now() at time zone 'America/Lima')+interval '1 week',date_trunc('month',now() at time zone 'America/Lima')+interval '1 month') at time zone 'America/Lima')::text as scan_end\n\\gset\n`;
let progress=fn('my_field_progress');
progress=progress.slice(progress.indexOf('with periods('),progress.indexOf(' into result;'))+';';
progress=progress.replace(/public\.technician_point_contributions\(\s*least\(day_start,week_start,month_start\), \(select max\(end_at\) from periods\)\)/,
  inline(":'scan_start'::timestamptz",":'scan_end'::timestamptz"));
for(const key of ['day_start','week_start','month_start'])progress=progress.replace(new RegExp('\\b'+key+'\\b','g'),":'"+key+"'::timestamptz");
progress=progress.replace(/\blocal_now\b/g,":'local_now'::timestamp").replace(/\bactor\b/g,":'actor'::uuid").replace(/\binstant\b/g,'now()');
assert.ok(!progress.includes('public.technician_point_contributions('));
let ranking=fn('get_technician_ranking').trim().replace(/;$/,'');
let aggregate=fn('technician_ranking_between').trim().replace(/;$/,'');
aggregate=aggregate.replace(/public\.technician_point_contributions\(p.start_date::timestamptz,p.end_date::timestamptz\)/,
  ()=>inline('p.start_date::timestamptz','p.end_date::timestamptz'));
aggregate=aggregate.replace(/\bp_start\b/g,'make_date(p_year,p_month,1)::timestamptz')
  .replace(/\bp_end\b/g,"(make_date(p_year,p_month,1)+interval '1 month')::date::timestamptz");
ranking=ranking.replace(/public\.technician_ranking_between\([\s\S]*?\)\n  where/,
  ()=>'('+aggregate+') as summary\n  where');
assert.ok(!ranking.includes('public.technician_ranking_between('));
assert.ok(!ranking.includes('public.technician_point_contributions('));
ranking=ranking.replace(/\bp_month\b/g,'extract(month from now())::int').replace(/\bp_year\b/g,'extract(year from now())::int');
const comparison=`with proposed as (${ranking}), existing as (select * from public.get_technician_ranking(extract(month from now())::int,extract(year from now())::int))
 select (select jsonb_agg(to_jsonb(r) order by r.total_points desc,r.technician_name) from proposed r)
 is not distinct from (select jsonb_agg(to_jsonb(r) order by r.total_points desc,r.technician_name) from existing r)`;
const extraHeader=`select jsonb_build_object('read_only',current_setting('transaction_read_only'),'at',now(),
 'candidateRankingEqualsInstalled',(${comparison}),
 'timezones',current_setting('TimeZone'),
 'ticketPointColumnType',(select udt_name from information_schema.columns where table_schema='public' and table_name='tickets' and column_name='points'),
 'ticketCategories',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='ticket_category'),
 'periodStartHoursUTC',jsonb_build_object('day',extract(hour from :'day_start'::timestamptz),'week',extract(hour from :'week_start'::timestamptz),'month',extract(hour from :'month_start'::timestamptz)));
`;
const queries={installed_ranking:'select count(*) from public.get_technician_ranking(extract(month from now())::int,extract(year from now())::int)',
  candidate_ranking:'select count(*) from ('+ranking+')r',candidate_progress:progress.replace(/;$/,''),
  installed_custody:"select public.my_inventory_custody()"};
let perf='-- Candidate CTEs are extracted verbatim, not installed. EXPLAIN executes SELECT only.\n'+start+params+extraHeader;
for(const [name,q]of Object.entries(queries)){
  if(name==='installed_custody')perf+="set local role authenticated;\nset local request.jwt.claim.sub=:'actor';\n";
  perf+=`\\echo PLAN:${name}\nexplain (analyze,buffers,format json) ${q};\n`;
  if(name==='installed_custody')perf+='reset role;\n';
}
perf+='rollback;\n';
write('scripts/tests/field-progress-cloud-performance.sql',perf);
console.log('Prepared fixed READ ONLY audits: all active technicians and extracted candidate SELECT plans.');
