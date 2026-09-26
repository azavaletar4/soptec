-- SmartRayco — Fase 37b: complementa la Fase 37 (servicios independientes).
--
-- inventory_units.contract_id ya existe (Fase 37), pero el Kardex
-- (inventory_unit_events) y su trigger apply_inventory_unit_event() todavia
-- no sabian de "contract_id" — igual que client_id/installation_id, tiene
-- que viajar en el evento para que el trigger lo aplique a la unidad de
-- forma atomica (mismo patron ya usado para esos dos campos).

alter table public.inventory_unit_events
  add column if not exists contract_id uuid references public.service_contracts (id) on delete set null;

create index if not exists idx_inventory_unit_events_contract on public.inventory_unit_events (contract_id) where contract_id is not null;

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
    status          = new.to_status,
    client_id       = case when new.to_status = 'assigned' then new.client_id else null end,
    contract_id     = case when new.to_status = 'assigned' then new.contract_id else null end,
    installation_id = case when new.to_status = 'assigned' then new.installation_id else null end,
    assigned_at     = case when new.to_status = 'assigned' then now() else assigned_at end,
    updated_at      = now()
  where id = new.unit_id;

  return new;
end;
$$;
