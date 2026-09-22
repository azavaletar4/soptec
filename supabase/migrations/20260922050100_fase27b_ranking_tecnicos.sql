-- Fase 27b: ranking mensual de tecnicos de campo (premio al Tecnico del
-- Mes). Requiere que la Fase 27a (categoria "reconnection_relocation") ya
-- este confirmada en una transaccion aparte.
--
-- Reglas de puntaje (pedidas por el negocio):
--   +10 instalacion nueva completada (modulo Instalaciones, NO el ticket de
--        soporte generico categoria "installation" — ese es mas bien "el
--        cliente pregunto por una instalacion", no el trabajo de campo).
--   +5  averia/mantenimiento resuelto (tickets categoria no_service,
--        slow_speed o equipment, status resolved/closed).
--   +3  reconexion/traslado resuelto (categoria "reconnection_relocation").
--   -5  reincidencia: el MISMO cliente vuelve a reportar una averia dentro
--        de los 7 dias posteriores a que se resolvio la averia anterior —
--        penaliza al tecnico que atendio la primera, en el mes en que ESA
--        primera se resolvio (no el mes de la reincidencia).
--
-- Todo se calcula en una sola funcion (sin guardar nada nuevo, siempre
-- fresco) para no interferir con tickets.points (Fase 6b, asignacion manual
-- existente que sigue funcionando igual para otros usos).

create or replace function public.get_technician_ranking(p_month int, p_year int)
returns table (
  technician_id uuid,
  technician_name text,
  installations_count bigint,
  averias_count bigint,
  reconexiones_count bigint,
  reincidencias_count bigint,
  total_points bigint,
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
  -- Instalaciones nuevas completadas en el mes (modulo Instalaciones).
  installs as (
    select i.assigned_to as technician_id, count(*) as installations_count
    from public.installations i, period p
    where i.status = 'completed'
      and i.assigned_to is not null
      and i.completed_at >= p.start_date
      and i.completed_at < p.end_date
    group by i.assigned_to
  ),
  -- Averias/mantenimiento y reconexiones/traslados resueltos en el mes.
  ticket_work as (
    select
      t.assigned_to as technician_id,
      count(*) filter (where t.category in ('no_service', 'slow_speed', 'equipment')) as averias_count,
      count(*) filter (where t.category = 'reconnection_relocation') as reconexiones_count
    from public.tickets t, period p
    where t.status in ('resolved', 'closed')
      and t.assigned_to is not null
      and coalesce(t.resolved_at, t.closed_at) >= p.start_date
      and coalesce(t.resolved_at, t.closed_at) < p.end_date
    group by t.assigned_to
  ),
  -- Reincidencias: averia resuelta en el mes donde el mismo cliente abre
  -- OTRA averia dentro de los 7 dias posteriores a esa resolucion.
  reincidencias as (
    select t1.assigned_to as technician_id, count(*) as reincidencias_count
    from public.tickets t1, period p
    where t1.status in ('resolved', 'closed')
      and t1.assigned_to is not null
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
      )
    group by t1.assigned_to
  ),
  combined as (
    select
      pr.id as technician_id,
      coalesce(pr.full_name, pr.email) as technician_name,
      coalesce(i.installations_count, 0) as installations_count,
      coalesce(tw.averias_count, 0) as averias_count,
      coalesce(tw.reconexiones_count, 0) as reconexiones_count,
      coalesce(r.reincidencias_count, 0) as reincidencias_count,
      (
        coalesce(i.installations_count, 0) * 10
        + coalesce(tw.averias_count, 0) * 5
        + coalesce(tw.reconexiones_count, 0) * 3
        - coalesce(r.reincidencias_count, 0) * 5
      ) as total_points
    from public.profiles pr
    left join installs i on i.technician_id = pr.id
    left join ticket_work tw on tw.technician_id = pr.id
    left join reincidencias r on r.technician_id = pr.id
    where pr.role = 'TECNICO_RED'
      and (
        coalesce(i.installations_count, 0) + coalesce(tw.averias_count, 0)
        + coalesce(tw.reconexiones_count, 0) + coalesce(r.reincidencias_count, 0)
      ) > 0
  )
  select
    technician_id,
    technician_name,
    installations_count,
    averias_count,
    reconexiones_count,
    reincidencias_count,
    total_points,
    rank() over (order by total_points desc)::int as ranking
  from combined
  order by total_points desc, technician_name;
$$;

-- security definer bypasea RLS de tickets/installations/profiles. Se llama
-- solo desde el backend (server/src/routes/soporte.ts), que ya exige rol de
-- staff con requireRole antes de invocarla — igual criterio que el resto de
-- rutas de este backend (la autorizacion vive en las rutas, no en SQL).
-- revoke/grant solo bloquea a "anon" (sin sesion), no a CLIENTE.
revoke all on function public.get_technician_ranking(int, int) from public;
grant execute on function public.get_technician_ranking(int, int) to authenticated;
