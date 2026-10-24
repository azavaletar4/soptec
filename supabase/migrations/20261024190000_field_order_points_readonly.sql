-- CANDIDATA LOCAL. Consulta operativa: no acredita puntos ni cierra órdenes.
-- La acreditación oficial desde noviembre está detenida hasta definir el cierre
-- administrativo que falta en Altas y Rutinas. No modifica funciones de ranking.
begin;
create function public.my_field_order_points(p_job_type text,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  actor uuid:=auth.uid();
  assigned uuid;
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
    select t.assigned_to,t.status::text,t.category::text,t.points into assigned,order_status,category,configured
    from public.tickets t where t.id=p_job_id;
  elsif p_job_type='installation' then
    -- Compatible con Altas históricas sin la columna candidata de puntos.
    select i.assigned_to,i.status::text,(to_jsonb(i)->>'points')::numeric into assigned,order_status,configured
    from public.installations i where i.id=p_job_id;
  elsif p_job_type='routine' then
    select r.assigned_to,r.status::text,r.points into assigned,order_status,configured
    from public.routines r where r.id=p_job_id;
  else
    raise exception 'Tipo de orden inválido' using errcode='22023';
  end if;
  if order_status is null then return null; end if;
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
    'personalPoints',total_points/crew_size,'crewSize',crew_size,'status',order_status,'asOf',now());
end;
$$;
revoke all on function public.my_field_order_points(text,uuid) from public,anon,service_role;
grant execute on function public.my_field_order_points(text,uuid) to authenticated;
commit;
