-- SmartRayco — Fase 118: auto-asignacion de Altas (installations) y Rutinas
-- sin tecnico, igual que ya existia para Averias (Fase 98).
--
-- Hasta ahora una Alta/Rutina creada sin tecnico asignado quedaba invisible
-- para CUALQUIER tecnico en la App de Campo (trabajos solo muestra lo que
-- ya tiene assigned_to = uid, y no habia pool de "Disponibles" como el de
-- Averias) — nadie podia tomarla salvo que despacho la asignara a mano desde
-- el Panel Web. Mismo mecanismo que self_assign_ticket: funcion SECURITY
-- DEFINER que valida que el job no tenga ya alguien y lo convierte en su
-- unico lider via job_assignees (el trigger de sync de la Fase 94/101 ya
-- escribe installations.assigned_to / routines.assigned_to solo). A
-- diferencia de self_assign_ticket, no hay cambio de estado: una instalacion
-- no tiene un estado "en_progreso" propio (solo pending/scheduled/completed/
-- cancelled) y una rutina se queda en su estado actual hasta que el tecnico
-- avance el trabajo por su cuenta — mismo criterio que ya regia cuando
-- despacho asignaba a mano.

create or replace function public.self_assign_installation(p_installation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_assigned uuid;
  v_status public.installation_status;
begin
  if public.current_user_role() <> 'TECNICO_RED' then
    raise exception 'Solo un tecnico de red puede auto-asignarse una instalacion';
  end if;

  select assigned_to, status into v_assigned, v_status
  from public.installations
  where id = p_installation_id
  for update;

  if not found then
    raise exception 'Instalacion no encontrada';
  end if;
  if v_assigned is not null then
    raise exception 'Esta instalacion ya tiene un tecnico asignado';
  end if;
  if v_status not in ('pending', 'scheduled') then
    raise exception 'Esta instalacion ya no esta disponible';
  end if;

  insert into public.job_assignees (job_type, job_id, technician_id, role)
  values ('installation', p_installation_id, v_uid, 'leader');
end;
$$;

create or replace function public.self_assign_routine(p_routine_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_assigned uuid;
  v_status public.routine_status;
begin
  if public.current_user_role() <> 'TECNICO_RED' then
    raise exception 'Solo un tecnico de red puede auto-asignarse una rutina';
  end if;

  select assigned_to, status into v_assigned, v_status
  from public.routines
  where id = p_routine_id
  for update;

  if not found then
    raise exception 'Rutina no encontrada';
  end if;
  if v_assigned is not null then
    raise exception 'Esta rutina ya tiene un tecnico asignado';
  end if;
  if v_status not in ('pending', 'scheduled') then
    raise exception 'Esta rutina ya no esta disponible';
  end if;

  insert into public.job_assignees (job_type, job_id, technician_id, role)
  values ('routine', p_routine_id, v_uid, 'leader');
end;
$$;

revoke all on function public.self_assign_installation(uuid) from public;
revoke all on function public.self_assign_routine(uuid) from public;
grant execute on function public.self_assign_installation(uuid) to authenticated;
grant execute on function public.self_assign_routine(uuid) to authenticated;
