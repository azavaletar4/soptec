-- Isolated fixture: solo lo que fn_traffic_anomalies necesita referenciar
-- (clients, service_contracts, mikrotik_devices, mikrotik_traffic_samples).
-- No es un dump de produccion.
create extension if not exists pgcrypto;

create table public.clients(
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null
);

create table public.service_contracts(
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  contract_number text
);

create table public.mikrotik_devices(
  id uuid primary key default gen_random_uuid()
);

-- Mismo DDL que la migracion 20260930030000_fase36_analitica_trafico.sql
-- (solo la tabla; las funciones las carga el test desde la migracion real).
create table public.mikrotik_traffic_samples (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references public.service_contracts (id) on delete cascade,
  device_id        uuid not null references public.mikrotik_devices (id) on delete cascade,
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
