-- SmartRayco — Fase 72: extiende el limite de 1 Modem/ONT (Fase 71, por
-- instalacion) a la ficha de servicio del cliente, acotado por
-- CONTRATO/linea — un cliente puede tener varios contratos y cada uno su
-- propio ONT, pero nunca 2 en la misma linea.
--
-- ClientServiceDetailView.vue tiene 3 caminos para que un equipo termine
-- "assigned" a un contrato, y ninguno pasaba por el chequeo de Fase 71
-- (que solo miraba installation_id):
--   1. "+ Agregar equipo" / "buscar en bodega": insertan en
--      inventory_unit_events (to_status='assigned', contract_id=X,
--      installation_id=null) — no disparaba el chequeo viejo.
--   2. "Vincular un equipo del cliente..." (reasignar entre lineas del
--      MISMO cliente): es un UPDATE directo de inventory_units.contract_id
--      (setUnitContract), NI SIQUIERA pasa por inventory_unit_events —
--      necesita su propio trigger.

-- ---- 1) apply_inventory_unit_event: suma el chequeo por contract_id ----
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

    if new.installation_id is not null and new.installation_id is distinct from current_installation_id then
      select status into installation_status from public.installations where id = new.installation_id;
      if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
        raise exception 'La instalación ya fue completada; solo un administrador puede asignar equipo nuevo';
      end if;
    end if;

    select ic.slug into unit_category_slug
    from public.inventory_products p
    left join public.inventory_categories ic on ic.id = p.category_id
    where p.id = current_product_id;

    if unit_category_slug = 'onu' then
      -- Fase 71: maximo 1 por instalacion.
      if new.installation_id is not null then
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

      -- Fase 72: maximo 1 por contrato/linea (cubre asignar desde la ficha
      -- del cliente, que no siempre trae installation_id).
      if new.contract_id is not null then
        select count(*) into existing_onu_count
        from public.inventory_units u
        join public.inventory_products p2 on p2.id = u.product_id
        join public.inventory_categories ic2 on ic2.id = p2.category_id
        where u.contract_id = new.contract_id
          and u.status = 'assigned'
          and ic2.slug = 'onu';
        if existing_onu_count > 0 then
          raise exception 'Solo se puede asignar 1 ONT/Módem por línea. Si te equivocaste, quita el equipo actual de esta línea antes de agregar uno nuevo.';
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

-- ---- 2) Reasignar un equipo YA asignado a otra linea del mismo cliente
-- ("Vincular un equipo del cliente...", setUnitContract): es un UPDATE
-- directo de contract_id, no pasa por inventory_unit_events — necesita su
-- propio candado.
create or replace function public.guard_inventory_units_onu_limit_on_contract_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  unit_category_slug text;
  existing_onu_count integer;
begin
  if new.contract_id is not null and new.contract_id is distinct from old.contract_id and new.status = 'assigned' then
    select ic.slug into unit_category_slug
    from public.inventory_products p
    left join public.inventory_categories ic on ic.id = p.category_id
    where p.id = new.product_id;

    if unit_category_slug = 'onu' then
      select count(*) into existing_onu_count
      from public.inventory_units u
      join public.inventory_products p2 on p2.id = u.product_id
      join public.inventory_categories ic2 on ic2.id = p2.category_id
      where u.contract_id = new.contract_id
        and u.status = 'assigned'
        and ic2.slug = 'onu'
        and u.id <> new.id;

      if existing_onu_count > 0 then
        raise exception 'Solo se puede asignar 1 ONT/Módem por línea. Si te equivocaste, quita el equipo actual de esta línea antes de vincular uno nuevo.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_units_onu_limit_on_contract_update on public.inventory_units;
create trigger trg_inventory_units_onu_limit_on_contract_update
  before update of contract_id on public.inventory_units
  for each row execute procedure public.guard_inventory_units_onu_limit_on_contract_update();
