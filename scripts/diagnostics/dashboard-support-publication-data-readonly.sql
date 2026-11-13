begin isolation level repeatable read read only;
set local statement_timeout='15s';
set local lock_timeout='2s';
set local timezone='UTC';
with jobs as (
 select 'ticket' as kind,id,status::text,priority::text from public.tickets where status::text in ('open','in_progress','rescheduled')
 union all select 'routine',id,status::text,priority::text from public.routines where status::text in ('pending','scheduled','in_progress')
 union all select 'installation',id,status::text,priority::text from public.installations where status::text in ('pending','scheduled','in_progress')
), pending_clients as (
 select c.* from public.clients c where exists(select 1 from public.installations i where i.client_id=c.id and i.status::text in ('pending','scheduled','in_progress'))
)
select jsonb_build_object(
 'at',now(),'read_only',current_setting('transaction_read_only'),
 'support',jsonb_build_object('pending',(select count(*) from jobs where status<>'in_progress'),'inProgress',(select count(*) from jobs where status='in_progress'),'urgent',(select count(*) from jobs where priority='urgent'),'uniqueOrders',(select count(distinct(kind||':'||id)) from jobs),'rows',(select count(*) from jobs),'byTypeStatus',(select jsonb_agg(g order by kind,status) from (select kind,status,count(*) as amount from jobs group by kind,status)g)),
 'prospects',jsonb_build_object('pendingInstallationClients',(select count(*) from pending_clients),'requestedReferenceMatches',(select bool_and(first_name='Manuel' and last_name='Romero Collantes') from pending_clients),'cancelledRawProspectsExcluded',(select count(*) from public.clients c where status='prospect' and not exists(select 1 from public.service_contracts s where s.client_id=c.id and s.status<>'cancelled') and exists(select 1 from public.service_contracts s where s.client_id=c.id) and exists(select 1 from public.installations i where i.client_id=c.id) and not exists(select 1 from public.installations i where i.client_id=c.id and i.status<>'cancelled')),'discardedRows',(select count(*) from public.clients c where to_jsonb(c)->>'prospect_discarded_at' is not null)),
 'fingerprints',jsonb_build_object(
  'clients_count',(select count(*) from public.clients),'clients_md5',(select md5(string_agg(md5((to_jsonb(c)-'prospect_discarded_at'-'prospect_discarded_by'-'prospect_discard_reason')::text),'' order by id)) from public.clients c),
  'contracts_count',(select count(*) from public.service_contracts),'contracts_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.service_contracts c),
  'installations_count',(select count(*) from public.installations),'installations_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.installations c)),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'signature',p.oid::regprocedure::text,'securityDefiner',p.prosecdef,'owner',pg_get_userbyid(p.proowner),'authenticatedExec',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anonExec',has_function_privilege('anon',p.oid,'EXECUTE'),'serviceRoleExec',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname),'[]'::jsonb) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('discard_unfulfilled_client_prospect','guard_unfulfilled_prospect_discard','guard_discarded_prospect_child'))
);
rollback;
