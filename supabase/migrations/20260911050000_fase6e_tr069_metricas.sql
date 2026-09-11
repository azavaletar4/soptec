-- SmartRayco — Fase 6e: metricas de desempeno TR-069 (adaptado de la
-- migracion 069 de fosmikro: se quita tenant_id, RLS single-tenant).
--
-- Idempotente (ver nota en fase9): permite re-ejecutar el archivo completo
-- sin error si una corrida anterior ya creo parte de estos objetos.

create table if not exists public.tr069_performance_metrics (
  id                 uuid primary key default gen_random_uuid(),
  tr069_device_id    uuid not null references public.tr069_devices (id) on delete cascade,
  rx_power           numeric(5, 2),   -- dBm
  tx_power           numeric(5, 2),   -- dBm
  temperature        numeric(5, 2),   -- grados C
  uptime             integer,         -- segundos
  connection_status  text,            -- 'connected' | 'disconnected' | 'degraded'
  collected_at       timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists idx_tr069_metrics_device_time on public.tr069_performance_metrics (tr069_device_id, collected_at desc);

alter table public.tr069_performance_metrics enable row level security;

drop policy if exists "tr069_metrics_staff_only" on public.tr069_performance_metrics;
create policy "tr069_metrics_staff_only"
  on public.tr069_performance_metrics for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));
