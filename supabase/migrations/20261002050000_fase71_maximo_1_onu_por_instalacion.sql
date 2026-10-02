-- SmartRayco — Fase 71: maximo 1 Modem/ONT/Router principal (categoria
-- 'onu') por instalacion. TV Box y Mesh/Repetidor no tienen este limite —
-- una instalacion puede necesitar 2+ TV Box o un repetidor ademas del
-- modem, pero nunca 2 ONTs.
--
-- El frontend (InstalacionesView.vue) ya saca la categoria 'onu' del
-- selector de producto en cuanto hay una asignada — esto es la proteccion
-- real por si se llama a la API directo. Reemplaza apply_inventory_unit_event
-- completo (Fase 46 + Fase 69) agregando el chequeo nuevo al final del
-- bloque "to_status = 'assigned'".

create or replace function public.apply_inventory_unit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_status public.inventory_unit_status;
  current_installation_id uuid;
  current_product_id uuid;
  installation_status public.installation_status;
  unit_category_slug text;
  existing_onu_count integer;
begin
  select status, installation_id, product_id into current_status, current_installation_id, current_product_id
  from public.inventory_units
  where id = new.unit_id
  for update;

  new.from_status := current_status;

  if current_status = 'retired' then
    raise exception 'El equipo esta dado de baja y no admite mas movimientos';
  end if;

  -- El equipo esta actualmente asignado a una instalacion ya completada
  -- (orden cerrada en campo): de aqui en mas es correccion administrativa.
  if current_installation_id is not null then
    select status into installation_status from public.installations where id = current_installation_id;
    if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada; solo un administrador puede corregir el equipo asignado';
    end if;
  end if;

  if new.to_status = 'assigned' then
    if new.client_id is null then
      raise exception 'Debe indicar el cliente al asignar un equipo';
    end if;
    if current_status is distinct from 'in_stock' then
      raise exception 'Solo se puede asignar un equipo que este en bodega (estado actual: %)', current_status;
    end if;

    -- Asignar equipo NUEVO directo a una instalacion que ya este completada
    -- (Fase 69).
    if new.installation_id is not null and new.installation_id is distinct from current_installation_id then
      select status into installation_status from public.installations where id = new.installation_id;
      if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
        raise exception 'La instalación ya fue completada; solo un administrador puede asignar equipo nuevo';
      end if;
    end if;

    -- Fase 71: maximo 1 equipo de categoria 'onu' por instalacion.
    if new.installation_id is not null then
      select ic.slug into unit_category_slug
      from public.inventory_products p
      left join public.inventory_categories ic on ic.id = p.category_id
      where p.id = current_product_id;

      if unit_category_slug = 'onu' then
        select count(*) into existing_onu_count
        from public.inventory_units u
        join public.inventory_products p2 on p2.id = u.product_id
        join public.inventory_categories ic2 on ic2.id = p2.category_id
        where u.installation_id = new.installation_id
          and u.status = 'assigned'
          and ic2.slug = 'onu';

        if existing_onu_count > 0 then
          raise exception 'Solo se puede asignar 1 ONT/Módem por instalación. Si te equivocaste de serie, quita el equipo actual antes de agregar uno nuevo.';
        end if;
      end if;
    end if;
  end if;

  update public.inventory_units
  set
    status          = new.to_status,
    client_id       = case when new.to_status = 'assigned' then new.client_id else null end,
    installation_id = case when new.to_status = 'assigned' then new.installation_id else null end,
    assigned_at     = case when new.to_status = 'assigned' then now() else assigned_at end,
    updated_at      = now()
  where id = new.unit_id;

  return new;
end;
$$;
