-- Revierte 20261020120000_fase165_entrega_material_validada.sql.
-- Rollback "de comportamiento, no de datos": restaura
-- deliver_material_to_technician a su firma y cuerpo originales (4
-- argumentos, sin operation_id ni validacion de stock) y elimina la version
-- nueva (5 argumentos) + la tabla material_delivery_operations. Las
-- entregas ya registradas (Kardex, technician_material_custody_events)
-- NUNCA se tocan -- son insert-only, igual que el resto de Fase 165.
--
-- Guarda MD5: aborta si la funcion de 5 argumentos realmente aplicada
-- difiere de la revisada en el candidato (confirmado 2026-10-20, sin
-- drift) -- evita revertir sobre una version que ya cambio por otra via.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.deliver_material_to_technician(uuid,uuid,uuid,numeric,text)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='78f920192a1d04b5bc3f21ae08f01b81') then
  raise exception 'La version de 5 argumentos difiere de la aplicada por el candidato; detener y comparar antes de revertir';
 end if;
end $$;

drop function public.deliver_material_to_technician(uuid, uuid, uuid, numeric, text);

create function public.deliver_material_to_technician(p_technician_id uuid, p_product_id uuid, p_quantity numeric, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.inventory_products;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo administracion puede entregar material a un tecnico';
  end if;
  if not exists(select 1 from public.profiles where id = p_technician_id and active and role = 'TECNICO_RED') then
    raise exception 'El destinatario debe ser un tecnico de red activo';
  end if;
  select * into p from public.inventory_products where id = p_product_id for share;
  if not found or not p.is_active or p.is_serialized then
    raise exception 'Producto consumible activo requerido';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity, 2) then
    raise exception 'Cantidad positiva con hasta dos decimales requerida';
  end if;
  insert into public.technician_material_custody_events(technician_id, product_id, event_type, quantity, reason)
  values (p_technician_id, p_product_id, 'delivery', p_quantity, coalesce(nullif(btrim(p_reason), ''), 'Entrega a tecnico'));
end $$;
revoke all on function public.deliver_material_to_technician(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.deliver_material_to_technician(uuid, uuid, numeric, text) to authenticated;

-- Inerte tras el rollback (ninguna funcion viva vuelve a leerla); se
-- elimina en vez de dejarla huerfana porque, a diferencia de
-- material_inventory_rejections, no tiene valor de auditoria independiente
-- sin la funcion que la escribe.
drop table public.material_delivery_operations;
commit;
