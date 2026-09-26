-- Fase 40: cache de resumen/salud de la OLT, para que el panel cargue
-- instantaneo en vez de hacer Telnet en vivo en cada visita a la pantalla.
--
-- server/src/services/oltSyncService.ts llena esta tabla en segundo plano
-- (scheduler cada N minutos + boton "Actualizar ahora"). Los endpoints
-- GET /:id/summary, /:id/health y /:id/onts/unconfigured pasan a leer solo
-- de aqui (y de olt_onts para el status por ONT, que ya era cache).
--
-- Mismo criterio de seguridad que olt_devices/olt_onts (Fase 4): RLS
-- activado sin policies, acceso exclusivo desde el backend (service_role).

create table public.olt_sync_cache (
  olt_device_id     uuid primary key references public.olt_devices (id) on delete cascade,
  unconfigured      int not null default 0,
  online            int not null default 0,
  offline           int not null default 0,
  low_signal        int not null default 0,
  scan_complete     boolean not null default false,
  uptime_hours      numeric,
  uptime_raw        text,
  temperature       jsonb not null default '[]'::jsonb,
  load               jsonb not null default '[]'::jsonb,
  unconfigured_onts jsonb not null default '[]'::jsonb,
  checked_at        timestamptz,
  updated_at        timestamptz not null default now()
);

create trigger trg_olt_sync_cache_updated_at
  before update on public.olt_sync_cache
  for each row execute procedure public.set_updated_at();

alter table public.olt_sync_cache enable row level security;
-- Sin policies a proposito: solo el backend (service_role) la toca.

-- Bulk upsert real de estado/senal de ONTs en UNA sola llamada, en vez de un
-- UPDATE por fila (con ~675 ONTs, uno por uno hacia que el sync completo
-- tardara varios minutos solo en escritura a Supabase, aparte del tiempo de
-- Telnet). Solo actualiza filas que YA EXISTEN (no inserta) — el caller
-- (oltSyncService.ts) solo manda filas cuyo status/rx_power/tx_power
-- realmente cambio.
create or replace function public.bulk_update_ont_status_power(updates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.olt_onts o
  set status         = coalesce(u.status, o.status),
      rx_power       = coalesce(u.rx_power, o.rx_power),
      tx_power       = coalesce(u.tx_power, o.tx_power),
      last_synced_at = u.last_synced_at
  from jsonb_to_recordset(updates) as u(
    id uuid,
    status public.ont_status,
    rx_power numeric,
    tx_power numeric,
    last_synced_at timestamptz
  )
  where o.id = u.id;
end;
$$;
