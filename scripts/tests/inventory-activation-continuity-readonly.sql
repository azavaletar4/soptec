BEGIN READ ONLY;
SELECT json_build_object(
 'checkedAt',clock_timestamp(), 'read_only',current_setting('transaction_read_only'),
 'fase162',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='routine_inventory_operation') AND to_regclass('public.routine_inventory_operations') IS NOT NULL,
 'stage3Table',to_regclass('public.campo_inventory_operations') IS NOT NULL,
 'stage3Rpc',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='campo_inventory_operation'),
 'closedRls',EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='inventory_admin_only'),
 'contextualRpc',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='inventory_order_read'),
 'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN('inventory_products','inventory_categories','inventory_movements','inventory_units','inventory_unit_events'))
);
ROLLBACK;
