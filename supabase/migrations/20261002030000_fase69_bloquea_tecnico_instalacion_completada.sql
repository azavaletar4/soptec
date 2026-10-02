-- SmartRayco — Fase 69: una instalacion 'completed' queda cerrada para el
-- tecnico — solo SUPERADMIN/ADMIN pueden seguir modificando materiales o
-- equipo de ahi en mas.
--
-- La Fase 46 ya bloqueaba a un tecnico no-admin de MOVER (quitar/reasignar)
-- un equipo que YA estuviera ligado a una instalacion completada — pero el
-- chequeo solo miraba `current_installation_id` (la instalacion a la que la
-- unidad pertenecia ANTES del cambio). Asignar una unidad NUEVA (que no
-- tenia instalacion todavia) directo a una instalacion ya completada no
-- disparaba ese chequeo: current_installation_id era null, asi que el
-- tecnico igual podia agregar equipo nuevo a una orden cerrada.
--
-- Los consumibles (inventory_movements, Fase 11) no tenian NINGUN candado
-- de este tipo — un tecnico asignado podia seguir registrando materiales
-- contra una instalacion completada sin restriccion.
--
-- Ambos casos quedan igual de cerrados ahora: si installation_id apunta a
-- una instalacion 'completed', solo SUPERADMIN/ADMIN pueden insertar. El
-- camino para corregir algo real es que un admin regrese el estado de la
-- instalacion (ej. a 'scheduled') para reabrirla.

create or replace function public.apply_inventory_unit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_status public.inventory_unit_status;
  current_installation_id uuid;
  installation_status public.installation_status;
begin
  select status, installation_id into current_status, current_installation_id
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
    -- Fase 69: ademas de "mover" equipo ya ligado (arriba), bloquea asignar
    -- equipo NUEVO directo a una instalacion que ya este completada.
    if new.installation_id is not null and new.installation_id is distinct from current_installation_id then
      select status into installation_status from public.installations where id = new.installation_id;
      if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
        raise exception 'La instalación ya fue completada; solo un administrador puede asignar equipo nuevo';
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

-- ---- Consumibles (Fase 11): mismo candado, no existia ninguno antes ----
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_stock numeric(12, 2);
  installation_status public.installation_status;
begin
  if new.installation_id is not null then
    select status into installation_status from public.installations where id = new.installation_id;
    if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada; solo un administrador puede registrar materiales nuevos';
    end if;
  end if;

  select current_stock into new_stock
  from public.inventory_products
  where id = new.product_id
  for update;

  if new.movement_type = 'ingreso' then
    new_stock := new_stock + new.quantity;
  else
    new_stock := new_stock - new.quantity;
    if new_stock < 0 then
      raise exception 'Stock insuficiente: quedarian % unidades', new_stock;
    end if;
  end if;

  new.balance_after := new_stock;

  update public.inventory_products
  set current_stock = new_stock, updated_at = now()
  where id = new.product_id;

  return new;
end;
$$;
