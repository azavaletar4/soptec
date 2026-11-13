begin isolation level repeatable read read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'at',now(),
 'pending_installation_clients',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'first_name',c.first_name,'last_name',c.last_name,'status',c.status,
   'open_installations',(select jsonb_agg(jsonb_build_object('id',i.id,'status',i.status)) from public.installations i where i.client_id=c.id and i.status::text in ('pending','scheduled','in_progress')))),'[]'::jsonb)
   from public.clients c where exists(select 1 from public.installations i where i.client_id=c.id and i.status::text in ('pending','scheduled','in_progress'))),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'md5',md5(pg_get_functiondef(p.oid)))),'[]'::jsonb) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('discard_unfulfilled_client_prospect','guard_unfulfilled_prospect_discard','guard_discarded_prospect_child','client_retire_atomic','client_retirement_guard_client')),
 'clients_policies',(select jsonb_agg(jsonb_build_object('name',polname,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))) from pg_policy where polrelid='public.clients'::regclass)
);
rollback;
