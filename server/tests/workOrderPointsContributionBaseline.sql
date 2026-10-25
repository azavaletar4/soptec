-- Schema-only snapshot: shared scoring function read on 2026-10-24.
-- No production rows, credentials or identifiers.
CREATE OR REPLACE FUNCTION public.technician_point_contributions(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(technician_id uuid, job_type text, job_id uuid, occurred_at timestamp with time zone, kind text, category text, crew_size bigint, points numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with period as (select p_start as start_date, p_end as end_date),
  install_jobs as (
    select i.id, i.assigned_to, i.completed_at as occurred_at
    from public.installations i, period p
    where i.status = 'completed'
      and i.completed_at >= p.start_date
      and i.completed_at < p.end_date
  ),
  install_crew as (
    select ij.id as job_id, ij.occurred_at, coalesce(ja.technician_id, ij.assigned_to) as technician_id,
           count(*) over (partition by ij.id) as crew_size
    from install_jobs ij
    left join public.job_assignees ja on ja.job_type = 'installation' and ja.job_id = ij.id
    where coalesce(ja.technician_id, ij.assigned_to) is not null
  ),
  ticket_jobs as (
    select t.id, t.assigned_to, t.category, t.points, coalesce(t.resolved_at, t.closed_at) as occurred_at
    from public.tickets t, period p
    where t.status in ('resolved', 'closed')
      and coalesce(t.resolved_at, t.closed_at) >= p.start_date
      and coalesce(t.resolved_at, t.closed_at) < p.end_date
  ),
  ticket_crew as (
    select tj.id as job_id, tj.occurred_at, tj.category, tj.points,
      coalesce(ja.technician_id, tj.assigned_to) as technician_id,
      count(*) over (partition by tj.id) as crew_size
    from ticket_jobs tj
    left join public.job_assignees ja on ja.job_type = 'ticket' and ja.job_id = tj.id
    where coalesce(ja.technician_id, tj.assigned_to) is not null
  ),
  routine_jobs as (
    select ro.id, ro.assigned_to, ro.points, ro.completed_at as occurred_at
    from public.routines ro, period p
    where ro.status = 'completed'
      and ro.completed_at >= p.start_date
      and ro.completed_at < p.end_date
  ),
  routine_crew as (
    select rj.id as job_id, rj.occurred_at, rj.points,
      coalesce(ja.technician_id, rj.assigned_to) as technician_id,
      count(*) over (partition by rj.id) as crew_size
    from routine_jobs rj
    left join public.job_assignees ja on ja.job_type = 'routine' and ja.job_id = rj.id
    where coalesce(ja.technician_id, rj.assigned_to) is not null
  ),
  reincidencia_jobs as (
    select t1.id, t1.assigned_to, coalesce(t1.resolved_at, t1.closed_at) as occurred_at
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
    select rj.id as job_id, rj.occurred_at, coalesce(ja.technician_id, rj.assigned_to) as technician_id,
      count(*) over (partition by rj.id) as crew_size
    from reincidencia_jobs rj
    left join public.job_assignees ja on ja.job_type = 'ticket' and ja.job_id = rj.id
    where coalesce(ja.technician_id, rj.assigned_to) is not null
  )
  select technician_id, 'installation', job_id, occurred_at, 'work', null::text, crew_size,
    10.0 / greatest(crew_size, 1) from install_crew
  union all
  select technician_id, 'ticket', job_id, occurred_at, 'work', category::text, crew_size,
    case
      when category in ('no_service', 'slow_speed', 'equipment') then coalesce(points, 5)
      when category = 'reconnection_relocation' then coalesce(points, 3)
      else 0
    end / greatest(crew_size, 1) from ticket_crew
  union all
  select technician_id, 'routine', job_id, occurred_at, 'work', null::text, crew_size,
    coalesce(points, 0) / greatest(crew_size, 1) from routine_crew
  union all
  select technician_id, 'ticket', job_id, occurred_at, 'recurrence', null::text, crew_size,
    5.0 / greatest(crew_size, 1) from reincidencia_crew;
$function$
;
