-- CANDIDATA LOCAL. No aplicar sin autorizacion. Sin escrituras de datos.
-- No modifica la fuente historica ni la prioridad/fecha de acreditacion.
begin;
create or replace function public.technician_ranking_between(p_start timestamptz,p_end timestamptz)
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
$$;
revoke all on function public.technician_ranking_between(timestamptz,timestamptz) from public,anon,authenticated,service_role;


create or replace function public.my_field_order_points(p_job_type text,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  actor uuid:=auth.uid();
  assigned uuid;
  created timestamptz;
  confirmed public.work_order_point_confirmations;
  member jsonb;
  order_status text;
  category text;
  configured numeric;
  total_points numeric;
  crew_size bigint;
  is_member boolean;
begin
  if actor is null or not exists(select 1 from public.profiles pr where pr.id=actor and pr.active and pr.role::text='TECNICO_RED') then
    raise exception 'Exclusivo del propio técnico activo' using errcode='42501';
  end if;
  if p_job_type='ticket' then
    select t.assigned_to,t.status::text,t.category::text,t.points,t.created_at into assigned,order_status,category,configured,created
    from public.tickets t where t.id=p_job_id;
  elsif p_job_type='installation' then
    -- Compatible con Altas históricas sin la columna candidata de puntos.
    select i.assigned_to,i.status::text,(to_jsonb(i)->>'points')::numeric,i.created_at into assigned,order_status,configured,created
    from public.installations i where i.id=p_job_id;
  elsif p_job_type='routine' then
    select r.assigned_to,r.status::text,r.points,r.created_at into assigned,order_status,configured,created
    from public.routines r where r.id=p_job_id;
  else
    raise exception 'Tipo de orden inválido' using errcode='22023';
  end if;
  if order_status is null then return null; end if;
  -- Solo confirmaciones oficiales; octubre sigue por la lectura operativa anterior.
  select c.* into confirmed from public.work_order_point_confirmations c
  where c.job_type=p_job_type and c.job_id=p_job_id
    and c.confirmed_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
    and c.order_created_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
    and c.technical_completed_at>=timestamptz '2026-11-01 00:00:00 America/Lima';
  if found then
    select m into member from jsonb_array_elements(confirmed.crew) m
    where (m->>'technicianId')::uuid=actor;
    if member is null then return null; end if;
    return jsonb_build_object('jobPoints',confirmed.points,'configuredPoints',confirmed.points,
      'personalPoints',(member->>'points')::numeric,
      'recurrencePenalty',(member->>'recurrencePenalty')::numeric,
      'creditedPoints',(member->>'points')::numeric-(member->>'recurrencePenalty')::numeric,
      'crewSize',jsonb_array_length(confirmed.crew),'status',order_status,
      'scoringState','confirmed','creditedAt',confirmed.confirmed_at,'asOf',now());
  end if;

  -- Cuadrilla si existe; assigned_to únicamente como fallback, como la
  -- fuente compartida. Líder y ayudantes tienen la misma consulta.
  select count(*),coalesce(bool_or(ja.technician_id=actor),false) into crew_size,is_member
  from public.job_assignees ja where ja.job_type=p_job_type and ja.job_id=p_job_id;
  if crew_size=0 then
    if assigned is distinct from actor then return null; end if;
    crew_size:=1;
  elsif not is_member then return null;
  end if;
  total_points:=case p_job_type
    when 'installation' then coalesce(configured,10)
    when 'routine' then coalesce(configured,0)
    else coalesce(configured,case when category in ('no_service','slow_speed','equipment') then 5
      when category='reconnection_relocation' then 3 else 0 end)
  end;
  return jsonb_build_object('jobPoints',total_points,'configuredPoints',configured,
    'personalPoints',total_points/crew_size,
    'scoringState',case when created>=timestamptz '2026-11-01 00:00:00 America/Lima' then 'pending' else 'historical' end,
    'creditedPoints',case when created>=timestamptz '2026-11-01 00:00:00 America/Lima' then 0 else null end,
    'crewSize',crew_size,'status',order_status,'asOf',now());
end;
$$;
revoke all on function public.my_field_order_points(text,uuid) from public,anon,service_role;
grant execute on function public.my_field_order_points(text,uuid) to authenticated;
commit;
