-- Funciones consumidoras existentes de Mi avance; sin datos reales.
create function public.technician_ranking_between(p_start timestamptz,p_end timestamptz)
returns table (
  technician_id uuid,
  technician_name text,
  installations_count bigint,
  averias_count bigint,
  reconexiones_count bigint,
  rutinas_count bigint,
  reincidencias_count bigint,
  total_points numeric,
  ranking int
)
language sql stable security definer set search_path=public
as $$
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
      count(*) filter(where category in ('no_service','slow_speed','equipment')) as averias_count,
      count(*) filter(where category='reconnection_relocation') as reconexiones_count,
      sum(points) as ticket_points
    from contributions where job_type='ticket' and kind='work' group by technician_id
  ),
  routine_work as (
    select technician_id, count(*) as rutinas_count, sum(points) as rutina_points
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
      and (
        coalesce(i.installations_count, 0) + coalesce(tw.averias_count, 0)
        + coalesce(tw.reconexiones_count, 0) + coalesce(ro.rutinas_count, 0)
        + coalesce(r.reincidencias_count, 0)
      ) > 0
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
$$;
revoke all on function public.technician_ranking_between(timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.get_technician_ranking(p_month int, p_year int)
returns table (
  technician_id uuid,
  technician_name text,
  installations_count bigint,
  averias_count bigint,
  reconexiones_count bigint,
  rutinas_count bigint,
  reincidencias_count bigint,
  total_points numeric,
  ranking int
)
language sql stable security definer set search_path=public
as $$
  select * from public.technician_ranking_between(
    make_date(p_year,p_month,1)::timestamptz,
    (make_date(p_year,p_month,1)+interval '1 month')::date::timestamptz)
  where current_setting('role',true)='service_role'
    or public.current_user_role() in ('ADMIN','SUPERADMIN','SOPORTE','TECNICO_RED');
$$;
