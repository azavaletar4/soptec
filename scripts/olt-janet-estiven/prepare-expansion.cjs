const fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');const rt=__dirname,cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const src=fs.readFileSync(cfg.workspace+'/20261021170000_olt_retirement_expand.sql','utf8');assert.equal(crypto.createHash('sha256').update(Buffer.from(src)).digest('hex'),cfg.sha256);assert(src.startsWith('-- CANDIDATE ONLY.'));assert(/\ncommit;\s*$/.test(src));
const query=fs.readFileSync(cfg.workspace+'/catalog.sql','utf8').trim().replace(/;$/,'');const normalQuery=`select jsonb_build_object('schema',(s::jsonb->'schema')-'read_only','functions',(s::jsonb->'functions')-'read_only','preflight',(s::jsonb->'preflight')-'captured_at'-'onts'-'read_only') from (${query}) q(s)`;
fs.writeFileSync(cfg.workspace+'/normalized-catalog.sql',normalQuery+';\n',{flag:'w'});
const current=read(cfg.dir+'/catalog-before.private.json');const stripMode=o=>Object.fromEntries(Object.entries(o).filter(([k])=>k!=='read_only'));const expected={schema:stripMode(current.schema),functions:stripMode(current.functions),preflight:Object.fromEntries(Object.entries(current.preflight).filter(([k])=>!['captured_at','onts','read_only'].includes(k)))};
const qjson=o=>{const j=JSON.stringify(o),tag='$expected_'+crypto.randomBytes(6).toString('hex')+'$';assert(!j.includes(tag));return tag+j+tag+'::jsonb';};
const protectedQuery=`select jsonb_build_object('clients',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.clients t),'contracts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.service_contracts t),'inventory',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.inventory_units t),'invoices',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text) from public.invoices t))`;
const ontQuery=`select coalesce(jsonb_agg(to_jsonb(o)-'retired_at' order by id),'[]'::jsonb) from public.olt_onts o`;
const before=String.raw`
-- Execution guards only; the approved migration DDL below remains unchanged.
select 1/(case when current_user='postgres' then 1 else 0 end) as expected_owner;
lock table public.olt_onts in access exclusive mode;
lock table supabase_migrations.schema_migrations in share row exclusive mode;
select 1/(case when not exists(select 1 from supabase_migrations.schema_migrations where version in ('20261021170000','20261021171000')) then 1 else 0 end) as no_version_conflict;
`+`\\o /out/catalog-on-entry.json\n${normalQuery};\n\\o\nselect 1/(case when (${normalQuery})=${qjson(expected)} then 1 else 0 end) as schema_unchanged;\n`+`select (${ontQuery})::text as before_onts \\gset\nselect (${protectedQuery})::text as before_protected \\gset\nselect md5(coalesce(jsonb_agg(to_jsonb(m) order by version),'[]'::jsonb)::text) as before_ledger from supabase_migrations.schema_migrations m \\gset\n\\o /out/onts-before.private.json\n${ontQuery};\n\\o /out/protected-before.json\n${protectedQuery};\n\\o /out/catalog-transaction-before.json\n${normalQuery};\n\\o\n`;
const after=String.raw`
-- Prove unchanged rows and guarded metadata BEFORE the sole COMMIT.
select 1/(case when not exists(select 1 from public.olt_onts where retired_at is not null) then 1 else 0 end) as all_retirements_null;
select 1/(case when (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.assign_contract_nap_sync_ont_zone(uuid,uuid,uuid)'::regprocedure)='24ceab68fa6e491605b4058995362177'
and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric)'::regprocedure)='f7be06d3bea298ff396c9a6f3bc30a29' then 1 else 0 end) as expected_reader_bodies;
select 1/(case when to_regclass('public.olt_onts_active_serial_key') is null and to_regclass('public.olt_onts_active_position_key') is null
and exists(select 1 from pg_constraint where conrelid='public.olt_onts'::regclass and conname='olt_onts_olt_device_id_frame_slot_port_ont_id_key' and contype='u') then 1 else 0 end) as original_uniqueness_kept;
`+`select 1/(case when (${ontQuery})=:'before_onts'::jsonb then 1 else 0 end) as exact_ont_rows_preserved;\nselect 1/(case when (${protectedQuery})=:'before_protected'::jsonb then 1 else 0 end) as protected_business_rows_preserved;\nselect 1/(case when (select md5(coalesce(jsonb_agg(to_jsonb(m) order by version),'[]'::jsonb)::text) from supabase_migrations.schema_migrations m)=:'before_ledger' then 1 else 0 end) as existing_ledger_preserved;\n`+
`insert into supabase_migrations.schema_migrations(version,name,statements) values('20261021170000','olt_retirement_expand',ARRAY[${qjson(src)}#>>'{}']);\n`+
`\\o /out/catalog-transaction-after.json\n${normalQuery};\n\\o /out/extra-transaction-after.json\n\\i /scripts/extra-catalog.sql\n\\o /out/onts-after.private.json\n${ontQuery};\n\\o /out/protected-after.json\n${protectedQuery};\n\\o /out/ledger-transaction-after.json\n\\i /scripts/ledger-read.sql\n\\o\n`;
// Only verification statements are inserted around the byte-exact migration statements.
let body=src.replace('begin;','begin;\nset transaction isolation level repeatable read;').replace("set local statement_timeout='30s';", ()=>"set local statement_timeout='30s';\n"+before).replace(/commit;\s*$/,()=>after+'\n-- EXPECTED_POST_ASSERTION\ncommit;\n');
const slash=String.fromCharCode(92);for(const cmd of ['gset','o','i'])body=body.replaceAll(slash+slash+cmd,slash+cmd);
fs.writeFileSync(cfg.workspace+'/execution-template.sql',body,{flag:'w'});
fs.writeFileSync(cfg.workspace+'/lab-apply.sql','set role postgres;\n'+body.replace('-- EXPECTED_POST_ASSERTION','-- Local expected-state capture.'),{flag:'w'});
