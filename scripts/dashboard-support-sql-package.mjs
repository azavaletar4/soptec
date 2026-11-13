// Genera y valida artefactos locales; no abre conexiones ni aplica SQL.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const renderSchemaGuard = (baseline, query, roleMd5) => `do $preflight$
declare v_expected jsonb := $schema_baseline$${JSON.stringify(baseline)}$schema_baseline$::jsonb; v_actual jsonb;
begin
  ${query.replace(/;\s*$/, ' into v_actual;')}
  if (v_actual - 'at' - 'read_only') is distinct from (v_expected - 'at' - 'read_only') then
    raise exception 'SCHEMA_DRIFT: detener sin aplicar; conservar respaldo y revisar diferencias';
  end if;
  if md5(pg_get_functiondef('public.current_user_role()'::regprocedure)) <> '${roleMd5}' then raise exception 'ROLE_HELPER_DRIFT'; end if;
  if not exists(select 1 from pg_attribute where attrelid='public.profiles'::regclass and attname='active' and atttypid='boolean'::regtype and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='public.profiles'::regclass and attname='role' and atttypid='public.user_role'::regtype and not attisdropped) then raise exception 'PROFILE_CONTRACT_DRIFT'; end if;
end $preflight$;`;

export const renderPostVerification = (baseline,query) => `\\set ON_ERROR_STOP on
begin read only;
do $verify$
declare v_expected jsonb := $schema_baseline$${JSON.stringify(baseline.tables)}$schema_baseline$::jsonb; v_actual jsonb; v_tables jsonb;
begin
 ${query.replace(/;\s*$/, ' into v_actual;')}
 select jsonb_agg(t || jsonb_build_object(
   'columns',(select jsonb_agg(c) from jsonb_array_elements(t->'columns') c where c->>'name' not in ('prospect_discarded_at','prospect_discarded_by','prospect_discard_reason')),
   'constraints',(select jsonb_agg(c) from jsonb_array_elements(coalesce(nullif(t->'constraints','null'::jsonb),'[]'::jsonb)) c where c->>'name' not in ('clients_prospect_discard_trace_check','clients_prospect_discarded_by_fkey')),
   'triggers',(select jsonb_agg(c) from jsonb_array_elements(coalesce(nullif(t->'triggers','null'::jsonb),'[]'::jsonb)) c where c->>'name' not in ('trg_clients_unfulfilled_prospect_discard','trg_contracts_discarded_prospect_guard','trg_installations_discarded_prospect_guard'))))
 into v_tables from jsonb_array_elements(v_actual->'tables') t;
 if v_tables is distinct from v_expected then raise exception 'PREEXISTING_SCHEMA_RLS_ACL_DEPENDENCY_CHANGED';end if;
 if not has_function_privilege('authenticated','public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean)','execute')
   or has_function_privilege('anon','public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean)','execute')
   or has_function_privilege('service_role','public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean)','execute') then raise exception 'RPC_PERMISSION_DRIFT';end if;
 if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('discard_unfulfilled_client_prospect','guard_unfulfilled_prospect_discard','guard_discarded_prospect_child'))<>3 then raise exception 'FUNCTION_SIGNATURE_DRIFT';end if;
 if (select count(*) from pg_trigger where not tgisinternal and tgenabled='O' and ((tgrelid='public.clients'::regclass and tgname='trg_clients_unfulfilled_prospect_discard') or (tgrelid='public.service_contracts'::regclass and tgname='trg_contracts_discarded_prospect_guard') or (tgrelid='public.installations'::regclass and tgname='trg_installations_discarded_prospect_guard')))<>3 then raise exception 'GUARD_TRIGGER_DRIFT';end if;
 if exists(select 1 from public.clients c where c.prospect_discarded_at is not null and (exists(select 1 from public.service_contracts s where s.client_id=c.id and s.status<>'cancelled') or exists(select 1 from public.installations i where i.client_id=c.id and i.status<>'cancelled'))) then raise exception 'INCONSISTENT_DISCARD';end if;
end $verify$;
select count(*) as discarded_clients from public.clients where prospect_discarded_at is not null;
rollback;
`;

if(process.argv.includes('--prepare')){
 const out='deploy/dashboard-support-prospects-20261113',runtime='scripts/inventory-auth-lab/runtime';
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const put=(name,bytes)=>{const file=out+'/'+name;bytes=Buffer.from(bytes);if(fs.existsSync(file))assert.deepEqual(fs.readFileSync(file),bytes,'SEALED_DRIFT:'+name);else fs.writeFileSync(file,bytes,{flag:'wx'});};
 const backup=fs.readFileSync(runtime+'/dashboard-prospect-discard-schema-private.json');
 assert.equal(hash(backup),'2bda26cf8b1a660a3354df365c7c0099f6afde60b5c40a0c0d4cbfb8c787ef0d');
 const schema=JSON.parse(backup),initial=JSON.parse(fs.readFileSync(runtime+'/dashboard-support-prospects-private.json'));
 assert.equal(schema.read_only,'on');assert.deepEqual(schema.existing_proposal_functions,[]);
 const read=path=>execFileSync('git',['show','61e0e31:'+path]);
 const migration=read('docs/sql/unfulfilled-prospect-discard-proposal.sql');
 assert.equal(hash(migration),'89e3d0f8d11634dc60f65d8c7ae9d91c7ca99e907db3df24e47f424aeaf26ce6');
 const fullQuery=read('scripts/diagnostics/dashboard-prospect-discard-schema-readonly.sql').toString();
 const query=fullQuery.slice(fullQuery.indexOf('select jsonb_build_object('),fullQuery.lastIndexOf('rollback;')).trim();
 const roleMd5=initial.functions.find(f=>f.name==='current_user_role').md5;
 const guard=renderSchemaGuard(schema,query,roleMd5);
 put('schema-baseline.json',backup);put('schema-check-query.sql',query+'\n');put('migration-original.sql',migration);
 put('preflight.sql',"\\set ON_ERROR_STOP on\nbegin isolation level repeatable read read only;\nset local statement_timeout='15s';\n"+guard+'\nrollback;\n');
 const body=migration.toString().replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,'');
 put('apply.sql',"\\set ON_ERROR_STOP on\nbegin;\nset local lock_timeout='3s';\nset local statement_timeout='30s';\nlock table public.clients, public.service_contracts, public.installations in access exclusive mode;\n"+guard+"\ndo $$begin if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid='public.clients'::regclass) then raise exception 'EXPECTED_TABLE_OWNER_REQUIRED';end if;end$$;\n"+body+'\nnotify pgrst, \'reload schema\';\ncommit;\n');
 put('rollback-unused.sql',read('docs/sql/unfulfilled-prospect-discard-rollback-unused.sql'));
 put('disable-used.sql',read('docs/sql/unfulfilled-prospect-discard-disable-used.sql'));
 put('verify.sql',renderPostVerification(schema,query));
 const prior=JSON.parse(fs.readFileSync('deploy/dashboard-v2-20261112/package.json'));
 const imageFile='deploy/dashboard-v2-20261112/frontend-candidate.image.tar.gz';
 assert.equal(hash(fs.readFileSync(imageFile)),prior.files['frontend-candidate.image.tar.gz']);
 const live=JSON.parse(fs.readFileSync(runtime+'/dashboard-support-prospects-release/baseline.json'));
 assert.equal(live.services.frontend.image,prior.candidateImage);
 put('frontend-before.image.tar.gz',fs.readFileSync(imageFile));
 put('backup.json',JSON.stringify({status:'PASS',image:prior.candidateImage,archive:out+'/frontend-before.image.tar.gz',sha256:prior.files['frontend-candidate.image.tar.gz'],source:'prior-published-sealed-candidate',remoteWrites:0},null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',localOnly:true,originalMigrationUnchanged:true,schemaGuardPrepared:true,backupImage:prior.candidateImage}));
}
