-- SmartRayco — Fase 46: bloqueo de equipo (serie/MAC) de instalaciones ya
-- completadas.
--
-- La instalacion se hace en campo: mientras esta abierta, el tecnico debe
-- poder corregir un equipo mal elegido (quitarlo/reasignar el correcto) sin
-- fricciones. Una vez que la orden se marca 'completed' queda cerrada — de
-- ahi en adelante solo SUPERADMIN/ADMIN pueden seguir moviendo ese equipo
-- (correccion administrativa), y esa correccion ya queda registrada sola:
-- inventory_unit_events (Fase 11c) es un Kardex insert-only con created_by/
-- reason/created_at, asi que reusarlo como via de correccion YA es el
-- "registro de cambios" pedido, sin tablas nuevas.
--
-- Idempotente: permite re-ejecutar el archivo completo sin error si una
-- corrida anterior ya creo parte de estos objetos.

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
