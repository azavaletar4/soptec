-- Fase 161: propuesta LOCAL. No aplicar sin autorizacion explicita.
begin;

create table public.routine_returns (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete restrict,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  returned_at timestamptz not null default clock_timestamp(),
  reason text not null check (btrim(reason) <> ''),
  crew_snapshot jsonb not null
);
create index idx_routine_returns_history on public.routine_returns(routine_id, returned_at desc);
alter table public.routine_returns enable row level security;
revoke all on public.routine_returns from public, anon, authenticated;
grant select on public.routine_returns to authenticated;
create policy routine_returns_read_staff on public.routine_returns
  for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED'));

create function public.return_routine(p_routine_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.routine_status;
  v_crew jsonb;
begin
  if v_uid is null or public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Solo un tecnico de red activo puede devolver una rutina';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Escribe el motivo de la devolucion';
  end if;
  -- Serializa devoluciones y cambios de estado de la misma orden.
  select status into v_status from public.routines where id = p_routine_id for update;
  if not found then raise exception 'La rutina no existe'; end if;
  if v_status <> 'in_progress' then
    raise exception 'Solo puedes devolver una rutina en progreso';
  end if;
  perform 1 from public.job_assignees
    where job_type = 'routine' and job_id = p_routine_id for update;
  if not exists (select 1 from public.job_assignees
    where job_type = 'routine' and job_id = p_routine_id and technician_id = v_uid) then
    raise exception 'No estas asignado a esta rutina';
  end if;
  select jsonb_agg(jsonb_build_object('technician_id', technician_id, 'role', role)
    order by technician_id) into v_crew from public.job_assignees
    where job_type = 'routine' and job_id = p_routine_id;
  insert into public.routine_returns(routine_id, technician_id, reason, crew_snapshot)
    values (p_routine_id, v_uid, btrim(p_reason), v_crew);
  -- El cambio de estado cierra la sesion de trabajo mediante el trigger existente.
  update public.routines set status = 'pending', assigned_to = null where id = p_routine_id;
  delete from public.job_assignees where job_type = 'routine' and job_id = p_routine_id;
end;
$$;
revoke all on function public.return_routine(uuid, text) from public, anon;
grant execute on function public.return_routine(uuid, text) to authenticated;
commit;
