-- REVIEW ONLY. Not in supabase/migrations: must not be auto-applied.
-- Single scoring source extracted from Fase 130. No data writes/new tables.
begin;
do $guard$
begin
  if md5((select prosrc from pg_proc where oid = 'public.get_technician_ranking(integer,integer)'::regprocedure))
     <> 'e1a53bc89358018536db151da721c908' then
    raise exception 'Ranking definition drift: inspect installed function before activation';
  end if;
end $guard$;

create function public.technician_point_contributions(p_start timestamptz, p_end timestamptz)
returns table (technician_id uuid, job_type text, job_id uuid, occurred_at timestamptz,
  kind text, category text, crew_size bigint, points numeric)
language sql stable security definer set search_path = public
as $$
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
$$;
-- Internal function: penalty is positive here, subtraction stays in consumers.
revoke all on function public.technician_point_contributions(timestamptz,timestamptz)
  from public, anon, authenticated, service_role;

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

-- No technician ID or client-selected clock. Periods use a single server instant.
-- Installed Supabase default privileges explicitly granted anon EXECUTE.
-- CREATE OR REPLACE preserves it: revoke explicitly, independent of defaults.
revoke all on function public.get_technician_ranking(int,int) from public,anon;
grant execute on function public.get_technician_ranking(int,int) to authenticated,service_role;

create function public.my_field_progress()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
  instant timestamptz := now();
  local_now timestamp := instant at time zone 'America/Lima';
  day_start timestamptz := date_trunc('day',local_now) at time zone 'America/Lima';
  week_start timestamptz := date_trunc('week',local_now) at time zone 'America/Lima';
  month_start timestamptz := date_trunc('month',local_now) at time zone 'America/Lima';
  result jsonb;
begin
  if actor is null or public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Exclusivo del propio tecnico' using errcode='42501';
  end if;
  with periods(key, start_at, end_at) as (
    values ('today',day_start,(date_trunc('day',local_now)+interval '1 day') at time zone 'America/Lima'),
      ('week',week_start,(date_trunc('week',local_now)+interval '1 week') at time zone 'America/Lima'),
      ('month',month_start,(date_trunc('month',local_now)+interval '1 month') at time zone 'America/Lima')
  ),
  entries as materialized (
    select c.*, coalesce(t.ticket_number,r.routine_number) as reference
    from public.technician_point_contributions(
      least(day_start,week_start,month_start), (select max(end_at) from periods)) c
    left join public.tickets t on c.job_type='ticket' and t.id=c.job_id
    left join public.routines r on c.job_type='routine' and r.id=c.job_id
    where c.technician_id=actor
  ),
  totals as (
    select p.key, p.start_at, p.end_at,
      coalesce(sum(e.points) filter(where e.kind='work' and e.job_type='installation'),0)
      + coalesce(sum(e.points) filter(where e.kind='work' and e.job_type='ticket'),0)
      + coalesce(sum(e.points) filter(where e.kind='work' and e.job_type='routine'),0)
      - coalesce(sum(e.points) filter(where e.kind='recurrence'),0) as points
    from periods p left join entries e on e.occurred_at>=p.start_at and e.occurred_at<p.end_at
    group by p.key,p.start_at,p.end_at
  )
  select jsonb_build_object(
    'asOf',instant,'timezone','America/Lima',
    'periods',(select jsonb_object_agg(key,jsonb_build_object('start',start_at,'end',end_at,'points',round(points,1))) from totals),
    'contributions',coalesce((select jsonb_agg(jsonb_build_object(
      'jobType',e.job_type,'jobId',e.job_id,'reference',e.reference,'occurredAt',e.occurred_at,
      'kind',e.kind,'crewSize',e.crew_size,
      'points',case when e.kind='recurrence' then -e.points else e.points end
    ) order by e.occurred_at desc,e.job_type,e.job_id,e.kind) from entries e),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.my_field_progress() from public,anon,service_role;
grant execute on function public.my_field_progress() to authenticated;

-- Detail outside the current periods: use the same source and authorize the
-- contribution, not merely assigned_to. Other people's IDs return no data.
create function public.my_field_job_points(p_job_type text, p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare actor uuid := auth.uid(); closed_at timestamptz; result jsonb;
begin
  if actor is null or public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Exclusivo del propio tecnico' using errcode='42501';
  end if;
  if p_job_type='installation' then
    select i.completed_at into closed_at from public.installations i where i.id=p_job_id and i.status='completed';
  elsif p_job_type='ticket' then
    select coalesce(t.resolved_at,t.closed_at) into closed_at from public.tickets t where t.id=p_job_id and t.status in ('resolved','closed');
  elsif p_job_type='routine' then
    select r.completed_at into closed_at from public.routines r where r.id=p_job_id and r.status='completed';
  end if;
  if closed_at is null then return null; end if;
  select jsonb_agg(jsonb_build_object('kind',c.kind,'crewSize',c.crew_size,
    'occurredAt',c.occurred_at,'points',case when c.kind='recurrence' then -c.points else c.points end)
    order by c.kind)
  into result from public.technician_point_contributions(closed_at,closed_at+interval '1 microsecond') c
  where c.technician_id=actor and c.job_type=p_job_type and c.job_id=p_job_id;
  return result;
end $$;
revoke all on function public.my_field_job_points(text,uuid) from public,anon,service_role;
grant execute on function public.my_field_job_points(text,uuid) to authenticated;
-- Transparency: aggregate productivity only, no jobs, customers or contact data.
create function public.get_technician_period_ranking(p_period text,p_date date default null)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare
  reference date := coalesce(p_date,(now() at time zone 'America/Lima')::date);
  local_start timestamp; local_end timestamp;
  result jsonb;
begin
  if current_setting('role',true) <> 'service_role' and
    (auth.uid() is null or coalesce(public.current_user_role()::text,'') not in ('ADMIN','SUPERADMIN','SOPORTE','TECNICO_RED')) then
    raise exception 'Ranking exclusivo de personal autenticado' using errcode='42501';
  end if;
  if reference < date '2000-01-01' or reference > date '2100-12-31' then
    raise exception 'Fecha fuera de rango' using errcode='22023';
  end if;
  case p_period
    when 'day' then local_start:=reference::timestamp; local_end:=local_start+interval '1 day';
    when 'week' then local_start:=date_trunc('week',reference::timestamp); local_end:=local_start+interval '1 week';
    when 'month' then local_start:=date_trunc('month',reference::timestamp); local_end:=local_start+interval '1 month';
    else raise exception 'Periodo invalido' using errcode='22023';
  end case;
  select jsonb_build_object('period',p_period,'start',local_start at time zone 'America/Lima',
    'end',local_end at time zone 'America/Lima','timezone','America/Lima','asOf',now(),
    'ranking',coalesce(jsonb_agg(to_jsonb(r) order by r.ranking,r.technician_name),'[]'::jsonb))
    into result from public.technician_ranking_between(local_start at time zone 'America/Lima',local_end at time zone 'America/Lima') r;
  return result;
end $$;
revoke all on function public.get_technician_period_ranking(text,date) from public,anon;
grant execute on function public.get_technician_period_ranking(text,date) to authenticated,service_role;

commit;
