-- NO EJECUTADO. Revierte exclusivamente 20261016220000_inventario_contextual_rls_admin.sql
-- a lo que esta sesion encontro realmente en Cloud por solo lectura el 17/10/2026
-- (mzupdnjegfwmpajywckd), antes de proponer esta migracion. Usar solo si, tras
-- aplicarla, el despliegue del frontend/backend compatible falla o se detiene y
-- un tecnico en campo queda sin poder leer/registrar inventario de su orden.
-- No borra ninguna fila de inventory_movements/inventory_unit_events/
-- campo_inventory_operations — revierte permisos y las dos funciones nuevas,
-- nunca datos.
begin;

drop function if exists public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text);
drop function if exists public.inventory_ticket_review(uuid,text,uuid,text,jsonb);

do $$
declare relation text; policy_name text;
begin
 foreach relation in array array['inventory_products','inventory_categories','inventory_units','inventory_movements','inventory_unit_events'] loop
  for policy_name in select policyname from pg_policies where schemaname='public' and tablename=relation loop
   execute format('drop policy %I on public.%I',policy_name,relation);
  end loop;
 end loop;
end $$;

-- Las 10 politicas reales exactas, capturadas en Cloud el 17/10/2026 antes de
-- proponer el cierre (pg_policies.qual/with_check/roles/cmd, sin reinterpretar).
create policy inventory_products_staff_only on public.inventory_products for all to authenticated
 using (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]))
 with check (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));

create policy inventory_categories_staff_only on public.inventory_categories for all to authenticated
 using (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]))
 with check (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));

create policy inventory_movements_staff_select on public.inventory_movements for select to authenticated
 using (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));
create policy inventory_movements_staff_insert on public.inventory_movements for insert to authenticated
 with check (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));

create policy inventory_unit_events_staff_select on public.inventory_unit_events for select to authenticated
 using (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));
create policy inventory_unit_events_staff_insert on public.inventory_unit_events for insert to authenticated
 with check (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));

create policy inventory_units_select_staff on public.inventory_units for select to authenticated
 using (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));
create policy inventory_units_insert_staff on public.inventory_units for insert to authenticated
 with check (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));
create policy inventory_units_update_staff on public.inventory_units for update to authenticated
 using (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]))
 with check (current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::user_role[]));
create policy inventory_units_delete_staff on public.inventory_units for delete to authenticated
 using (current_user_role() = 'SUPERADMIN'::user_role);

-- inventory_get_albums: cuerpo y grants exactos capturados en Cloud (sql, no
-- plpgsql; EXECUTE abierto a anon/authenticated/service_role/PUBLIC como ya
-- estaba, sin el guard de rol nuevo).
create or replace function public.inventory_get_albums()
 returns table(album_slug text, album_name text, icon text, color text, sort_order integer, item_count bigint, low_stock bigint, total_value numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  select
    c.slug, c.name, c.icon, c.color, c.sort_order,
    coalesce(count(distinct p.id) filter (where p.id is not null and not p.is_serialized), 0)
      + coalesce(sum(u_counts.in_stock_count) filter (where p.is_serialized), 0) as item_count,
    coalesce(count(*) filter (where not p.is_serialized and p.current_stock <= p.min_stock), 0) as low_stock,
    coalesce(sum(case when p.is_serialized
      then u_counts.in_stock_count * p.price
      else p.current_stock * p.price end), 0) as total_value
  from public.inventory_categories c
  left join public.inventory_products p on p.category_id = c.id and p.is_active
  left join lateral (
    select count(*) as in_stock_count
    from public.inventory_units iu
    where iu.product_id = p.id and iu.status = 'in_stock'
  ) u_counts on p.is_serialized
  where c.is_active
  group by c.slug, c.name, c.icon, c.color, c.sort_order
  union all
  select 'por_recoger','Equipos por Recoger','🔄','rose',98,count(*),0::bigint,coalesce(sum(p.price), 0)
  from public.inventory_units iu
  join public.inventory_products p on p.id = iu.product_id
  where iu.status = 'en_recupero'
  union all
  select 'averiados','Averiados / En Reparación','🛠️','amber',99,count(*),0::bigint,coalesce(sum(p.price), 0)
  from public.inventory_units iu
  join public.inventory_products p on p.id = iu.product_id
  where iu.status in ('damaged', 'in_repair', 'retired')
  order by sort_order;
$function$;
revoke all on function public.inventory_get_albums() from public,anon,authenticated,service_role;
grant execute on function public.inventory_get_albums() to public,anon,authenticated,service_role;

commit;
