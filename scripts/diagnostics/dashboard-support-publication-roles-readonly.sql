-- SET LOCAL de identidad solo en transacciones READ ONLY que terminan en ROLLBACK.
begin read only;
select id::text as validation_uid from public.profiles where active and role='ADMIN' order by id limit 1 \gset
set local role authenticated;
set local request.jwt.claim.sub = :'validation_uid';
select jsonb_build_object('role',public.current_user_role(),'pendingWorks',(select count(*) from public.tickets where status::text in ('open','rescheduled'))+(select count(*) from public.routines where status::text in ('pending','scheduled'))+(select count(*) from public.installations where status::text in ('pending','scheduled')),'pendingClients',(select count(*) from public.clients c where exists(select 1 from public.installations i where i.client_id=c.id and i.status::text in ('pending','scheduled','in_progress'))));
rollback;
begin read only;
select id::text as validation_uid from public.profiles where active and role='SUPERADMIN' order by id limit 1 \gset
set local role authenticated;
set local request.jwt.claim.sub = :'validation_uid';
select jsonb_build_object('role',public.current_user_role(),'pendingWorks',(select count(*) from public.tickets where status::text in ('open','rescheduled'))+(select count(*) from public.routines where status::text in ('pending','scheduled'))+(select count(*) from public.installations where status::text in ('pending','scheduled')),'pendingClients',(select count(*) from public.clients c where exists(select 1 from public.installations i where i.client_id=c.id and i.status::text in ('pending','scheduled','in_progress'))));
rollback;
begin read only;
select jsonb_build_object('bodies',(select jsonb_object_agg(proname,md5(prosrc)) from pg_proc where pronamespace='public'::regnamespace and proname in ('discard_unfulfilled_client_prospect','guard_unfulfilled_prospect_discard','guard_discarded_prospect_child')),'discardedRows',(select count(*) from public.clients where prospect_discarded_at is not null),'read_only',current_setting('transaction_read_only'),'floatDigits',current_setting('extra_float_digits'),'activeRoles',(select jsonb_object_agg(role,amount) from (select role::text,count(*) as amount from public.profiles where active group by role)t));
rollback;
