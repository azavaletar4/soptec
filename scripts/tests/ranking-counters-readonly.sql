begin read only;
set local statement_timeout='10s';
select jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'ticket',(select jsonb_agg(x) from (select id,ticket_number,status,category,assigned_to,points,resolved_at,closed_at from public.tickets where ticket_number='TCK-2026-00104')x),
 'confirmation',(select jsonb_agg(x) from (select c.job_type,c.job_id,c.category,c.points,c.technical_completed_at,c.confirmed_at,c.invalidated_at,c.crew from public.work_order_point_confirmations c join public.tickets t on c.job_type='ticket' and c.job_id=t.id where t.ticket_number='TCK-2026-00104')x),
 'functions',(select jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid))) from pg_proc where pronamespace='public'::regnamespace and proname in ('get_technician_ranking','get_technician_period_ranking','technician_ranking_between','technician_point_contributions')),
 'contributions',(select jsonb_agg(c) from public.technician_point_contributions('2026-11-01 05:00Z','2026-12-01 05:00Z') c)
);
set local role service_role;
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'ranking',public.get_technician_period_ranking('month','2026-11-01'));
rollback;
