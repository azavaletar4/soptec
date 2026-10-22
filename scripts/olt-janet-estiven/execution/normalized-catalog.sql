select jsonb_build_object('schema',(s::jsonb->'schema')-'read_only','functions',(s::jsonb->'functions')-'read_only','preflight',(s::jsonb->'preflight')-'captured_at'-'onts'-'read_only') from (select json_build_object('schema',(
select json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'columns',(select json_agg(x) from (select column_name,data_type,is_nullable,column_default,udt_name from information_schema.columns where table_schema='public' and table_name='olt_onts' order by ordinal_position)x),
 'constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.olt_onts'::regclass or confrelid='public.olt_onts'::regclass order by conname)x),
 'triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.olt_onts'::regclass and not tgisinternal order by tgname)x),
 'status_values',(select json_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid='public.ont_status'::regtype)
)),'functions',(
select json_build_object('read_only',current_setting('transaction_read_only'),
 'functions',(select json_agg(x) from (select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosrc,p.prosecdef,p.proconfig,p.proacl::text as grants,pg_get_userbyid(p.proowner) as owner,
 md5(replace(p.prosrc,E'\r\n',E'\n')) as body_lf_md5
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crear_descuento_compensacion_masivo','assign_contract_nap_sync_ont_zone') order by p.proname)x))),'preflight',(select json_build_object('captured_at',transaction_timestamp(),'read_only',current_setting('transaction_read_only'),
'indexes',(select json_agg(x) from (select indexname,indexdef from pg_indexes where schemaname='public' and tablename='olt_onts' order by indexname)x),
'policies',(select json_agg(x) from (select * from pg_policies where schemaname='public' and tablename='olt_onts' order by policyname)x),
'owner',(select pg_get_userbyid(relowner) from pg_class where oid='public.olt_onts'::regclass),
'rls',(select json_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.olt_onts'::regclass),
'related_constraints',(select json_agg(x) from (select conname,conrelid::regclass::text as table_name,confrelid::regclass::text as reference_table,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.inventory_units'::regclass,'public.service_contracts'::regclass,'public.olt_alert_log'::regclass,'public.olt_provisioning_operations'::regclass) order by conrelid::regclass::text,conname)x),
'contract_triggers',(select json_agg(x) from (select tgname,pg_get_triggerdef(oid) as definition,pg_get_functiondef(tgfoid) as function from pg_trigger where tgrelid='public.service_contracts'::regclass and not tgisinternal order by tgname)x),
'duplicate_serials',(select json_agg(x) from (select olt_device_id,upper(btrim(serial)) as serial,count(*) from public.olt_onts group by olt_device_id,upper(btrim(serial)) having count(*)>1)x),
'duplicate_positions',(select json_agg(x) from (select olt_device_id,frame,slot,port,ont_id,count(*) from public.olt_onts group by olt_device_id,frame,slot,port,ont_id having count(*)>1)x),
'name_collisions',json_build_object('guard',to_regprocedure('public.guard_olt_ont_retirement()')::text,'serial_index',to_regclass('public.olt_onts_active_serial_key')::text,'position_index',to_regclass('public.olt_onts_active_position_key')::text),
'onts',(select json_agg(o order by id) from public.olt_onts o where id in ('a1f0b671-a1e2-482c-b24e-7e584bf0e4ed','74d586e3-3a0a-40c2-aba3-46294adcf095','76701eb5-405e-462f-862d-384a469cadac') or upper(btrim(serial)) in ('MSTC8CCE647E','HWTCDEB847B6','HWTCE5C94DB6','HWTC5C94DB6')))))) q(s);
