-- Fase 98: auto-asignacion de un ticket sin tecnico — un tecnico libre puede
-- "tomar" una averia que todavia nadie atendio desde la App de Campo, sin
-- esperar a que despacho (SUPERADMIN/ADMIN/SOPORTE) se la asigne a mano.
--
-- job_assignees_write_dispatch (Fase 94) le niega a TECNICO_RED escribir en
-- job_assignees A PROPOSITO ("evita que se auto-asigne apoyo, se quite de
-- una orden, o se nombre lider") — esa regla sigue valida para moverse
-- DENTRO de una cuadrilla ya armada. Lo que se habilita aca es un caso mas
-- angosto y seguro: tomar un ticket que TODAVIA NO TIENE A NADIE
-- (assigned_to is null), convirtiendose en su unico lider. Se resuelve con
-- una funcion SECURITY DEFINER en vez de abrir la RLS, para mantener la
-- validacion (ticket sin asignar, rol tecnico, bloqueo de la fila) en un
-- solo lugar atomico — el "for update" evita que 2 tecnicos tomen el mismo
-- ticket en la misma carrera (el segundo espera el lock, y al obtenerlo ve
-- assigned_to ya no nulo gracias al trigger de sync de la Fase 94).

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

  update public.tickets set status = 'in_progress' where id = p_ticket_id;
end;
$$;

revoke all on function public.self_assign_ticket(uuid) from public;
grant execute on function public.self_assign_ticket(uuid) to authenticated;
