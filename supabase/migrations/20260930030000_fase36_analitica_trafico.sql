-- SmartRayco — Fase 36: Analitica y Monitoreo de Trafico (nativo, sin depender
-- de un dashboard externo tipo MikroDash).
--
-- Fuente de datos: la interfaz dinamica que RouterOS crea por cada sesion
-- PPPoE activa (tipo "pppoe-in", nombrada igual que el usuario PPPoE). Se
-- lee via /interface (REST, ver server/src/mikrotik/client.ts) — no requiere
-- que el ISP tenga simple queues configuradas.
--
-- Dato clave de direccion: en esa interfaz, "rx" = bytes RECIBIDOS por el
-- router DESDE el cliente (o sea, SUBIDA del cliente) y "tx" = bytes
-- ENVIADOS por el router HACIA el cliente (o sea, BAJADA del cliente). Para
-- no arrastrar esa confusion a las consultas, las columnas de esta tabla ya
-- se guardan en terminos del cliente: download_bytes (tx del router) /
-- upload_bytes (rx del router).
--
-- Los contadores de RouterOS son acumulados desde que la interfaz existe (se
-- reinician a 0 si el cliente se reconecta) — por eso se guarda el ultimo
-- valor crudo visto por contrato (mikrotik_traffic_counters_state) y cada
-- fila de mikrotik_traffic_samples es un DELTA ya calculado (bytes
-- consumidos en ese intervalo de muestreo), no el acumulado crudo.

create table public.mikrotik_traffic_samples (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references public.service_contracts (id) on delete cascade,
  device_id        uuid not null references public.mikrotik_devices (id) on delete cascade,
  -- Mismo id para todas las filas insertadas en una misma corrida del
  -- scheduler (ver trafficAnalyticsService.ts) — permite sumar el trafico
  -- global de TODOS los clientes en un instante dado (pico de red).
  run_id           uuid not null,
  sampled_at       timestamptz not null default now(),
  interval_seconds int not null,
  download_bytes   bigint not null default 0,
  upload_bytes     bigint not null default 0,
  download_bps     bigint not null default 0,
  upload_bps       bigint not null default 0,
  online           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index idx_traffic_samples_contract_time on public.mikrotik_traffic_samples (contract_id, sampled_at desc);
create index idx_traffic_samples_time on public.mikrotik_traffic_samples (sampled_at);
create index idx_traffic_samples_run on public.mikrotik_traffic_samples (run_id);

-- Ultimo contador crudo visto por contrato, para calcular el delta del
-- siguiente muestreo (sobrevive a un reinicio del backend).
create table public.mikrotik_traffic_counters_state (
  contract_id    uuid primary key references public.service_contracts (id) on delete cascade,
  last_rx_bytes  bigint not null default 0, -- crudo del router (subida del cliente)
  last_tx_bytes  bigint not null default 0, -- crudo del router (bajada del cliente)
  updated_at     timestamptz not null default now()
);

create trigger trg_traffic_counters_state_updated_at
  before update on public.mikrotik_traffic_counters_state
  for each row execute procedure public.set_updated_at();

-- Igual que mikrotik_devices: acceso EXCLUSIVO desde el backend
-- (service_role bypasea RLS). Sin policies a proposito.
alter table public.mikrotik_traffic_samples enable row level security;
alter table public.mikrotik_traffic_counters_state enable row level security;

-- =========================================================
-- Funciones de agregacion (RPC), llamadas solo desde el backend.
-- Evitan traer miles de filas crudas al Node process para sumar/agrupar.
-- =========================================================

-- KPI "Evolucion del Consumo Mensual" (global, ultimos N meses).
create or replace function public.fn_traffic_monthly_totals(p_months int default 6)
returns table (month_start date, download_bytes bigint, upload_bytes bigint)
language sql stable as $$
  select
    date_trunc('month', s.sampled_at)::date as month_start,
    coalesce(sum(s.download_bytes), 0)::bigint,
    coalesce(sum(s.upload_bytes), 0)::bigint
  from public.mikrotik_traffic_samples s
  where s.sampled_at >= date_trunc('month', now()) - ((p_months - 1) || ' months')::interval
  group by 1
  order by 1;
$$;

-- Evolucion diaria de UN cliente dentro de un rango (para el detalle /
-- "por cliente" de la misma grafica).
create or replace function public.fn_traffic_client_daily(p_contract_id uuid, p_since timestamptz)
returns table (day date, download_bytes bigint, upload_bytes bigint)
language sql stable as $$
  select
    date_trunc('day', s.sampled_at)::date as day,
    coalesce(sum(s.download_bytes), 0)::bigint,
    coalesce(sum(s.upload_bytes), 0)::bigint
  from public.mikrotik_traffic_samples s
  where s.contract_id = p_contract_id and s.sampled_at >= p_since
  group by 1
  order by 1;
$$;

-- Top clientes por consumo total (bytes) desde p_since.
create or replace function public.fn_traffic_top_clients(p_since timestamptz, p_limit int default 10)
returns table (
  contract_id     uuid,
  contract_number text,
  client_name     text,
  download_bytes  bigint,
  upload_bytes    bigint,
  total_bytes     bigint
)
language sql stable as $$
  select
    sc.id,
    sc.contract_number,
    c.first_name || ' ' || c.last_name,
    coalesce(sum(s.download_bytes), 0)::bigint as download_bytes,
    coalesce(sum(s.upload_bytes), 0)::bigint as upload_bytes,
    coalesce(sum(s.download_bytes + s.upload_bytes), 0)::bigint as total_bytes
  from public.service_contracts sc
  join public.clients c on c.id = sc.client_id
  left join public.mikrotik_traffic_samples s on s.contract_id = sc.id and s.sampled_at >= p_since
  where sc.status = 'active'
  group by sc.id, sc.contract_number, c.first_name, c.last_name
  having coalesce(sum(s.download_bytes + s.upload_bytes), 0) > 0
  order by total_bytes desc
  limit p_limit;
$$;

-- Cuellos de botella: ultima muestra de cada contrato (dentro de
-- p_max_age_minutes, para no arrastrar clientes ya desconectados) contra la
-- velocidad contratada de su plan.
create or replace function public.fn_traffic_bottlenecks(p_threshold_pct numeric default 85, p_max_age_minutes int default 60)
returns table (
  contract_id            uuid,
  contract_number        text,
  client_name            text,
  download_bps           bigint,
  upload_bps             bigint,
  download_capacity_bps  bigint,
  upload_capacity_bps    bigint,
  usage_pct              numeric,
  sampled_at             timestamptz
)
language sql stable as $$
  with latest as (
    select distinct on (s.contract_id)
      s.contract_id, s.download_bps, s.upload_bps, s.sampled_at
    from public.mikrotik_traffic_samples s
    where s.sampled_at >= now() - (p_max_age_minutes || ' minutes')::interval
    order by s.contract_id, s.sampled_at desc
  ),
  scored as (
    select
      l.*,
      sc.contract_number,
      c.first_name || ' ' || c.last_name as client_name,
      coalesce(p.download_speed, 0)::bigint * 1000000 as download_capacity_bps,
      coalesce(p.upload_speed, 0)::bigint * 1000000 as upload_capacity_bps,
      greatest(
        case when coalesce(p.download_speed, 0) > 0 then (l.download_bps::numeric / (p.download_speed::numeric * 1000000)) * 100 else 0 end,
        case when coalesce(p.upload_speed, 0) > 0 then (l.upload_bps::numeric / (p.upload_speed::numeric * 1000000)) * 100 else 0 end
      ) as usage_pct
    from latest l
    join public.service_contracts sc on sc.id = l.contract_id
    join public.clients c on c.id = sc.client_id
    left join public.plans p on p.id = sc.plan_id
  )
  select contract_id, contract_number, client_name, download_bps, upload_bps,
         download_capacity_bps, upload_capacity_bps, usage_pct, sampled_at
  from scored
  where usage_pct >= p_threshold_pct
  order by usage_pct desc;
$$;

-- Picos de trafico GLOBAL: suma de todos los contratos en una misma corrida
-- del scheduler (run_id), la corrida con mayor suma desde p_since.
create or replace function public.fn_traffic_peak(p_since timestamptz)
returns table (run_id uuid, total_bps bigint, sampled_at timestamptz)
language sql stable as $$
  select run_id, sum(download_bps + upload_bps)::bigint as total_bps, min(sampled_at) as sampled_at
  from public.mikrotik_traffic_samples
  where sampled_at >= p_since
  group by run_id
  order by total_bps desc
  limit 1;
$$;

-- Anomalias: clientes cuyo consumo promedio de las ultimas 24h supera en
-- p_ratio veces su propio promedio de los 6 dias anteriores (linea base
-- propia, no comparada contra otros clientes). p_min_current_bps filtra
-- ruido de clientes casi inactivos que "duplican" un consumo insignificante.
create or replace function public.fn_traffic_anomalies(p_ratio numeric default 2.0, p_min_current_bps bigint default 2000000)
returns table (
  contract_id     uuid,
  contract_number text,
  client_name     text,
  baseline_bps    bigint,
  current_bps     bigint,
  ratio           numeric,
  last_seen       timestamptz
)
language sql stable as $$
  with baseline as (
    select contract_id, avg(download_bps + upload_bps)::bigint as avg_bps
    from public.mikrotik_traffic_samples
    where sampled_at >= now() - interval '7 days' and sampled_at < now() - interval '24 hours'
    group by contract_id
  ),
  recent as (
    select contract_id, avg(download_bps + upload_bps)::bigint as avg_bps, max(sampled_at) as last_seen
    from public.mikrotik_traffic_samples
    where sampled_at >= now() - interval '24 hours'
    group by contract_id
  )
  select
    r.contract_id,
    sc.contract_number,
    c.first_name || ' ' || c.last_name as client_name,
    b.avg_bps as baseline_bps,
    r.avg_bps as current_bps,
    round(r.avg_bps::numeric / greatest(b.avg_bps, 1), 2) as ratio,
    r.last_seen
  from recent r
  join baseline b on b.contract_id = r.contract_id
  join public.service_contracts sc on sc.id = r.contract_id
  join public.clients c on c.id = sc.client_id
  where r.avg_bps >= p_min_current_bps
    and r.avg_bps::numeric >= b.avg_bps::numeric * p_ratio
  order by ratio desc;
$$;

-- Solo el backend (service_role) llama estas funciones, igual que
-- mikrotik_devices — nunca se exponen a "anon"/"authenticated" (los datos de
-- consumo de un cliente son sensibles y el frontend siempre pasa por las
-- rutas de /api/analytics con su propio control de rol, ver
-- server/src/routes/analytics.ts).
revoke all on function public.fn_traffic_monthly_totals(int) from public;
revoke all on function public.fn_traffic_client_daily(uuid, timestamptz) from public;
revoke all on function public.fn_traffic_top_clients(timestamptz, int) from public;
revoke all on function public.fn_traffic_bottlenecks(numeric, int) from public;
revoke all on function public.fn_traffic_peak(timestamptz) from public;
revoke all on function public.fn_traffic_anomalies(numeric, bigint) from public;
