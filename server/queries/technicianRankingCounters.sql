-- Consulta candidata LOCAL para el cuerpo de technician_ranking_between.
-- Solo SELECT; no es una migracion y no instala ni reemplaza funciones.
-- p_start/p_end son los parametros existentes. No cambia puntos ni penalizaciones.
-- Desde el corte oficial, incluye other acreditados; no billing ni installation.
-- Los contadores deduplican por orden/tecnico; las sumas conservan cada aporte.
with period as (select p_start as start_date,p_end as end_date),
  contributions as materialized (
    select c.* from period p cross join lateral
      public.technician_point_contributions(p.start_date::timestamptz,p.end_date::timestamptz) c
  ),
  installs as (
    select technician_id, count(*) as installations_count, sum(points) as install_points
    from contributions where job_type='installation' and kind='work' group by technician_id
  ),
  ticket_work as (
    select technician_id,
      count(distinct job_id) filter(where category in ('no_service','slow_speed','equipment')
        or (category='other'
          and occurred_at>=timestamptz '2026-11-01 00:00:00 America/Lima')) as averias_count,
      count(*) filter(where category='reconnection_relocation') as reconexiones_count,
      sum(points) as ticket_points
    from contributions where job_type='ticket' and kind='work' group by technician_id
  ),
  routine_work as (
    select technician_id, count(distinct job_id) as rutinas_count, sum(points) as rutina_points
    from contributions where job_type='routine' and kind='work' group by technician_id
  ),
  reincidencias as (
    select technician_id, count(*) as reincidencias_count, sum(points) as reincidencia_penalty
    from contributions where kind='recurrence' group by technician_id
  ),
  combined as (
    select
      pr.id as technician_id,
      coalesce(pr.full_name, 'T?cnico') as technician_name,
      coalesce(i.installations_count, 0) as installations_count,
      coalesce(tw.averias_count, 0) as averias_count,
      coalesce(tw.reconexiones_count, 0) as reconexiones_count,
      coalesce(ro.rutinas_count, 0) as rutinas_count,
      coalesce(r.reincidencias_count, 0) as reincidencias_count,
      (
        coalesce(i.install_points, 0)
        + coalesce(tw.ticket_points, 0)
        + coalesce(ro.rutina_points, 0)
        - coalesce(r.reincidencia_penalty, 0)
      ) as total_points
    from public.profiles pr
    left join installs i on i.technician_id = pr.id
    left join ticket_work tw on tw.technician_id = pr.id
    left join routine_work ro on ro.technician_id = pr.id
    left join reincidencias r on r.technician_id = pr.id
    where pr.role = 'TECNICO_RED'
      and ((
        coalesce(i.installations_count, 0) + coalesce(tw.averias_count, 0)
        + coalesce(tw.reconexiones_count, 0) + coalesce(ro.rutinas_count, 0)
        + coalesce(r.reincidencias_count, 0)
      ) > 0 or exists (
        select 1 from contributions c where c.technician_id=pr.id
          and c.occurred_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
          and c.kind='work'
      ))
  )
  select
    technician_id,
    technician_name,
    installations_count,
    averias_count,
    reconexiones_count,
    rutinas_count,
    reincidencias_count,
    round(total_points, 1) as total_points,
    rank() over (order by total_points desc)::int as ranking
  from combined
  order by total_points desc, technician_name;
