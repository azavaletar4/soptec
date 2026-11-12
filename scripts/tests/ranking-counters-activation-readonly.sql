begin isolation level repeatable read read only;
set local statement_timeout='10s';
select jsonb_build_object(
 'read_only',current_setting('transaction_read_only'), 'as_of',now(),
 'database',current_database(),'session_role',current_user,
 'functions',(select jsonb_agg(jsonb_build_object(
   'oid',p.oid,'signature',p.oid::regprocedure::text,'name',p.proname,
   'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'language',l.lanname,
   'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
   'volatility',p.provolatile,'security_definer',p.prosecdef,'strict',p.proisstrict,
   'parallel',p.proparallel,'leakproof',p.proleakproof,'config',p.proconfig,
   'cost',p.procost,'rows',p.prorows,'body_md5',md5(p.prosrc),
   'definition_md5',md5(pg_get_functiondef(p.oid)), 'definition',pg_get_functiondef(p.oid),
   'comment',obj_description(p.oid,'pg_proc'),
   'effective_acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
     'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
     'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantor,a.grantee,a.privilege_type)
     from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
 ) order by p.proname) from pg_proc p join pg_language l on l.oid=p.prolang
 where p.pronamespace='public'::regnamespace and p.proname in
   ('technician_ranking_between','technician_point_contributions','technician_point_contributions_legacy',
    'get_technician_ranking','get_technician_period_ranking','confirm_work_order_points','work_order_point_review')),
 'dependencies',(select coalesce(jsonb_agg(jsonb_build_object(
   'class',d.classid::regclass::text,'object_id',d.objid,'sub_id',d.objsubid,
   'ref_class',d.refclassid::regclass::text,'ref_id',d.refobjid,'ref_sub_id',d.refobjsubid,'type',d.deptype)
   order by d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]')
 from pg_depend d where (d.classid='pg_proc'::regclass and d.objid='public.technician_ranking_between(timestamptz,timestamptz)'::regprocedure)
   or (d.refclassid='pg_proc'::regclass and d.refobjid='public.technician_ranking_between(timestamptz,timestamptz)'::regprocedure)),
 'body_callers',(select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]') from pg_proc p
   where p.pronamespace='public'::regnamespace and p.prokind='f' and p.prosrc like '%technician_ranking_between(%'),
 'credited_ticket_categories',(select jsonb_agg(x) from (select c.category,count(distinct c.job_id) as orders,count(*) as work_rows
   from public.technician_point_contributions('2026-11-01 05:00Z','2026-12-01 05:00Z') c
   where c.kind='work' and c.job_type='ticket' group by c.category order by c.category)x),
 'other_tickets',(select jsonb_agg(x order by x.ticket_number) from (
   select t.id,t.ticket_number,t.status,t.category,t.points,t.assigned_to,t.resolved_at,t.closed_at,
     to_jsonb(t)->>'title' as title,to_jsonb(t)->>'description' as description,
     to_jsonb(t)->>'motivo_averia' as motivo_averia,to_jsonb(t)->>'resolution_notes' as resolution_notes,
     c.technical_completed_at,c.confirmed_at,c.category as frozen_category,c.crew
   from public.work_order_point_confirmations c join public.tickets t on c.job_type='ticket' and c.job_id=t.id
   where c.category='other' and c.confirmed_at>='2026-11-01 05:00Z' and c.confirmed_at<'2026-12-01 05:00Z'
     and c.technical_completed_at>='2026-11-01 05:00Z'
 ) x)
);
set local role service_role;
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'ranking',public.get_technician_period_ranking('month','2026-11-01'));
rollback;
