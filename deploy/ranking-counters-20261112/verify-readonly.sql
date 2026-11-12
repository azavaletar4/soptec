-- Verificacion posterior de SOLO LECTURA. No aplica ni revierte nada.
begin isolation level repeatable read read only;
set local search_path=public;
set local statement_timeout='15s';
select jsonb_build_object('read_only',current_setting('transaction_read_only'),
  'definition_matches_candidate',md5(pg_get_functiondef('public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure))='95d53cc0d5275132dae320fcf127a5fc',
  'definition_matches_backup',md5(pg_get_functiondef('public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure))='01290877f59ae43101b55a1a09d56691',
  'owner',(select pg_get_userbyid(proowner) from pg_proc where oid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure),
  'acl',(select proacl from pg_proc where oid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure),
  'helpers_unchanged',(select jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) from pg_proc p
    where p.oid in ('public.confirm_work_order_points(text,uuid,numeric,text,text,boolean)'::regprocedure,'public.get_technician_period_ranking(text,date)'::regprocedure,'public.get_technician_ranking(integer,integer)'::regprocedure,'public.technician_point_contributions(timestamp with time zone,timestamp with time zone)'::regprocedure,'public.technician_point_contributions_legacy(timestamp with time zone,timestamp with time zone)'::regprocedure,'public.work_order_point_review(text,uuid)'::regprocedure))='{"confirm_work_order_points(text,uuid,numeric,text,text,boolean)":"5d281c7c62db7e9c241ffcfda094e036","get_technician_period_ranking(text,date)":"e636f1003c107fc8ca8c4f8856bbe577","get_technician_ranking(integer,integer)":"c19b92fa0de607b1bc689d882a842e66","technician_point_contributions(timestamp with time zone,timestamp with time zone)":"5b564b59bc0ba7b7eb2a9af2980dac90","technician_point_contributions_legacy(timestamp with time zone,timestamp with time zone)":"fd6da116e41fb523dc75fd6080db6ce9","work_order_point_review(text,uuid)":"299989b6da2217ae055ec85fb318794f"}'::jsonb,
  'ticket_contributions',(select jsonb_agg(c) from public.technician_point_contributions('2026-11-06 05:00Z','2026-11-07 05:00Z') c
    where c.job_id=(select id from public.tickets where ticket_number='TCK-2026-00104')));
set local role service_role;
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'day',public.get_technician_period_ranking('day','2026-11-06'),
  'week',public.get_technician_period_ranking('week','2026-11-06'),
  'month',public.get_technician_period_ranking('month','2026-11-01'),
  'legacy_month',(select jsonb_agg(r) from public.get_technician_ranking(11,2026) r));
rollback;
