-- Solo metadatos. Nunca lee clientes, órdenes ni movimientos reales.
begin transaction read only;
select jsonb_build_object(
 'checkedAt',now(),'readOnly',current_setting('transaction_read_only'),
 'completionFunction',(select pg_get_functiondef(to_regprocedure('public.validate_installation_completion()'))),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('apply_inventory_unit_event','guard_inventory_unit_update','work_order_is_final')),
 'triggers',(select jsonb_agg(jsonb_build_object('table',c.relname,'definition',pg_get_triggerdef(t.oid))) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in ('public.installations'::regclass,'public.inventory_units'::regclass) and not t.tgisinternal),
 'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,'type',data_type,'default',column_default)) from information_schema.columns where table_schema='public' and table_name in ('installations','inventory_units','inventory_unit_events'))
);
rollback;
