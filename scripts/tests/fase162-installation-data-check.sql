-- SOLO LECTURA: guardar resultado ANTES y DESPUÉS en ventana sin operaciones.
-- No devuelve nombres, series, MAC, contratos ni filas individuales.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'products',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(jsonb_build_object('id',id,'stock',current_stock)::text,'' ORDER BY id),''))) FROM public.inventory_products),
 'units',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg((to_jsonb(x)-'routine_id'-'operation_id')::text,'' ORDER BY id),''))) FROM public.inventory_units x),
 'events',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg((to_jsonb(x)-'routine_id'-'operation_id')::text,'' ORDER BY id),''))) FROM public.inventory_unit_events x),
 'movements',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg((to_jsonb(x)-'routine_id'-'operation_id')::text,'' ORDER BY id),''))) FROM public.inventory_movements x),
 'historical_without_contract',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg((to_jsonb(x)-'routine_id'-'operation_id')::text,'' ORDER BY id),''))) FROM public.inventory_units x WHERE status='assigned' AND contract_id IS NULL),
 'routines',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(to_jsonb(x)::text,'' ORDER BY id),''))) FROM public.routines x),
 'linked_contracts',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(to_jsonb(x)::text,'' ORDER BY id),''))) FROM public.service_contracts x WHERE id IN (SELECT contract_id FROM public.inventory_units WHERE contract_id IS NOT NULL UNION SELECT contract_id FROM public.routines WHERE contract_id IS NOT NULL)),
 'crew',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(to_jsonb(x)::text,'' ORDER BY job_type,job_id,technician_id),''))) FROM public.job_assignees x)
);
ROLLBACK;
