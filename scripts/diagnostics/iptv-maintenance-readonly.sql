-- Preflight fijo. Sin RPCs, nombres de clientes, payloads o consultas de otras sesiones.
begin transaction isolation level repeatable read read only;
with orders as (
 select 'installation'::text kind,id,status::text status,created_at,updated_at from public.installations
 union all select 'ticket',id,status::text,created_at,updated_at from public.tickets
 union all select 'routine',id,status::text,created_at,updated_at from public.routines
), open_orders as (
 select * from orders where (kind in ('installation','routine') and status in ('pending','scheduled','in_progress'))
 or (kind='ticket' and status in ('open','in_progress','rescheduled'))
), incomplete as (
 select 'campo'::text source,id,job_type kind,job_id,action,created_at
 from public.campo_inventory_operations where result is null or result='null'::jsonb
 union all select 'routine',id,'routine',routine_id,action,created_at
 from public.routine_inventory_operations where result is null or result='null'::jsonb
), sessions as (
 select s.id,s.job_type,s.job_id,s.started_at,o.status from public.job_work_sessions s
 left join orders o on o.kind=s.job_type and o.id=s.job_id where s.ended_at is null
), rejected as (
 select r.operation_id,r.job_type,r.job_id,r.created_at,o.status order_status,
 exists(select 1 from open_orders a where a.kind=r.job_type and a.id=r.job_id) on_open_order
 from public.material_inventory_rejections r left join orders o on o.kind=r.job_type and o.id=r.job_id
 where r.status='pending'
)
select jsonb_build_object(
 'checkedAt',clock_timestamp(),'readOnly',current_setting('transaction_read_only'),
 'snapshotOnly',true,'mobileStorageVisible',false,
 'orderCounts',(select jsonb_agg(x order by kind,status) from (select kind,status,count(*) count from orders group by kind,status)x),
 'inProgressCount',(select count(*) from orders where status='in_progress'),
 'inProgressSample',(select coalesce(jsonb_agg(x),'[]') from (select kind,id,status,updated_at from orders where status='in_progress' order by kind,id limit 30)x),
 'openOrderCount',(select count(*) from open_orders),
 'openOrderSample',(select coalesce(jsonb_agg(x),'[]') from (select kind,id,status,updated_at from open_orders order by kind,id limit 30)x),
 'openWorkSessionCount',(select count(*) from sessions),
 'openWorkSessionSample',(select coalesce(jsonb_agg(x),'[]') from (select * from sessions order by started_at limit 30)x),
 'incompleteReceiptCount',(select count(*) from incomplete),
 'incompleteReceiptSample',(select coalesce(jsonb_agg(x),'[]') from (select * from incomplete order by created_at limit 30)x),
 'pendingMaterialRejections',jsonb_build_object('onOpenOrders',(select count(*) from rejected where on_open_order),'onClosedOrMissingOrders',(select count(*) from rejected where not on_open_order)),
 'pendingMaterialRejectionsSample',(select coalesce(jsonb_agg(x),'[]') from (select * from rejected order by on_open_order desc,created_at limit 30)x),
 'pendingFieldUnits',(select coalesce(jsonb_agg(x),'[]') from (select u.status::text status,count(*) count from public.inventory_units u
  where u.status::text in ('pending_approval','pending_return') and (u.installation_id is not null or u.ticket_id is not null or u.routine_id is not null) group by u.status)x),
 'pendingFieldUnitDetails',(select coalesce(jsonb_agg(x),'[]') from (
  select u.id,u.status::text status,u.installation_id,u.ticket_id,u.routine_id,
   i.status::text installation_status,t.status::text ticket_status,r.status::text routine_status,u.updated_at
  from public.inventory_units u left join public.installations i on i.id=u.installation_id
   left join public.tickets t on t.id=u.ticket_id left join public.routines r on r.id=u.routine_id
  where u.status::text in ('pending_approval','pending_return') and (u.installation_id is not null or u.ticket_id is not null or u.routine_id is not null)
  order by u.updated_at limit 30)x),
 'activeFieldStatements',(select count(*) from pg_stat_activity a where a.datname=current_database() and a.pid<>pg_backend_pid() and a.state='active'
  and a.query ~* '(campo_inventory_operation|routine_inventory_operation|installations|job_work_sessions|material_inventory_rejections)'),
 'openFieldTransactions',(select count(*) from pg_stat_activity a where a.datname=current_database() and a.pid<>pg_backend_pid() and a.xact_start is not null
  and a.state in ('active','idle in transaction','idle in transaction (aborted)')
  and a.query ~* '(campo_inventory_operation|routine_inventory_operation|installations|job_work_sessions|material_inventory_rejections)'),
 'fieldWriteOrRowLocks',(select count(*) from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('installations','tickets','routines','campo_inventory_operations','routine_inventory_operations','inventory_units')
  and l.granted and l.mode in ('RowShareLock','RowExclusiveLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock') and l.pid<>pg_backend_pid()),
 'waitingFieldLocks',(select count(*) from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('installations','tickets','routines','campo_inventory_operations','routine_inventory_operations','inventory_units')
  and not l.granted and l.pid<>pg_backend_pid()),
 'iptvColumnsPresent',exists(select 1 from information_schema.columns where table_schema='public' and table_name='installations' and column_name='iptv_policy_version'),
 'completionBodyMd5',(select md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^'||chr(10)||']*','','g'),'[[:space:]]','','g'))
  from pg_proc where oid=to_regprocedure('public.validate_installation_completion()'))
);
rollback;
