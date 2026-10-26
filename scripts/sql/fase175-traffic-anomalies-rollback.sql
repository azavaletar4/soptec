-- Rollback de la migracion 20261026130000_fase175_traffic_anomalies_lateral.sql
--
-- Restaura el cuerpo ORIGINAL de fn_traffic_anomalies (Fase 36, tal cual
-- 20260930030000_fase36_analitica_trafico.sql) via CREATE OR REPLACE —
-- misma firma, no requiere DROP, no toca ninguna tabla ni dato. Probado
-- (2026-10-26) en Postgres aislado: aplicar Fase 175 y despues este
-- rollback deja la funcion devolviendo EXACTAMENTE lo mismo que antes de
-- aplicar Fase 175 (ver verificacion en el commit de preparacion).
--
-- Uso: solo si Fase 175 se aplico en produccion y hay que revertirla.
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
