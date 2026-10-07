-- SmartRayco — Fase 130: Rutinas suman al Ranking de tecnicos.
--
-- A diferencia de Tickets (regla automatica +5/+3 por categoria, con
-- tickets.points como override manual opcional, Fase 6b/27c), una Rutina no
-- tiene una regla de puntaje fija — un "Recojo de encomienda" y un
-- "Mantenimiento de nodo/NAP" no deberian valer lo mismo. Por eso
-- routines.points es NULLABLE a nivel de BD (igual que tickets.points,
-- mismo criterio de columna) pero el formulario del Panel Web (Fase 130)
-- lo exige siempre > 0 al crear/editar — la obligatoriedad es una regla de
-- negocio de frontend, no un NOT NULL que rompa las rutinas historicas sin
-- puntaje (esas simplemente no suman nada al ranking, igual que antes de
-- esta fase).
alter table public.routines add column points numeric check (points >= 0);

-- Reparto entre cuadrilla igual que installs/ticket_work (Fase 94): el
-- conteo de rutinas_count NO se divide (cada integrante se lleva credito
-- completo de haber trabajado la rutina), solo el puntaje se reparte.
drop function if exists public.get_technician_ranking(int, int);

create function public.get_technician_ranking(p_month int, p_year int)
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
language sql
stable
security definer set search_path = public
as $$
  with period as (
    select
      make_date(p_year, p_month, 1) as start_date,
      (make_date(p_year, p_month, 1) + interval '1 month')::date as end_date
  ),
  install_jobs as (
    select i.id, i.assigned_to
    from public.installations i, period p
    where i.status = 'completed'
      and i.completed_at >= p.start_date
      and i.completed_at < p.end_date
  ),
  install_crew as (
    select ij.id as job_id, coalesce(ja.technician_id, ij.assigned_to) as technician_id,
           count(*) over (partition by ij.id) as crew_size
    from install_jobs ij
    left join public.job_assignees ja on ja.job_type = 'installation' and ja.job_id = ij.id
    where coalesce(ja.technician_id, ij.assigned_to) is not null
  ),
  installs as (
    select technician_id,
      count(*) as installations_count,
      sum(10.0 / greatest(crew_size, 1)) as install_points
    from install_crew
    group by technician_id
  ),
  ticket_jobs as (
    select t.id, t.assigned_to, t.category, t.points
    from public.tickets t, period p
    where t.status in ('resolved', 'closed')
      and coalesce(t.resolved_at, t.closed_at) >= p.start_date
      and coalesce(t.resolved_at, t.closed_at) < p.end_date
  ),
  ticket_crew as (
    select tj.id as job_id, tj.category, tj.points,
      coalesce(ja.technician_id, tj.assigned_to) as technician_id,
      count(*) over (partition by tj.id) as crew_size
    from ticket_jobs tj
    left join public.job_assignees ja on ja.job_type = 'ticket' and ja.job_id = tj.id
    where coalesce(ja.technician_id, tj.assigned_to) is not null
  ),
  ticket_work as (
    select
      technician_id,
      count(*) filter (where category in ('no_service', 'slow_speed', 'equipment')) as averias_count,
      count(*) filter (where category = 'reconnection_relocation') as reconexiones_count,
      sum(
        case
          when category in ('no_service', 'slow_speed', 'equipment') then coalesce(points, 5)
          when category = 'reconnection_relocation' then coalesce(points, 3)
          else 0
        end / greatest(crew_size, 1)
      ) as ticket_points
    from ticket_crew
    group by technician_id
  ),
  routine_jobs as (
    select ro.id, ro.assigned_to, ro.points
    from public.routines ro, period p
    where ro.status = 'completed'
      and ro.completed_at >= p.start_date
      and ro.completed_at < p.end_date
  ),
  routine_crew as (
    select rj.id as job_id, rj.points,
      coalesce(ja.technician_id, rj.assigned_to) as technician_id,
      count(*) over (partition by rj.id) as crew_size
    from routine_jobs rj
    left join public.job_assignees ja on ja.job_type = 'routine' and ja.job_id = rj.id
    where coalesce(ja.technician_id, rj.assigned_to) is not null
  ),
  routine_work as (
    select technician_id,
      count(*) as rutinas_count,
      sum(coalesce(points, 0) / greatest(crew_size, 1)) as rutina_points
    from routine_crew
    group by technician_id
  ),
  reincidencia_jobs as (
    select t1.id, t1.assigned_to
    from public.tickets t1, period p
    where t1.status in ('resolved', 'closed')
      and t1.category in ('no_service', 'slow_speed', 'equipment')
      and coalesce(t1.resolved_at, t1.closed_at) >= p.start_date
      and coalesce(t1.resolved_at, t1.closed_at) < p.end_date
      and exists (
        select 1
        from public.tickets t2
        where t2.client_id = t1.client_id
          and t2.id <> t1.id
          and t2.category in ('no_service', 'slow_speed', 'equipment')
          and t2.created_at > coalesce(t1.resolved_at, t1.closed_at)
          and t2.created_at <= coalesce(t1.resolved_at, t1.closed_at) + interval '7 days'
          and t2.imputable_a_tecnico
      )
  ),
  reincidencia_crew as (
    select rj.id as job_id, coalesce(ja.technician_id, rj.assigned_to) as technician_id,
      count(*) over (partition by rj.id) as crew_size
    from reincidencia_jobs rj
    left join public.job_assignees ja on ja.job_type = 'ticket' and ja.job_id = rj.id
    where coalesce(ja.technician_id, rj.assigned_to) is not null
  ),
  reincidencias as (
    select technician_id,
      count(*) as reincidencias_count,
      sum(5.0 / greatest(crew_size, 1)) as reincidencia_penalty
    from reincidencia_crew
    group by technician_id
  ),
  combined as (
    select
      pr.id as technician_id,
      coalesce(pr.full_name, pr.email) as technician_name,
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

revoke all on function public.get_technician_ranking(int, int) from public;
grant execute on function public.get_technician_ranking(int, int) to authenticated;
