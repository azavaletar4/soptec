-- SmartRayco — Fase 51d: mientras un equipo esta "Por Recoger" (en_recupero),
-- conservar el vinculo al cliente en inventory_units.client_id.
--
-- El trigger de Fase 11c limpiaba client_id apenas el estado dejaba de ser
-- 'assigned' (pensado para damaged/in_repair/retired, donde el equipo ya
-- esta de vuelta en bodega y el cliente deja de ser relevante). Pero
-- 'en_recupero' (Fase 51) es distinto: el equipo TODAVIA esta en casa del
-- cliente, pendiente de que el tecnico vaya a recogerlo — sin el client_id
-- en la unidad, ni el tecnico ni el administrador podian ver desde la
-- bandeja "Equipos por Recoger" a que cliente pertenece cada equipo.
--
-- Al pasar de 'en_recupero' a cualquier otro estado (in_stock/damaged/
-- in_repair/retired, ya con el equipo fisicamente en bodega), client_id
-- se limpia igual que siempre.
--
-- Idempotente: permite re-ejecutar sin error si ya se corrio antes.

create or replace function public.apply_inventory_unit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_status public.inventory_unit_status;
begin
  select status into current_status
  from public.inventory_units
  where id = new.unit_id
  for update;

  new.from_status := current_status;

  if current_status = 'retired' then
    raise exception 'El equipo esta dado de baja y no admite mas movimientos';
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
    status            = new.to_status,
    client_id         = case when new.to_status in ('assigned', 'en_recupero') then new.client_id else null end,
    installation_id   = case when new.to_status = 'assigned' then new.installation_id else null end,
    assigned_at       = case when new.to_status = 'assigned' then now() else assigned_at end,
    pending_pickup_by = case when new.to_status = 'en_recupero' then new.assigned_to else null end,
    updated_at        = now()
  where id = new.unit_id;

  return new;
end;
$$;
