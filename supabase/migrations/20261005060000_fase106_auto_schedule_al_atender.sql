-- SmartRayco — Fase 106: corrige la bandeja "Sin horario asignado" del
-- Cronograma (ya no debe seguir pidiendo agendar algo que ya se resolvio) y
-- auto-agenda la hora real de atencion cuando un ticket se resuelve o se
-- auto-asigna sin tener hora previa — para que quede ubicado en su fila del
-- Cronograma en vez de perderse.
--
-- El filtrado estricto de "Sin horario asignado" (excluir resuelto/cerrado)
-- y el switch "Ocultar Resueltos" son cambios de frontend puros
-- (DispatchBoardView.vue) — esta migracion es solo la mitad de Fase 106
-- que vive en la base de datos: self_assign_ticket (Fase 98) ahora deja
-- scheduled_start_at/scheduled_end_at agendados con la hora real si el
-- ticket no tenia ninguna todavia (coalesce — nunca pisa una hora ya
-- puesta por despacho, Fase 104).

create or replace function public.self_assign_ticket(p_ticket_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_assigned uuid;
begin
  if public.current_user_role() <> 'TECNICO_RED' then
    raise exception 'Solo un tecnico de red puede auto-asignarse un ticket';
  end if;

  select assigned_to into v_assigned
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket no encontrado';
  end if;
  if v_assigned is not null then
    raise exception 'Este ticket ya tiene un tecnico asignado';
  end if;

  insert into public.job_assignees (job_type, job_id, technician_id, role)
  values ('ticket', p_ticket_id, v_uid, 'leader');

  update public.tickets
  set
    status = 'in_progress',
    scheduled_start_at = coalesce(scheduled_start_at, now()),
    scheduled_end_at = coalesce(scheduled_end_at, now() + interval '1 hour')
  where id = p_ticket_id;
end;
$$;
