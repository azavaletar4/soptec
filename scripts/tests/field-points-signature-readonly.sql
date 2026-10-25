begin read only;
set local statement_timeout='10s';
select jsonb_build_object('read_only',current_setting('transaction_read_only'),
 'statuses',(select jsonb_agg(x) from (select c.relname as table_name,e.enumlabel,e.enumsortorder
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 join pg_attribute a on a.attrelid=c.oid and a.attname='status'
 join pg_enum e on e.enumtypid=a.atttypid where n.nspname='public' and c.relname in ('tickets','installations','routines')
 order by c.relname,e.enumsortorder) x),
 'signature_column',(select jsonb_agg(to_jsonb(c)) from information_schema.columns c
 where c.table_schema='public' and c.table_name='work_order_closures' and c.column_name='signature_path'),
 'closure_constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)))
 from pg_constraint where conrelid='public.work_order_closures'::regclass),
 'signature_triggers',(select jsonb_agg(jsonb_build_object('table',c.relname,'trigger',t.tgname,'function',p.proname,'definition',pg_get_functiondef(p.oid)))
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
 where n.nspname='public' and c.relname in ('tickets','installations','routines','work_order_closures')
 and not t.tgisinternal and p.prosrc ~* '(signature_path|signatureBlob|firma digital)'),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public'
 and tablename in ('tickets','installations','routines','job_assignees','work_order_closures')));
rollback;
