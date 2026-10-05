-- Fase 99: devolucion de un ticket ya tomado — el tecnico llega a la
-- direccion y el cliente no esta (salio, no contesta...). En vez de dejarlo
-- "en el limbo" asignado a alguien que ya no puede atenderlo hoy, el propio
-- tecnico lo devuelve a la bolsa de tickets libres (Fase 98) dejando una
-- nota obligatoria de por que, para que quede registro (visible para
-- despacho en el seguimiento del ticket, TicketDetailView ya muestra
-- ticket_comments).
--
-- Mismo motivo que self_assign_ticket para usar SECURITY DEFINER en vez de
-- abrir la RLS de job_assignees: la Fase 94 le niega a TECNICO_RED escribir
-- ahi a proposito. Aca el caso es igual de acotado — solo puede devolver un
-- ticket del que el MISMO es parte de la cuadrilla, dejando constancia.

create or replace function public.return_ticket(p_ticket_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_crew boolean;
begin
  if public.current_user_role() <> 'TECNICO_RED' then
    raise exception 'Solo un tecnico de red puede devolver una orden';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Falta el motivo de la devolucion';
  end if;

  select exists (
    select 1 from public.job_assignees
    where job_type = 'ticket' and job_id = p_ticket_id and technician_id = v_uid
  ) into v_is_crew;

  if not v_is_crew then
    raise exception 'No estas asignado a este ticket';
  end if;

  insert into public.ticket_comments (ticket_id, author_id, body)
  values (p_ticket_id, v_uid, '↩️ Orden devuelta — ' || btrim(p_reason));

  delete from public.job_assignees where job_type = 'ticket' and job_id = p_ticket_id;

  update public.tickets set status = 'open' where id = p_ticket_id;
end;
$$;

revoke all on function public.return_ticket(uuid, text) from public;
grant execute on function public.return_ticket(uuid, text) to authenticated;
