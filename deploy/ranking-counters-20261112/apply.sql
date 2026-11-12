-- PREPARADO LOCALMENTE. NO EJECUTADO EN SUPABASE. Requiere autorizacion posterior.
-- Origen: e114fb6; refinamiento: solo other oficial, sin billing/installation.
-- Una unica funcion. Sin DROP, GRANT/REVOKE, DML ni cambios en otras funciones.
begin isolation level repeatable read;
set local search_path=public;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $activation$
declare v_metadata jsonb; v_deps jsonb; v_helpers jsonb;
  v_period record; entry jsonb; v_before jsonb; v_expected jsonb; v_after jsonb; snapshots jsonb:='[]';
begin
  if md5(pg_get_functiondef('public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure))<>'01290877f59ae43101b55a1a09d56691' then
    raise exception 'Deriva en funcion de produccion: no aplicar'; end if;
  select to_jsonb(p)-'prosrc' into v_metadata from pg_proc p where p.oid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]') from pg_depend d
    where (d.classid='pg_proc'::regclass and d.objid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure)
       or (d.refclassid='pg_proc'::regclass and d.refobjid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure) into v_deps;
  select jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) from pg_proc p
    where p.oid in ('public.confirm_work_order_points(text,uuid,numeric,text,text,boolean)'::regprocedure,'public.get_technician_period_ranking(text,date)'::regprocedure,'public.get_technician_ranking(integer,integer)'::regprocedure,'public.technician_point_contributions(timestamp with time zone,timestamp with time zone)'::regprocedure,'public.technician_point_contributions_legacy(timestamp with time zone,timestamp with time zone)'::regprocedure,'public.work_order_point_review(text,uuid)'::regprocedure) into v_helpers;
  if v_helpers is distinct from '{"confirm_work_order_points(text,uuid,numeric,text,text,boolean)":"5d281c7c62db7e9c241ffcfda094e036","get_technician_period_ranking(text,date)":"e636f1003c107fc8ca8c4f8856bbe577","get_technician_ranking(integer,integer)":"c19b92fa0de607b1bc689d882a842e66","technician_point_contributions(timestamp with time zone,timestamp with time zone)":"5b564b59bc0ba7b7eb2a9af2980dac90","technician_point_contributions_legacy(timestamp with time zone,timestamp with time zone)":"fd6da116e41fb523dc75fd6080db6ce9","work_order_point_review(text,uuid)":"299989b6da2217ae055ec85fb318794f"}'::jsonb then
    raise exception 'Deriva en funciones relacionadas: detener y regenerar respaldo'; end if;
  if (select pg_get_userbyid(proowner)<>'postgres' or to_jsonb(proacl) is distinct from '["postgres=X/postgres"]'::jsonb from pg_proc where oid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure) then
    raise exception 'Deriva en owner/permisos de ranking'; end if;
  for v_period in select * from (values
    ('case_day','2026-11-06 05:00Z'::timestamptz,'2026-11-07 05:00Z'::timestamptz),
    ('case_week','2026-11-02 05:00Z'::timestamptz,'2026-11-09 05:00Z'::timestamptz),
    ('official_month','2026-11-01 05:00Z'::timestamptz,'2026-12-01 05:00Z'::timestamptz),
    ('historical_month','2026-10-01 05:00Z'::timestamptz,'2026-11-01 05:00Z'::timestamptz),
    ('mixed_week','2026-10-26 05:00Z'::timestamptz,'2026-11-02 05:00Z'::timestamptz)
  ) p(label,start_at,end_at)
  union all select 'current_month',date_trunc('month',now() at time zone 'America/Lima') at time zone 'America/Lima',
    (date_trunc('month',now() at time zone 'America/Lima')+interval '1 month') at time zone 'America/Lima' loop
    select coalesce(jsonb_agg(to_jsonb(r) order by technician_id),'[]') into v_before
      from public.technician_ranking_between(v_period.start_at,v_period.end_at) r;
    execute $candidate_query$select coalesce(jsonb_agg(to_jsonb(r) order by technician_id),'[]') from (-- Consulta candidata LOCAL para el cuerpo de technician_ranking_between.
-- Solo SELECT; no es una migracion y no instala ni reemplaza funciones.
-- $1/$2 son los parametros existentes. No cambia puntos ni penalizaciones.
-- Desde el corte oficial, incluye other acreditados; no billing ni installation.
-- Los contadores deduplican por orden/tecnico; las sumas conservan cada aporte.
with period as (select $1 as start_date,$2 as end_date),
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
  order by total_points desc, technician_name) r$candidate_query$ into v_expected using v_period.start_at,v_period.end_at;
    if (select coalesce(jsonb_agg(e-'averias_count'-'rutinas_count' order by e->>'technician_id'),'[]') from jsonb_array_elements(v_before) e)
        is distinct from (select coalesce(jsonb_agg(e-'averias_count'-'rutinas_count' order by e->>'technician_id'),'[]') from jsonb_array_elements(v_expected) e) then raise exception 'Cambian puntos/penalizaciones/Altas/posiciones: %',v_period.label; end if;
    snapshots:=snapshots||jsonb_build_array(jsonb_build_object('label',v_period.label,'start',v_period.start_at,'end',v_period.end_at,'expected',v_expected));
  end loop;
  execute $replacement$CREATE OR REPLACE FUNCTION public.technician_ranking_between(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(technician_id uuid, technician_name text, installations_count bigint, averias_count bigint, reconexiones_count bigint, rutinas_count bigint, reincidencias_count bigint, total_points numeric, ranking integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;$replacement$;
  if md5(pg_get_functiondef('public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure))<>'95d53cc0d5275132dae320fcf127a5fc' then raise exception 'Definicion candidata inesperada'; end if;
  if v_metadata is distinct from (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure) then
    raise exception 'Firma/OID/owner/permisos/atributos alterados'; end if;
  if v_deps is distinct from (select coalesce(jsonb_agg(to_jsonb(d) order by d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]') from pg_depend d
    where (d.classid='pg_proc'::regclass and d.objid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure)
       or (d.refclassid='pg_proc'::regclass and d.refobjid='public.technician_ranking_between(timestamp with time zone,timestamp with time zone)'::regprocedure)) then raise exception 'Dependencias alteradas'; end if;
  if v_helpers is distinct from (select jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) from pg_proc p
    where p.oid in ('public.confirm_work_order_points(text,uuid,numeric,text,text,boolean)'::regprocedure,'public.get_technician_period_ranking(text,date)'::regprocedure,'public.get_technician_ranking(integer,integer)'::regprocedure,'public.technician_point_contributions(timestamp with time zone,timestamp with time zone)'::regprocedure,'public.technician_point_contributions_legacy(timestamp with time zone,timestamp with time zone)'::regprocedure,'public.work_order_point_review(text,uuid)'::regprocedure)) then raise exception 'Otra funcion alterada'; end if;
  for entry in select value from jsonb_array_elements(snapshots) loop
    select coalesce(jsonb_agg(to_jsonb(r) order by technician_id),'[]') into v_after
      from public.technician_ranking_between((entry->>'start')::timestamptz,(entry->>'end')::timestamptz) r;
    if v_after is distinct from entry->'expected' then raise exception 'Verificacion posterior fallo: %',entry->>'label'; end if;
  end loop;
  raise notice 'PASS: contadores esperados; puntos/Altas/posiciones/permisos/dependencias conservados';
end $activation$;
commit;
