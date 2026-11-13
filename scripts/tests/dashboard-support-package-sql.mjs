// Solo Docker local efímero, sin red. No credenciales ni datos reales.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {renderSchemaGuard,renderPostVerification} from '../dashboard-support-sql-package.mjs';
const out='deploy/dashboard-support-prospects-20261113';
const name='dashboard-support-guard-'+process.pid+'-'+Date.now();
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const context=docker(['context','show']).trim();assert.match(JSON.parse(docker(['context','inspect',context]))[0].Endpoints.docker.Host,/^(npipe:|unix:|tcp:\/\/(?:127\.0\.0\.1|localhost):)/);
const query=sql=>docker(['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],sql).trim();
const sha=b=>createHash('sha256').update(b).digest('hex');
const candidate=fs.readFileSync(out+'/apply.sql','utf8'),source=fs.readFileSync(out+'/migration-original.sql');
const checks=[];
try{
 docker(['run','--rm','--pull=never','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 let ready=false;for(let i=0;i<50;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
 const schema=fs.readFileSync('server/tests/clientRetirement.fixture.sql','utf8'),at=schema.indexOf('create policy clients_staff_only');
 query(schema.slice(0,at));query("create function public.current_user_role()returns user_role language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid() and active$$;");query(schema.slice(at));
 query("insert into clients(id,status,document_number)values('10000000-0000-0000-0000-000000000001','prospect','SYNTHETIC');insert into service_contracts(id,client_id,status)values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','cancelled');insert into installations(id,client_id,contract_id,status)values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','cancelled');");
 const before=()=>query("select jsonb_build_object('clients',(select jsonb_agg(to_jsonb(c)-'prospect_discarded_at'-'prospect_discarded_by'-'prospect_discard_reason') from clients c),'contracts',(select jsonb_agg(to_jsonb(c)) from service_contracts c),'installations',(select jsonb_agg(to_jsonb(i)) from installations i),'history',(select jsonb_agg(to_jsonb(h)) from preserved_history h));");
 const state=before();assert.throws(()=>query(candidate),/SCHEMA_DRIFT/);assert.equal(before(),state);
 assert.equal(query("select count(*) from information_schema.columns where table_name='clients' and column_name like 'prospect_discard%';"),'0');checks.push('EXACT_PACKAGE_REJECTS_SCHEMA_MISMATCH_WITHOUT_DDL_OR_DATA_WRITES');
 const catalog=fs.readFileSync(out+'/schema-check-query.sql','utf8'),baseline=JSON.parse(query(catalog)),roleMd5=query("select md5(pg_get_functiondef('public.current_user_role()'::regprocedure));");
 const guard=renderSchemaGuard(baseline,catalog,roleMd5);
 const lab=candidate.replace(/do \$preflight\$[\s\S]*?end \$preflight\$;/,()=>guard);
 const unchangedMigration=source.toString().replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,'');assert.ok(candidate.includes(unchangedMigration));
 query(lab);assert.equal(before(),state);assert.equal(query('select count(*) from clients where prospect_discarded_at is not null;'),'0');checks.push('SAME_GUARD_AND_EXACT_MIGRATION_PASS_SYNTHETIC_BASELINE_WITH_ZERO_BUSINESS_CHANGES');
 query(renderPostVerification(baseline,catalog));query('grant execute on function public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean) to anon;');assert.throws(()=>query(renderPostVerification(baseline,catalog)),/RPC_PERMISSION_DRIFT/);query('revoke execute on function public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean) from anon;');
 query('alter policy clients_staff_only on clients using(true);');assert.throws(()=>query(renderPostVerification(baseline,catalog)),/PREEXISTING_SCHEMA_RLS_ACL_DEPENDENCY_CHANGED/);
 query('alter policy clients_staff_only on clients using('+baseline.tables.find(t=>t.name==='clients').policies[0].using+');');query(renderPostVerification(baseline,catalog));
 checks.push('POSTCHECK_REJECTS_ANONYMOUS_RPC_AND_EXISTING_RLS_DRIFT');
 assert.throws(()=>query(lab),/SCHEMA_DRIFT/);checks.push('REAPPLY_REJECTED');
 query(fs.readFileSync(out+'/rollback-unused.sql','utf8'));assert.equal(before(),state);assert.equal(query("select count(*) from information_schema.columns where table_name='clients' and column_name like 'prospect_discard%';"),'0');checks.push('EXACT_UNUSED_ROLLBACK_RESTORES_SCHEMA_AND_PRESERVES_DATA');
 const result={status:'PASS',localOnly:true,productionWrites:0,synthetic:true,checks,applySha256:sha(Buffer.from(candidate)),originalMigrationSha256:sha(source),prior13SqlTestsReusedWithoutRerun:true,positiveTestUsesSyntheticExpectedCatalog:true};
 fs.writeFileSync(out+'/sql-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{try{docker(['stop',name]);}catch{/* Solo contenedor de laboratorio propio. */}}
