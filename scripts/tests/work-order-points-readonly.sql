begin read only;
set local statement_timeout='10s';
select jsonb_build_object('read_only',current_setting('transaction_read_only'),
 'tickets', (select jsonb_agg(x) from (select category,status,count(*) as orders,
 count(*) filter(where points=0) as zero_points,count(*) filter(where points is null) as null_points
 from public.tickets group by category,status) x),
 'routines',(select jsonb_agg(x) from (select status,count(*) as orders,
 count(*) filter(where points=0) as zero_points,count(*) filter(where points is null) as null_points
 from public.routines group by status) x),
 'installation_points_column',exists(select 1 from information_schema.columns where table_schema='public' and table_name='installations' and column_name='points'),
 'scoring_functions',(select jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid))) from pg_proc
 where pronamespace='public'::regnamespace and proname in ('get_technician_ranking','technician_point_contributions')));
rollback;
