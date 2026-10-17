-- Fase 163: propuesta LOCAL. No aplicar sin autorizacion explicita.
-- Caso real de piloto (17/10/2026): el tecnico Jadir tiene una Alta
-- 'in_progress' y el cliente sale — Averias ya tiene "Devolver orden"
-- (Fase 99) y Rutinas ya tiene su propia devolucion (Fase 161), pero Altas
-- no tenia ningun flujo equivalente: el tecnico quedaba sin forma de
-- liberar la orden sin completarla ni perder informacion.
--
-- Mismo patron exacto que return_routine (Fase 161), solo con el nombre de
-- la tabla/funcion para Altas: tabla de auditoria propia (quien, cuando,
-- motivo, foto de la cuadrilla al momento de postergar) + la instalacion
-- vuelve a 'pending' sin tecnico asignado, visible para que
-- administracion la reprograme (misma policy "installations_staff_only"
-- de Fase 9, sin tocarla). El cambio de 'in_progress' a 'pending' cierra la
-- sesion de trabajo activa mediante el trigger ya existente
-- (track_job_work_session, Fase 150/150b) con end_reason='paused' — no se
-- duplica esa logica aqui. No completa la instalacion, no toca
-- notes/fotos/equipos/materiales/movimientos ni el contrato.
begin;

create table public.installation_postponements (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  postponed_at timestamptz not null default clock_timestamp(),
  reason text not null check (btrim(reason) <> ''),
  crew_snapshot jsonb not null
);
create index idx_installation_postponements_history
  on public.installation_postponements(installation_id, postponed_at desc);
alter table public.installation_postponements enable row level security;
revoke all on public.installation_postponements from public, anon, authenticated;
grant select on public.installation_postponements to authenticated;
create policy installation_postponements_read_staff on public.installation_postponements
  for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED'));

create function public.postpone_installation(p_installation_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.installation_status;
  v_crew jsonb;
begin
  if v_uid is null or public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Solo un tecnico de red activo puede postergar una instalacion';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Escribe el motivo de la postergacion';
  end if;
  -- Serializa postergaciones y cambios de estado de la misma orden.
  select status into v_status from public.installations where id = p_installation_id for update;
  if not found then raise exception 'La instalacion no existe'; end if;
  if v_status <> 'in_progress' then
    raise exception 'Solo puedes postergar una instalacion en progreso';
  end if;
  perform 1 from public.job_assignees
    where job_type = 'installation' and job_id = p_installation_id for update;
  if not exists (select 1 from public.job_assignees
    where job_type = 'installation' and job_id = p_installation_id and technician_id = v_uid) then
    raise exception 'No estas asignado a esta instalacion';
  end if;
  select jsonb_agg(jsonb_build_object('technician_id', technician_id, 'role', role)
    order by technician_id) into v_crew from public.job_assignees
    where job_type = 'installation' and job_id = p_installation_id;
  insert into public.installation_postponements(installation_id, technician_id, reason, crew_snapshot)
    values (p_installation_id, v_uid, btrim(p_reason), v_crew);
  -- El cambio de estado cierra la sesion de trabajo mediante el trigger existente.
  update public.installations set status = 'pending', assigned_to = null where id = p_installation_id;
  delete from public.job_assignees where job_type = 'installation' and job_id = p_installation_id;
end;
$$;
revoke all on function public.postpone_installation(uuid, text) from public, anon;
grant execute on function public.postpone_installation(uuid, text) to authenticated;
commit;
