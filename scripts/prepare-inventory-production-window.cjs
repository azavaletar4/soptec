// Generates guarded SQL and compose overrides locally; executes no SQL or deploy.
const fs=require('node:fs'),crypto=require('node:crypto');
const runtime='scripts/inventory-auth-lab/runtime/';
const candidate=JSON.parse(fs.readFileSync('docs/INVENTARIO-PRODUCCION-CANDIDATO.json','utf8'));
const pre=JSON.parse(fs.readFileSync('docs/INVENTARIO-PRODUCCION-PRECHECK.json','utf8'));
const images=JSON.parse(fs.readFileSync('docs/INVENTARIO-PRODUCCION-IMAGENES.json','utf8'));
if(!candidate.sourceRevision)throw Error('MISSING_RELEASE_REVISION');
const migrations=candidate.files.filter(f=>f.file.startsWith('supabase/migrations/'));
const pieces=migrations.map(e=>{
 const bytes=fs.readFileSync(e.file),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 if(hash!==e.validatedSha256||hash!==e.candidateSha256)throw Error('MIGRATION_HASH_DRIFT');
 const sql=bytes.toString('utf8');
 const begin=sql.search(/^begin;\s*$/mi),tail=sql.search(/^commit;\s*$/mi);
 if(begin<0||tail<begin||sql.slice(tail).trim().toLowerCase()!=='commit;')throw Error('UNEXPECTED_TRANSACTION_BOUNDARIES');
 return '';
});
// Construct each migration body explicitly after the verified first BEGIN and final COMMIT.
for(let i=0;i<migrations.length;i++){
 const lines=fs.readFileSync(migrations[i].file,'utf8').replace(/\r\n/g,'\n').split('\n');
 const first=lines.findIndex(l=>/^begin;\s*$/i.test(l));
 let last=lines.length-1;while(last>=0&&!lines[last].trim())last--;
 if(!/^commit;\s*$/i.test(lines[last]))throw Error('MIGRATION_END');
 pieces[i]=lines.filter((_,n)=>n!==first&&n!==last).join('\n');
}
const guard=`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
SET LOCAL transaction_timeout='120s';
LOCK TABLE public.installations,public.tickets,public.routines,public.job_assignees,public.job_work_sessions,public.inventory_products,public.inventory_categories,public.inventory_units,public.inventory_movements,public.inventory_unit_events IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $guard$
BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres' THEN RAISE EXCEPTION 'WRONG_TARGET'; END IF;
 IF EXISTS(SELECT 1 FROM public.job_work_sessions WHERE ended_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.installations WHERE status::text='in_progress')
 OR EXISTS(SELECT 1 FROM public.tickets WHERE status::text='in_progress')
 OR EXISTS(SELECT 1 FROM public.routines WHERE status::text='in_progress') THEN RAISE EXCEPTION 'FIELD_OPERATIONS_IN_PROGRESS'; END IF;
 IF to_regclass('public.campo_inventory_operations') IS NOT NULL OR to_regprocedure('public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'MIGRATION_STATE_CHANGED'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)'))) IS DISTINCT FROM '${pre.fase162RpcMd5}' THEN RAISE EXCEPTION 'FASE162_DRIFT'; END IF;
 IF md5(pg_get_functiondef(to_regprocedure('public.inventory_get_albums()'))) IS DISTINCT FROM '${pre.albumsDefinitionMd5}' THEN RAISE EXCEPTION 'ALBUMS_ROLLBACK_DRIFT'; END IF;
 IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN('inventory_products','inventory_categories','inventory_units','inventory_movements','inventory_unit_events')) IS DISTINCT FROM $expected$${JSON.stringify(pre.policies)}$expected$::jsonb THEN RAISE EXCEPTION 'POLICY_ROLLBACK_DRIFT'; END IF;
END $guard$;
CREATE TEMP TABLE inventory_activation_baseline ON COMMIT DROP AS
SELECT t,(xpath('/row/hash/text()',query_to_xml(format('SELECT md5(string_agg(row_to_json(x)::text, chr(10) ORDER BY id)) AS hash FROM public.%I x',t),false,true,'')))[1]::text AS hash
FROM unnest(ARRAY['inventory_products','inventory_categories','inventory_units','inventory_movements','inventory_unit_events']) t;
`;
const end=`
DO $post$
DECLARE b record; current_hash text;
BEGIN
 FOR b IN SELECT * FROM inventory_activation_baseline LOOP
  EXECUTE format('SELECT md5(string_agg(row_to_json(x)::text, chr(10) ORDER BY id)) FROM public.%I x',b.t) INTO current_hash;
  IF current_hash IS DISTINCT FROM b.hash THEN RAISE EXCEPTION 'OPERATIONAL_DATA_CHANGED'; END IF;
 END LOOP;
 IF md5(pg_get_functiondef(to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)'))) IS DISTINCT FROM '${pre.fase162RpcMd5}' THEN RAISE EXCEPTION 'FASE162_CHANGED'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname='inventory_admin_only')<>5 THEN RAISE EXCEPTION 'RLS_POSTCHECK_FAILED'; END IF;
END $post$;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT json_build_object('migrationsCommitted',true,'sourceRevision','${candidate.sourceRevision}','operationalDataUnchanged',true,'fase162Unchanged',true);
`;
const sql=guard+pieces.join('\n')+end;
const bundle=runtime+'inventory-production-apply.sql';fs.writeFileSync(bundle,sql);
const short=candidate.sourceRevision.slice(0,7),remote='/opt/smartrayco-staging/inventario-'+short;
let deploy='services:\n',rollback='services:\n';
for(const service of ['frontend','backend']){
 const active=images.containers.find(c=>c.name==='/smartrayco-'+service+'-1');
 deploy+=`  ${service}:\n    image: smartrayco-${service}:inventario-${short}\n    build:\n      context: ${remote}/source\n      dockerfile: deploy/Dockerfile.${service}\n      labels:\n        org.opencontainers.image.revision: "${candidate.sourceRevision}"\n`;
 rollback+=`  ${service}:\n    image: smartrayco-${service}:rollback-inventario-${short}\n`;
 if(!active?.recoverableLocally)throw Error('ROLLBACK_IMAGE_MISSING');
}
fs.writeFileSync(runtime+'inventory-production.override.yml',deploy);
fs.writeFileSync(runtime+'inventory-production-rollback.override.yml',rollback);
const evidence={preparedAt:new Date().toISOString(),sourceRevision:candidate.sourceRevision,remoteDirectory:remote,migrations:migrations.map(e=>({file:e.file,sha256:e.validatedSha256})),bundle:{path:bundle,sha256:crypto.createHash('sha256').update(sql).digest('hex'),singleTransaction:true,executed:false},composeOverride:runtime+'inventory-production.override.yml',rollbackOverride:runtime+'inventory-production-rollback.override.yml',requiresNoActiveFieldJobs:true,credentialsRotationDeferred:true};
fs.writeFileSync('docs/INVENTARIO-PRODUCCION-VENTANA.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
