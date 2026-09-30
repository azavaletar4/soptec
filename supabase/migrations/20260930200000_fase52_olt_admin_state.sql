-- Fase 52: distinguir "deshabilitado manualmente" (admin-state=disable real
-- en la OLT) de offline/unreachable, para la pestana "Deshabilitadas /
-- Cortadas" del panel OLT. NO reemplaza ni toca el corte por mora
-- (service_contracts.debt_hold_status), que sigue siendo throttle de ancho de
-- banda via changeOntProfileCommands — decision tomada con el usuario de no
-- migrarlo a admin-state.

alter table public.olt_onts
  add column admin_state text not null default 'enable'
    check (admin_state in ('enable', 'disable'));

comment on column public.olt_onts.admin_state is
  'Reflejo del admin-state real en la OLT (onu <id> admin-state enable|disable), actualizado por runOltFullSync y por activate/deactivate manual. Distinto de status (online/offline/unknown = estado operativo/enlace).';

-- Contador barato para la tarjeta resumen "Deshabilitadas" (mismo patron que
-- "unconfigured" de la Fase 40) — evita un COUNT(*) en cada GET /summary.
alter table public.olt_sync_cache
  add column disabled int not null default 0;

-- Amplia el bulk upsert del sync en background (Fase 40) para que tambien
-- pueda tocar admin_state en la misma llamada.
create or replace function public.bulk_update_ont_status_power(updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.olt_onts o
  set status         = coalesce(u.status, o.status),
      admin_state    = coalesce(u.admin_state, o.admin_state),
      rx_power       = coalesce(u.rx_power, o.rx_power),
      tx_power       = coalesce(u.tx_power, o.tx_power),
      last_synced_at = u.last_synced_at
  from jsonb_to_recordset(updates) as u(
    id uuid,
    status public.ont_status,
    admin_state text,
    rx_power numeric,
    tx_power numeric,
    last_synced_at timestamptz
  )
  where o.id = u.id;
end;
$$;
