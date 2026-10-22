-- PREPARADO, NO EJECUTADO EN PRODUCCION. psql -X -v ON_ERROR_STOP=1
-- Variables obligatorias: rollback_path y snapshot_path (rutas locales privadas).
-- Genera rollback EXACTO de las funciones vigentes; nunca usar una copia de migracion antigua.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin isolation level repeatable read read only;
select 'public.request_material_return(uuid,numeric,text)'::regprocedure,
       'public.my_inventory_custody()'::regprocedure;
\o :rollback_path
select '-- Respaldo de definiciones; restaurar solo con autorizacion. Sin cambios de datos.';
select 'begin; set local lock_timeout = ''5s''; set local statement_timeout = ''30s'';';
select pg_get_functiondef(oid) || ';' from pg_proc
where oid in ('public.request_material_return(uuid,numeric,text)'::regprocedure,
              'public.my_inventory_custody()'::regprocedure) order by oid;
select 'commit;';
\o :snapshot_path
select jsonb_build_object('captured_at',now(),'database',current_database(),
  'functions',(select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,
    'definition',pg_get_functiondef(oid),'owner',pg_get_userbyid(proowner),'acl',proacl,
    'config',proconfig,'security_definer',prosecdef) order by oid) from pg_proc
    where oid in ('public.request_material_return(uuid,numeric,text)'::regprocedure,
                  'public.my_inventory_custody()'::regprocedure)),
  'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.technician_material_return_requests r),
  'custody',(select coalesce(jsonb_agg(to_jsonb(c) order by technician_id,product_id),'[]') from public.technician_material_custody c),
  'material_events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.technician_material_custody_events e),
  'units',(select coalesce(jsonb_agg(to_jsonb(u) order by id),'[]') from public.inventory_units u),
  'unit_events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.inventory_unit_events e),
  'products',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.inventory_products p),
  'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from public.inventory_movements m));
\o
commit;
