-- Solo una definición necesaria para preparar la compatibilidad. Sin órdenes.
begin transaction read only;
select jsonb_build_object('checkedAt',now(),'readOnly',current_setting('transaction_read_only'),
 'definition',pg_get_functiondef('public.assert_material_closure_ready(text,uuid)'::regprocedure),
 'acl',(select proacl::text from pg_proc where oid='public.assert_material_closure_ready(text,uuid)'::regprocedure));
rollback;
