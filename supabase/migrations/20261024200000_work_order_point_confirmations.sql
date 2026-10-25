-- CANDIDATA LOCAL. Depende de 20261024180000 y 20261024190000.
-- No nuevos estados técnicos, backfill, pagos ni libro de acumulación.
begin;
create table public.work_order_point_confirmations (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check(job_type in ('ticket','installation','routine')),
  job_id uuid not null,
  points numeric not null check(points>0 and points<'Infinity'::numeric),
  recurrence_penalty numeric not null default 0 check(recurrence_penalty in (0,5)),
  crew jsonb not null check(jsonb_typeof(crew)='array' and jsonb_array_length(crew)>0),
  technical_completed_at timestamptz not null,
  order_created_at timestamptz not null,
  category text,
  client_id uuid,
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default clock_timestamp(),
  review_token text not null,
  invalidated_at timestamptz,
  invalidated_by uuid references public.profiles(id),
  invalidation_reason text
);
create unique index work_order_point_confirmation_current on public.work_order_point_confirmations(job_type,job_id);
create index work_order_point_confirmation_period on public.work_order_point_confirmations(confirmed_at);
alter table public.work_order_point_confirmations enable row level security;
revoke all on public.work_order_point_confirmations from public,anon,authenticated,service_role;
grant select on public.work_order_point_confirmations to authenticated;
create policy point_confirmations_admin_read on public.work_order_point_confirmations for select to authenticated
using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role::text in ('ADMIN','SUPERADMIN')));

create function public.work_order_point_review(p_job_type text,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare o jsonb; crew jsonb; latest jsonb; current_confirmation jsonb; done timestamptz; token text; history_revision text; penalty numeric:=0;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN')) then
    raise exception 'Solo ADMIN/SUPERADMIN puede revisar puntos' using errcode='42501';
  end if;
  if p_job_type='ticket' then select to_jsonb(t) into o from public.tickets t where id=p_job_id;
  elsif p_job_type='installation' then select to_jsonb(t) into o from public.installations t where id=p_job_id;
  elsif p_job_type='routine' then select to_jsonb(t) into o from public.routines t where id=p_job_id;
  else raise exception 'Tipo de orden inválido'; end if;
  if o is null then raise exception 'La orden no existe'; end if;
  done:=case when p_job_type='ticket' then coalesce((o->>'resolved_at')::timestamptz,(o->>'closed_at')::timestamptz)
    else (o->>'completed_at')::timestamptz end;
  if p_job_type='ticket' and o->>'category' in ('no_service','slow_speed','equipment') and exists(
    select 1 from public.tickets t2 where t2.client_id=(o->>'client_id')::uuid and t2.id<>p_job_id
    and t2.category::text in ('no_service','slow_speed','equipment') and t2.created_at>done
    and t2.created_at<=done+interval '7 days' and t2.imputable_a_tecnico
  ) then penalty:=5; end if;
  select jsonb_agg(jsonb_build_object('technicianId',j.technician_id,'role',j.role,
    'name',coalesce(nullif(p.full_name,''),p.email,'Técnico')) order by j.technician_id) into crew
  from public.job_assignees j join public.profiles p on p.id=j.technician_id
  where j.job_type=p_job_type and j.job_id=p_job_id;
  if crew is null and o->>'assigned_to' is not null then
    select jsonb_build_array(jsonb_build_object('technicianId',p.id,'role','leader','name',coalesce(nullif(p.full_name,''),p.email,'Técnico')))
    into crew from public.profiles p where p.id=(o->>'assigned_to')::uuid;
  end if;
  crew:=coalesce(crew,'[]'::jsonb);
  select to_jsonb(c) into latest from public.work_order_point_confirmations c
  where c.job_type=p_job_type and c.job_id=p_job_id order by c.confirmed_at desc,c.id desc limit 1;
  select to_jsonb(c) into current_confirmation from public.work_order_point_confirmations c
  where c.job_type=p_job_type and c.job_id=p_job_id;
  -- Incluye toda la fila y ciclo anterior: una revisión vieja no sirve tras
  -- reasignación, reapertura o cambio de puntuación/estado.
  select md5(coalesce(string_agg(c.id::text||coalesce(c.invalidated_at::text,''),',' order by c.id),'')) into history_revision
  from public.work_order_point_confirmations c where c.job_type=p_job_type and c.job_id=p_job_id;
  token:=md5(jsonb_build_object('order',o,'crew',crew,'history',history_revision,'penalty',penalty)::text);
  return jsonb_build_object('points',o->'points','status',o->>'status','technicalCompletedAt',done,
    'createdAt',o->>'created_at',
    'historical',done is not null and (done<timestamptz '2026-11-01 00:00:00 America/Lima' or (o->>'created_at')::timestamptz<timestamptz '2026-11-01 00:00:00 America/Lima'),
    'finished',case when p_job_type='ticket' then o->>'status' in ('resolved','closed') else o->>'status'='completed' end,
    'crew',crew,'recurrencePenalty',penalty,'definitiveClosure',true,'token',token,'confirmation',current_confirmation,'lastConfirmation',latest);
end;
$$;
revoke all on function public.work_order_point_review(text,uuid) from public,anon,service_role;
grant execute on function public.work_order_point_review(text,uuid) to authenticated;

-- Misma guarda y auditoría de 506b35a: ampliar solo a terminadas pendientes.
create or replace function public.guard_work_order_points() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_reason text; v_role text; kind text; done timestamptz;
begin
  if tg_op='INSERT' then
    if new.points is null or not(new.points>0 and new.points<'Infinity'::numeric) then raise exception 'La orden requiere puntos mayores a 0'; end if;
    return new;
  end if;
  if new.points is not distinct from old.points then return new; end if;
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if v_role is null or v_role not in ('ADMIN','SUPERADMIN') then raise exception 'Solo ADMIN/SUPERADMIN puede ajustar puntos'; end if;
  kind:=case tg_table_name when 'tickets' then 'ticket' when 'installations' then 'installation' else 'routine' end;
  if old.status::text='cancelled' or new.status::text='cancelled' then raise exception 'La orden está cancelada'; end if;
  if exists(select 1 from public.work_order_point_confirmations c where c.job_type=kind and c.job_id=old.id) then
    raise exception 'Los puntos ya están confirmados';
  end if;
  done:=case when kind='ticket' then coalesce((to_jsonb(old)->>'resolved_at')::timestamptz,(to_jsonb(old)->>'closed_at')::timestamptz)
    else (to_jsonb(old)->>'completed_at')::timestamptz end;
  if done is not null and (done<timestamptz '2026-11-01 00:00:00 America/Lima' or (to_jsonb(old)->>'created_at')::timestamptz<timestamptz '2026-11-01 00:00:00 America/Lima') then raise exception 'No se modifican puntos históricos de octubre'; end if;
  if new.points is null or not(new.points>0 and new.points<'Infinity'::numeric) then raise exception 'La orden requiere puntos mayores a 0'; end if;
  v_reason:=nullif(btrim(current_setting('smartrayco.points_reason',true)),'');
  if v_reason is null or length(v_reason)>1000 then raise exception 'Utiliza el ajuste administrativo con motivo obligatorio'; end if;
  insert into public.work_order_point_changes(job_type,job_id,old_points,new_points,changed_by,reason)
  values(kind,old.id,old.points,new.points,auth.uid(),v_reason);
  return new;
end;
$$;

create or replace function public.adjust_work_order_points(p_job_type text,p_job_id uuid,p_points numeric,p_expected_points numeric,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare tbl text; previous numeric; state text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN')) then raise exception 'Solo ADMIN/SUPERADMIN puede ajustar puntos'; end if;
  tbl:=case p_job_type when 'ticket' then 'tickets' when 'installation' then 'installations' when 'routine' then 'routines' end;
  if tbl is null then raise exception 'Tipo de orden inválido'; end if;
  if p_points is null or not(p_points>0 and p_points<'Infinity'::numeric) or (p_job_type='ticket' and (p_points<>trunc(p_points) or p_points>2147483647)) then raise exception 'Puntos inválidos'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Motivo obligatorio (máximo 1000 caracteres)'; end if;
  execute format('select points,status::text from public.%I where id=$1 for update',tbl) into previous,state using p_job_id;
  if state is null then raise exception 'La orden no existe'; end if;
  if state='cancelled' then raise exception 'La orden está cancelada'; end if;
  if previous is distinct from p_expected_points then raise exception 'El puntaje cambió; recarga la orden antes de ajustar'; end if;
  perform set_config('smartrayco.points_reason',btrim(p_reason),true);
  execute format('update public.%I set points=$1 where id=$2',tbl) using p_points,p_job_id;
  perform set_config('smartrayco.points_reason','',true);
end;
$$;

create function public.confirm_work_order_points(p_job_type text,p_job_id uuid,p_points numeric,p_expected_token text,p_reason text,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare tbl text; o jsonb; review jsonb; result public.work_order_point_confirmations; done timestamptz; frozen_crew jsonb; penalty numeric;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN')) then raise exception 'Solo ADMIN/SUPERADMIN puede confirmar puntos' using errcode='42501'; end if;
  if p_confirmed is distinct from true then raise exception 'Confirma explícitamente que los puntos son correctos'; end if;
  tbl:=case p_job_type when 'ticket' then 'tickets' when 'installation' then 'installations' when 'routine' then 'routines' end;
  if tbl is null then raise exception 'Tipo de orden inválido'; end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tbl) into o using p_job_id;
  if o is null then raise exception 'La orden no existe'; end if;
  select * into result from public.work_order_point_confirmations c where c.job_type=p_job_type and c.job_id=p_job_id;
  if found then
    if result.review_token=p_expected_token and result.points=p_points then return to_jsonb(result); end if;
    raise exception 'La orden ya tiene una confirmación vigente; recarga la revisión';
  end if;
  review:=public.work_order_point_review(p_job_type,p_job_id);
  if not(review->>'finished')::boolean or review->>'technicalCompletedAt' is null then raise exception 'El técnico todavía no ha terminado la orden'; end if;
  if o->>'created_at' is null then raise exception 'Falta la fecha original de creación; revisa la orden'; end if;
  if review->>'token' is distinct from p_expected_token then raise exception 'La orden o cuadrilla cambió; recarga la revisión'; end if;
  if jsonb_array_length(review->'crew')=0 then raise exception 'Asigna la cuadrilla antes de confirmar'; end if;
  -- Un reintento no actualiza/audita otra vez. La RPC reutiliza la misma
  -- actualización de puntos y su motivo; cualquier fallo revierte todo.
  if p_points is null or not(p_points>0 and p_points<'Infinity'::numeric) or (p_job_type='ticket' and (p_points<>trunc(p_points) or p_points>2147483647)) then raise exception 'Puntos inválidos'; end if;
  if p_points is distinct from (review->>'points')::numeric then
    perform public.adjust_work_order_points(p_job_type,p_job_id,p_points,(review->>'points')::numeric,p_reason);
  end if;
  done:=(review->>'technicalCompletedAt')::timestamptz;
  penalty:=(review->>'recurrencePenalty')::numeric;
  select jsonb_agg(member||jsonb_build_object('points',p_points/jsonb_array_length(review->'crew'),
    'recurrencePenalty',penalty/jsonb_array_length(review->'crew'),
    'netPoints',(p_points-penalty)/jsonb_array_length(review->'crew')) order by n)
    into frozen_crew from jsonb_array_elements(review->'crew') with ordinality as members(member,n);
  insert into public.work_order_point_confirmations(job_type,job_id,points,recurrence_penalty,crew,technical_completed_at,order_created_at,category,client_id,confirmed_by,review_token)
  values(p_job_type,p_job_id,p_points,penalty,frozen_crew,done,(o->>'created_at')::timestamptz,o->>'category',(o->>'client_id')::uuid,auth.uid(),p_expected_token)
  returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function public.confirm_work_order_points(text,uuid,numeric,text,text,boolean) from public,anon,service_role;
grant execute on function public.confirm_work_order_points(text,uuid,numeric,text,text,boolean) to authenticated;

-- Confirmar cierra administrativamente. Guardas comunes a UPDATE/DELETE y
-- RPCs SECURITY DEFINER: no hay excepción ordinaria para SUPERADMIN.
create function public.work_order_is_final(p_job_type text,p_job_id uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN','SOPORTE','TECNICO_RED','FACTURACION')) then
    raise exception 'Consulta exclusiva del personal activo' using errcode='42501';
  end if;
  if p_job_type not in ('ticket','installation','routine') or p_job_type is null then raise exception 'Tipo de orden inválido'; end if;
  return exists(select 1 from public.work_order_point_confirmations where job_type=p_job_type and job_id=p_job_id);
end;
$$;
revoke all on function public.work_order_is_final(text,uuid) from public,anon,service_role;
grant execute on function public.work_order_is_final(text,uuid) to authenticated;

create function public.guard_final_work_order() returns trigger
language plpgsql security definer set search_path=public as $$
declare contexts jsonb:='[]'; target record; tbl text;
begin
  if tg_table_name='job_assignees' then
    if tg_op<>'INSERT' then contexts:=contexts||jsonb_build_array(jsonb_build_object('kind',old.job_type,'id',old.job_id)); end if;
    if tg_op<>'DELETE' then contexts:=contexts||jsonb_build_array(jsonb_build_object('kind',new.job_type,'id',new.job_id)); end if;
  else
    contexts:=jsonb_build_array(jsonb_build_object('kind',case tg_table_name when 'tickets' then 'ticket' when 'installations' then 'installation' else 'routine' end,'id',old.id));
  end if;
  for target in select distinct c->>'kind' as kind,(c->>'id')::uuid as id from jsonb_array_elements(contexts)c order by 1,2 loop
    if tg_table_name='job_assignees' then
      tbl:=case target.kind when 'ticket' then 'tickets' when 'installation' then 'installations' else 'routines' end;
      -- Serializar cambios de cuadrilla con la misma fila que confirma la RPC.
      execute format('select 1 from public.%I where id=$1 for update',tbl) using target.id;
    end if;
    if exists(select 1 from public.work_order_point_confirmations where job_type=target.kind and job_id=target.id) then
      raise exception 'Cierre administrativo definitivo: la orden y su cuadrilla no se pueden modificar ni reabrir. Crea una nueva orden.' using errcode='P0001';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_final_work_order() from public,anon,authenticated,service_role;
create trigger a_guard_final_work_order before update or delete on public.tickets for each row execute function public.guard_final_work_order();
create trigger a_guard_final_work_order before update or delete on public.installations for each row execute function public.guard_final_work_order();
create trigger a_guard_final_work_order before update or delete on public.routines for each row execute function public.guard_final_work_order();
create trigger a_guard_final_work_order before insert or update or delete on public.job_assignees for each row execute function public.guard_final_work_order();

-- Extraer sin alterar la implementación histórica observada. La envoltura
-- conserva el nombre/firma y ACL que ya consumen ranking y Mi avance.
do $preserve$
declare definition text;
begin
  if (select md5(prosrc) from pg_proc where oid='public.technician_point_contributions(timestamptz,timestamptz)'::regprocedure)
    <> '26a40b0e3a17831849b67a6562b6036d' then raise exception 'Deriva en fuente compartida: revisar antes de migrar'; end if;
  select pg_get_functiondef('public.technician_point_contributions(timestamptz,timestamptz)'::regprocedure) into definition;
  execute replace(definition,'public.technician_point_contributions(', 'public.technician_point_contributions_legacy(');
end $preserve$;
revoke all on function public.technician_point_contributions_legacy(timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.technician_point_contributions(p_start timestamptz,p_end timestamptz)
returns table(technician_id uuid,job_type text,job_id uuid,occurred_at timestamptz,kind text,category text,crew_size bigint,points numeric)
language sql stable security definer set search_path=public as $$
  with official as materialized (
    select c.* from public.work_order_point_confirmations c
    where c.confirmed_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
      and c.order_created_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
      and c.technical_completed_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
      and c.confirmed_at>=p_start and c.confirmed_at<p_end
  ), crew as (
    select c.*, (member->>'technicianId')::uuid as technician_id,jsonb_array_length(c.crew)::bigint as crew_size,
      (member->>'points')::numeric as frozen_points,(member->>'recurrencePenalty')::numeric as frozen_penalty
    from official c cross join lateral jsonb_array_elements(c.crew) member
  )
  select * from public.technician_point_contributions_legacy(p_start,least(p_end,timestamptz '2026-11-01 00:00:00 America/Lima'))
  where p_start<timestamptz '2026-11-01 00:00:00 America/Lima'
  union all
  select c.technician_id,c.job_type,c.job_id,c.confirmed_at,'work',c.category,c.crew_size,c.frozen_points from crew c
  union all
  -- Descuento y partes congelados al confirmar; una nueva avería no los recalcula.
  select c.technician_id,c.job_type,c.job_id,c.confirmed_at,'recurrence',c.category,c.crew_size,c.frozen_penalty from crew c
  where c.frozen_penalty<>0;
$$;
revoke all on function public.technician_point_contributions(timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- El detalle personal usa la fecha del mismo aporte canónico, que desde
-- noviembre es la confirmación administrativa y no la finalización técnica.
create or replace function public.my_field_job_points(p_job_type text,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid(); event_at timestamptz; done timestamptz; result jsonb;
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and active and role::text='TECNICO_RED') then raise exception 'Exclusivo del propio técnico' using errcode='42501'; end if;
  if p_job_type='ticket' then select coalesce(t.resolved_at,t.closed_at) into done from public.tickets t where t.id=p_job_id and t.status::text in ('resolved','closed');
  elsif p_job_type='installation' then select completed_at into done from public.installations where id=p_job_id and status::text='completed';
  elsif p_job_type='routine' then select completed_at into done from public.routines where id=p_job_id and status::text='completed'; end if;
  if done is null then return null; end if;
  if done<timestamptz '2026-11-01 00:00:00 America/Lima' then event_at:=done;
  else select confirmed_at into event_at from public.work_order_point_confirmations where job_type=p_job_type and job_id=p_job_id; end if;
  if event_at is null then return null; end if;
  select jsonb_agg(jsonb_build_object('kind',c.kind,'crewSize',c.crew_size,'occurredAt',c.occurred_at,
    'points',case when c.kind='recurrence' then -c.points else c.points end) order by c.kind)
    into result from public.technician_point_contributions(event_at,event_at+interval '1 microsecond') c
    where c.technician_id=actor and c.job_type=p_job_type and c.job_id=p_job_id;
  return result;
end;
$$;
revoke all on function public.my_field_job_points(text,uuid) from public,anon,service_role;
grant execute on function public.my_field_job_points(text,uuid) to authenticated;

-- El endpoint mensual antiguo usaba la zona de sesión. Conservarlo para
-- históricos; desde noviembre usar Lima, evitando arrastrar las últimas
-- cinco horas de prueba de octubre al mes oficial de noviembre.
create or replace function public.get_technician_ranking(p_month int,p_year int)
returns table(technician_id uuid,technician_name text,installations_count bigint,averias_count bigint,
 reconexiones_count bigint,rutinas_count bigint,reincidencias_count bigint,total_points numeric,ranking int)
language sql stable security definer set search_path=public as $$
  with dates as (select make_date(p_year,p_month,1) as start_date,(make_date(p_year,p_month,1)+interval '1 month')::date as end_date)
  select r.* from dates d cross join lateral public.technician_ranking_between(
    case when d.start_date>=date '2026-11-01' then d.start_date::timestamp at time zone 'America/Lima' else d.start_date::timestamptz end,
    case when d.start_date>=date '2026-11-01' then d.end_date::timestamp at time zone 'America/Lima' else d.end_date::timestamptz end) r
  where current_setting('role',true)='service_role' or public.current_user_role() in ('ADMIN','SUPERADMIN','SOPORTE','TECNICO_RED');
$$;
revoke all on function public.get_technician_ranking(int,int) from public,anon;
grant execute on function public.get_technician_ranking(int,int) to authenticated,service_role;

-- Solo el apartado de puntos del reporte de tickets. Otros agregados y
-- reportes financieros no cambian. Histórico: misma cohorte creada, suma
-- manual y líder que tenía JS. Oficial: fuente canónica por confirmación.
create function public.ticket_report_points(p_from timestamptz,p_to timestamptz)
returns table(staff_id uuid,name text,ticket_count bigint,points numeric)
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION')) then raise exception 'Acceso no autorizado al reporte' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from then raise exception 'Intervalo inválido'; end if;
  return query
  with official as materialized (
    select c.* from public.technician_point_contributions(greatest(p_from,timestamptz '2026-11-01 00:00:00 America/Lima'),p_to+interval '1 microsecond') c
    where c.job_type='ticket' and c.occurred_at>=timestamptz '2026-11-01 00:00:00 America/Lima'
  ), entries as (
    select t.assigned_to as technician_id,1::bigint as work_count,coalesce(t.points,0)::numeric as amount
    from public.tickets t where t.created_at>=p_from and t.created_at<=p_to
      and t.created_at<timestamptz '2026-11-01 00:00:00 America/Lima' and t.assigned_to is not null
      and not exists(select 1 from official c where c.job_id=t.id)
    union all
    select c.technician_id,case when c.kind='work' then 1 else 0 end::bigint,
      case when c.kind='recurrence' then -c.points else c.points end from official c
  )
  select e.technician_id,coalesce(nullif(p.full_name,''),nullif(p.email,''),'Técnico'),sum(e.work_count)::bigint,sum(e.amount)
  from entries e left join public.profiles p on p.id=e.technician_id group by e.technician_id,p.full_name,p.email;
end;
$$;
revoke all on function public.ticket_report_points(timestamptz,timestamptz) from public,anon,service_role;
grant execute on function public.ticket_report_points(timestamptz,timestamptz) to authenticated;
commit;
