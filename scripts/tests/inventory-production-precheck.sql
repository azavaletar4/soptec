BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
 'checkedAt',clock_timestamp(),'read_only',current_setting('transaction_read_only'),
 'projectUserCorrect',current_user='postgres','databaseCorrect',current_database()='postgres',
 'fase162Present',to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)') IS NOT NULL AND to_regclass('public.routine_inventory_operations') IS NOT NULL,
 'stage3Absent',to_regclass('public.campo_inventory_operations') IS NULL AND to_regprocedure('public.campo_inventory_operation(uuid,text,uuid,text,jsonb)') IS NULL,
 'closedRlsAbsent',NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='inventory_admin_only'),
 'contextualRpcAbsent',to_regprocedure('public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)') IS NULL,
 'openFieldSessions',(SELECT count(*) FROM public.job_work_sessions WHERE ended_at IS NULL),
 'inProgressJobs',jsonb_build_object(
  'installations',(SELECT count(*) FROM public.installations WHERE status::text='in_progress'),
  'tickets',(SELECT count(*) FROM public.tickets WHERE status::text='in_progress'),
  'routines',(SELECT count(*) FROM public.routines WHERE status::text='in_progress')),
 'activeInventoryLocks',(SELECT count(*) FROM pg_locks WHERE pid<>pg_backend_pid() AND relation IN(
  'public.inventory_products'::regclass,'public.inventory_units'::regclass,'public.inventory_movements'::regclass,'public.inventory_unit_events'::regclass,
  'public.installations'::regclass,'public.tickets'::regclass,'public.routines'::regclass,'public.job_assignees'::regclass)
  AND mode<>'AccessShareLock'),
 'openClientTransactions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend' AND xact_start IS NOT NULL),
 'inventoryCounts',jsonb_build_object('products',(SELECT count(*) FROM public.inventory_products),'units',(SELECT count(*) FROM public.inventory_units),'movements',(SELECT count(*) FROM public.inventory_movements),'events',(SELECT count(*) FROM public.inventory_unit_events)),
 'inventoryLastWrite',greatest((SELECT max(updated_at) FROM public.inventory_products),(SELECT max(updated_at) FROM public.inventory_units),(SELECT max(created_at) FROM public.inventory_movements),(SELECT max(created_at) FROM public.inventory_unit_events)),
 'fase162RpcMd5',(SELECT md5(pg_get_functiondef(to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)')))),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN('inventory_products','inventory_categories','inventory_units','inventory_movements','inventory_unit_events')),
 'albumsDefinitionMd5',(SELECT md5(pg_get_functiondef(to_regprocedure('public.inventory_get_albums()')))),
 'albumsGrants',(SELECT proacl FROM pg_proc WHERE oid=to_regprocedure('public.inventory_get_albums()'))
);
ROLLBACK;
