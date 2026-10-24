-- CANDIDATA LOCAL: no ejecutar en producción sin autorización.
-- Sin backfill: los históricos conservan sus valores y reglas fallback.
begin;
alter table public.installations add column points numeric check (points > 0 and points < 'Infinity'::numeric);

-- No existe auditoría genérica de cambios de puntuación. Mismo patrón
-- append-only/RLS de routine_returns e installation_postponements.
create table public.work_order_point_changes (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('ticket','installation','routine')),
  job_id uuid not null,
  old_points numeric,
  new_points numeric not null check (new_points > 0 and new_points < 'Infinity'::numeric),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default clock_timestamp(),
  reason text not null check (length(btrim(reason)) between 1 and 1000)
);
create index work_order_point_changes_history on public.work_order_point_changes(job_type,job_id,changed_at desc);
alter table public.work_order_point_changes enable row level security;
revoke all on public.work_order_point_changes from public, anon, authenticated;
grant select on public.work_order_point_changes to authenticated;
create policy work_order_point_changes_admin_read on public.work_order_point_changes
for select to authenticated using (public.current_user_role() in ('ADMIN','SUPERADMIN'));

create function public.guard_work_order_points() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_reason text;
  v_role text;
begin
  if tg_op='INSERT' then
    if new.points is null or not (new.points > 0 and new.points < 'Infinity'::numeric) then
      raise exception 'La orden requiere puntos mayores a 0';
    end if;
    return new;
  end if;
  if new.points is not distinct from old.points then return new; end if;
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if v_role is null or v_role not in ('ADMIN','SUPERADMIN') then
    raise exception 'Solo ADMIN/SUPERADMIN puede ajustar puntos';
  end if;
  if old.status::text not in ('open','pending','scheduled','assigned','in_progress','rescheduled')
     or new.status::text not in ('open','pending','scheduled','assigned','in_progress','rescheduled') then
    raise exception 'La orden ya está cerrada o cancelada';
  end if;
  if new.points is null or not (new.points > 0 and new.points < 'Infinity'::numeric) then
    raise exception 'La orden requiere puntos mayores a 0';
  end if;
  v_reason := nullif(btrim(current_setting('smartrayco.points_reason',true)),'');
  if v_reason is null or length(v_reason)>1000 then
    raise exception 'Utiliza el ajuste administrativo con motivo obligatorio';
  end if;
  insert into public.work_order_point_changes(job_type,job_id,old_points,new_points,changed_by,reason)
  values (case tg_table_name when 'tickets' then 'ticket' when 'installations' then 'installation' else 'routine' end,
    old.id,old.points,new.points,auth.uid(),v_reason);
  return new;
end;
$$;
revoke all on function public.guard_work_order_points() from public,anon,authenticated;
create trigger guard_work_order_points before insert or update on public.tickets
for each row execute function public.guard_work_order_points();
create trigger guard_work_order_points before insert or update on public.installations
for each row execute function public.guard_work_order_points();
create trigger guard_work_order_points before insert or update on public.routines
for each row execute function public.guard_work_order_points();

create function public.adjust_work_order_points(p_job_type text,p_job_id uuid,p_points numeric,p_expected_points numeric,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_table text;
  v_old numeric;
  v_status text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN')) then
    raise exception 'Solo ADMIN/SUPERADMIN puede ajustar puntos';
  end if;
  v_table := case p_job_type when 'ticket' then 'tickets' when 'installation' then 'installations' when 'routine' then 'routines' end;
  if v_table is null then raise exception 'Tipo de orden inválido'; end if;
  if p_points is null or not (p_points>0 and p_points<'Infinity'::numeric)
     or (p_job_type='ticket' and (p_points<>trunc(p_points) or p_points>2147483647)) then
    raise exception 'Puntos inválidos';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Motivo obligatorio (máximo 1000 caracteres)';
  end if;
  execute format('select points,status::text from public.%I where id=$1 for update',v_table)
    into v_old,v_status using p_job_id;
  if v_status is null then raise exception 'La orden no existe'; end if;
  if v_status not in ('open','pending','scheduled','assigned','in_progress','rescheduled') then
    raise exception 'La orden ya está cerrada o cancelada';
  end if;
  if v_old is distinct from p_expected_points then
    raise exception 'El puntaje cambió; recarga la orden antes de ajustar';
  end if;
  perform set_config('smartrayco.points_reason',btrim(p_reason),true);
  execute format('update public.%I set points=$1 where id=$2',v_table) using p_points,p_job_id;
  perform set_config('smartrayco.points_reason','',true);
end;
$$;
revoke all on function public.adjust_work_order_points(text,uuid,numeric,numeric,text) from public,anon;
grant execute on function public.adjust_work_order_points(text,uuid,numeric,numeric,text) to authenticated;

-- Reutilizar la fuente compartida instalada por Mi avance. Mantener cuadrilla,
-- penalizaciones, calendario y agregados. Fallar ante deriva de definición.
do $patch$
declare v_def text;
begin
  if to_regprocedure('public.technician_point_contributions(timestamptz,timestamptz)') is null then
    raise exception 'Falta la fuente compartida de puntos: revisar instalación antes de continuar';
  end if;
  if (select md5(prosrc) from pg_proc where oid='public.technician_point_contributions(timestamptz,timestamptz)'::regprocedure)
     <> '26a40b0e3a17831849b67a6562b6036d' then
    raise exception 'Deriva de la fuente de puntos instalada: revisar antes de continuar';
  end if;
  select pg_get_functiondef('public.technician_point_contributions(timestamptz,timestamptz)'::regprocedure) into v_def;
  if position('select i.id, i.assigned_to, i.completed_at as occurred_at' in v_def)=0
     or position('select ij.id as job_id, ij.occurred_at,' in v_def)=0
     or position('10.0 / greatest(crew_size, 1) from install_crew' in v_def)=0
     or position('else 0' in v_def)=0 then
    raise exception 'Deriva de la fuente de puntos: revisar antes de continuar';
  end if;
  v_def:=replace(v_def,'select i.id, i.assigned_to, i.completed_at as occurred_at',
    'select i.id, i.assigned_to, i.points, i.completed_at as occurred_at');
  v_def:=replace(v_def,'select ij.id as job_id, ij.occurred_at,',
    'select ij.id as job_id, ij.occurred_at, ij.points,');
  v_def:=replace(v_def,'10.0 / greatest(crew_size, 1) from install_crew',
    'coalesce(points, 10.0) / greatest(crew_size, 1) from install_crew');
  -- Categorías sin regla automática: respetar el puntaje manual cuando existe.
  -- Históricos NULL siguen sumando 0; no inventar puntuación retrospectiva.
  v_def:=replace(v_def,'else 0','else coalesce(points, 0)');
  execute v_def;
end $patch$;

-- Reporte de tickets: conservar cohorte por creación, calcular puntos de
-- trabajos terminados con la misma fuente que ranking/Mi avance.
create function public.ticket_report_points(p_from timestamptz,p_to timestamptz)
returns table (staff_id uuid,name text,ticket_count bigint,points numeric)
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active
    and role::text in ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION')) then
    raise exception 'Acceso no autorizado al reporte de puntos';
  end if;
  if p_from is null or p_to is null or p_to<p_from then raise exception 'Intervalo inválido'; end if;
  return query
  with selected as materialized (
    select t.id,coalesce(t.resolved_at,t.closed_at) as finished_at from public.tickets t
    where t.created_at>=p_from and t.created_at<=p_to and t.status::text in ('resolved','closed')
  ), bounds as (select min(finished_at) as lo,max(finished_at)+interval '1 microsecond' as hi from selected),
  contributions as (
    select c.* from bounds b cross join lateral public.technician_point_contributions(b.lo,b.hi) c
    join selected s on s.id=c.job_id where c.job_type='ticket'
  )
  select c.technician_id,coalesce(pr.full_name,pr.email,'Técnico'),
    count(distinct c.job_id) filter(where c.kind='work'),
    sum(case when c.kind='recurrence' then -c.points else c.points end)
  from contributions c join public.profiles pr on pr.id=c.technician_id
  group by c.technician_id,pr.full_name,pr.email;
end;
$$;
revoke all on function public.ticket_report_points(timestamptz,timestamptz) from public,anon;
grant execute on function public.ticket_report_points(timestamptz,timestamptz) to authenticated;
commit;
