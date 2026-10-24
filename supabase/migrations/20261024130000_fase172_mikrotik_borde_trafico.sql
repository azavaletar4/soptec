-- Fase 172: monitoreo de trafico para el MikroTik de borde DEDICADO
-- (device_role='borde_dedicado', Fase 171). El balanceador y el
-- administrador PPPoE no se ven afectados por esta migracion -- las
-- columnas nuevas quedan en null/default hasta que un admin las configure
-- desde el panel para un router de borde dedicado especifico.
--
-- Config por router (solo estadisticas/alertas -- NUNCA cambia queues,
-- perfiles, rutas ni VLANs reales):
--   - monitored_interface_name: interfaz que recibe la linea del proveedor
--     (ej. "VLAN-236"). RX de esa interfaz = descarga, TX = subida.
--   - uplink_interface_name: interfaz de salida hacia el MikroTik
--     administrador (ej. "VLAN-4000") -- solo para etiquetar en pantalla,
--     JAMAS se suma a la de entrada (transportan casi el mismo trafico en
--     sentidos opuestos).
--   - capacity_download_mbps / capacity_upload_mbps: capacidad contratada,
--     editable por ADMIN/SUPERADMIN, usada solo para el % de uso y las
--     alertas de saturacion.
alter table public.mikrotik_devices
  add column monitored_interface_name text,
  add column uplink_interface_name text,
  add column capacity_download_mbps numeric not null default 500,
  add column capacity_upload_mbps numeric not null default 500;

alter table public.mikrotik_devices
  add constraint mikrotik_devices_capacity_positive_check
  check (capacity_download_mbps > 0 and capacity_upload_mbps > 0);

-- Historial de trafico YA CONVERTIDO A DELTA/BPS (nunca se reinterpretan
-- contadores acumulados en el frontend) -- mismo espiritu que
-- mikrotik_traffic_samples (Fase 36), pero por INTERFAZ DE ROUTER, no por
-- contrato/PPPoE (un borde no tiene contratos ni usuarios PPPoE).
create table public.mikrotik_interface_samples (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.mikrotik_devices(id) on delete cascade,
  interface_name   text not null,
  sampled_at       timestamptz not null default now(),
  interval_seconds int not null,
  rx_bytes         bigint not null default 0, -- delta del intervalo (descarga)
  tx_bytes         bigint not null default 0, -- delta del intervalo (subida)
  rx_bps           bigint not null default 0,
  tx_bps           bigint not null default 0,
  -- false = no se pudo leer el router en este ciclo (perdida de monitoreo,
  -- NUNCA se interpreta como "enlace caido" -- ver mikrotikBorderTraffic.ts).
  online           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index idx_mikrotik_interface_samples_device_time
  on public.mikrotik_interface_samples (device_id, interface_name, sampled_at desc);

-- Ultimo contador crudo leido del router, para calcular el delta del
-- siguiente ciclo (igual criterio que mikrotik_traffic_counters_state,
-- Fase 36: si el contador actual es menor al guardado, se asume
-- reinicio/reconexion y se usa el valor crudo como delta).
create table public.mikrotik_interface_counters_state (
  device_id      uuid not null references public.mikrotik_devices(id) on delete cascade,
  interface_name text not null,
  last_rx_bytes  bigint not null default 0,
  last_tx_bytes  bigint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (device_id, interface_name)
);

create trigger trg_mikrotik_interface_counters_state_updated_at
  before update on public.mikrotik_interface_counters_state
  for each row execute procedure public.set_updated_at();

-- Saturacion (>=85% sostenido >=5 min, Fase 172): activo/resuelto, nunca se
-- borra -- queda como registro de cuando se recupero. El indice unico sobre
-- status='active' es lo que evita alertas duplicadas por la misma
-- direccion mientras siga activa.
create table public.mikrotik_saturation_alerts (
  id              uuid primary key default gen_random_uuid(),
  device_id       uuid not null references public.mikrotik_devices(id) on delete cascade,
  interface_name  text not null,
  direction       text not null check (direction in ('download', 'upload')),
  status          text not null check (status in ('active', 'resolved')) default 'active',
  started_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  peak_bps        bigint not null,
  threshold_bps   bigint not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index idx_mikrotik_saturation_alerts_active
  on public.mikrotik_saturation_alerts (device_id, interface_name, direction)
  where status = 'active';

create trigger trg_mikrotik_saturation_alerts_updated_at
  before update on public.mikrotik_saturation_alerts
  for each row execute procedure public.set_updated_at();

-- Igual que mikrotik_devices: acceso EXCLUSIVO desde el backend
-- (service_role bypasea RLS). Sin policies a proposito.
alter table public.mikrotik_interface_samples enable row level security;
alter table public.mikrotik_interface_counters_state enable row level security;
alter table public.mikrotik_saturation_alerts enable row level security;

-- Agregacion por bucket de tiempo (evita mandar miles de filas crudas al
-- frontend en rangos largos -- mismo espiritu que fn_traffic_* de Fase 36).
-- bucket_seconds=60 (igual a la resolucion de guardado) para 15min/1h
-- devuelve esencialmente las filas crudas; 24h/7d usan buckets mas grandes
-- (300/1800s) elegidos por el backend segun el rango pedido.
create or replace function public.fn_mikrotik_interface_series(
  p_device_id uuid,
  p_interface_name text,
  p_since timestamptz,
  p_bucket_seconds int default 60
)
returns table (
  bucket_start timestamptz,
  avg_rx_bps numeric,
  avg_tx_bps numeric,
  max_rx_bps numeric,
  max_tx_bps numeric,
  samples int,
  online_samples int
)
language sql stable as $$
  select
    to_timestamp(floor(extract(epoch from sampled_at) / p_bucket_seconds) * p_bucket_seconds) as bucket_start,
    avg(rx_bps) filter (where online)::numeric as avg_rx_bps,
    avg(tx_bps) filter (where online)::numeric as avg_tx_bps,
    max(rx_bps) filter (where online)::numeric as max_rx_bps,
    max(tx_bps) filter (where online)::numeric as max_tx_bps,
    count(*)::int as samples,
    count(*) filter (where online)::int as online_samples
  from public.mikrotik_interface_samples
  where device_id = p_device_id
    and interface_name = p_interface_name
    and sampled_at >= p_since
  group by 1
  order by 1;
$$;

-- Solo lectura desde el backend (igual criterio que mikrotik_devices: nunca
-- se expone a "anon"/"authenticated" directo, el panel pasa siempre por
-- server/src/routes/mikrotik.ts con su propio control de rol).
revoke all on function public.fn_mikrotik_interface_series(uuid, text, timestamptz, int) from public;
