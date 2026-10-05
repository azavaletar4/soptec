-- SmartRayco — Fase 102b: "Cliente Ausente" / re-agendamiento prioritario.
-- El tecnico llega, el cliente no esta: marca el ticket como 'rescheduled'
-- (en vez de dejarlo 'in_progress' colgado o perderlo de vista), con una
-- fecha/hora de reprogramacion y un motivo breve. La prioridad sube a
-- 'urgent' automaticamente para que no se pierda en la lista.
--
-- OJO: tickets.priority tiene un candado (Fase 89) que le prohibe a
-- TECNICO_RED cambiarla — a proposito, para que el tecnico no se autosuba
-- la urgencia de lo que le toca. Esta fase NO abre ese candado en general:
-- solo permite el caso puntual de que la propia transicion a 'rescheduled'
-- la suba a 'urgent' (no cualquier otro valor), igual patron que Fase 98/99
-- (RPC/trigger angosto en vez de aflojar la regla general).

alter table public.tickets add column if not exists rescheduled_to timestamptz;
alter table public.tickets add column if not exists reschedule_reason text;

create or replace function public.guard_tecnico_no_cambia_prioridad()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.current_user_role() = 'TECNICO_RED'
    and new.priority is distinct from old.priority
    and not (
      new.status = 'rescheduled'
      and old.status is distinct from 'rescheduled'
      and new.priority = 'urgent'
    )
  then
    raise exception 'Solo admin/soporte puede cambiar la prioridad de un ticket';
  end if;
  return new;
end;
$$;
