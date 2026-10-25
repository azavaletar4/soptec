-- Catálogo limitado al flujo de baja; no lee ni modifica fichas reales.
begin isolation level repeatable read read only;
set local statement_timeout='10s';
select jsonb_build_object('kind','retirement_metadata','read_only',current_setting('transaction_read_only'),
 'at',now(),'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,
 'definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid))) from pg_trigger t
 where not t.tgisinternal and t.tgrelid in ('public.clients'::regclass,'public.service_contracts'::regclass,'public.installations'::regclass)),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public' and tablename in ('clients','service_contracts','installations')),
 'roleFunction',pg_get_functiondef('public.current_user_role()'::regprocedure));
rollback;
