-- Fase 175: optimiza fn_traffic_anomalies (Analitica de Trafico, Fase 36) sin
-- cambiar su resultado ni su firma.
--
-- Diagnostico (ver docs/, sesion 2026-10-26): fn_traffic_anomalies era la RPC
-- mas cara del modulo (confirmado con EXPLAIN ANALYZE contra datos reales:
-- ~2.93s), muy cerca del statement_timeout de 8s del rol `authenticator`
-- (el que usa PostgREST para TODA llamada REST/RPC, incluidas las del
-- backend) — pg_stat_statements mostraba su max_exec_time pegado justo en
-- ~7.9-8.0s. La causa NO es falta de indice (idx_traffic_samples_time ya
-- existe) sino el ORDEN de trabajo: la version original calculaba la
-- "linea base" de 7 dias para TODOS los contratos activos (cientos de miles
-- de filas) antes de filtrar cuales realmente superan el umbral reciente.
--
-- Esta version invierte el orden: primero calcula `recent` (ventana de 24h,
-- barata) y filtra ahi mismo por p_min_current_bps (antes era un filtro
-- posterior) — típicamente deja un puñado de contratos. Solo para ESOS
-- contratos calcula la linea base de 7 dias, un contrato a la vez via LATERAL,
-- lo que le permite a Postgres usar idx_traffic_samples_contract_time
-- (contract_id, sampled_at desc) con un rango acotado por contrato en vez de
-- escanear la ventana completa de 7 dias de TODOS los contratos.
--
-- Medido con EXPLAIN ANALYZE contra el mismo dataset real (ancla en
-- 2026-10-15 16:24:34+00, la ultima muestra real antes del corte del
-- scheduler — ver Fase 174b/176): 2932ms -> 857ms (~3.4x), mismas 5 filas de
-- resultado. Sin tablas nuevas, sin indices nuevos, sin tocar datos — solo
-- reescribe el cuerpo de la funcion (CREATE OR REPLACE, misma firma,
-- `revoke` de la migracion original sigue vigente sin tocarlo).
--
-- NO aplicada todavia — preparada para revision/aplicacion explicita.
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
  with recent as (
    select contract_id, avg(download_bps + upload_bps)::bigint as avg_bps, max(sampled_at) as last_seen
    from public.mikrotik_traffic_samples
    where sampled_at >= now() - interval '24 hours'
    group by contract_id
    having avg(download_bps + upload_bps)::bigint >= p_min_current_bps
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
  join lateral (
    select avg(s.download_bps + s.upload_bps)::bigint as avg_bps
    from public.mikrotik_traffic_samples s
    where s.contract_id = r.contract_id
      and s.sampled_at >= now() - interval '7 days'
      and s.sampled_at < now() - interval '24 hours'
  ) b on true
  join public.service_contracts sc on sc.id = r.contract_id
  join public.clients c on c.id = sc.client_id
  where r.avg_bps::numeric >= b.avg_bps::numeric * p_ratio
  order by ratio desc;
$$;
