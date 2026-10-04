-- Fase 89: la prioridad de un ticket/averia (o de un "alta" = ticket
-- categoria 'installation') la fija admin/soporte al crear o triar el
-- caso — el tecnico asignado ejecuta pero no se sube/baja la urgencia de lo
-- que le tocó. El frontend ya deshabilita ese <select> para TECNICO_RED;
-- esto es el candado real por si se llama a la API directo.
--
-- La policy de update (RLS) no puede comparar OLD vs NEW de la misma fila
-- de forma confiable dentro de "with check", asi que se usa un trigger
-- BEFORE UPDATE, igual que el candado de client_photos en la Fase 70.

create or replace function public.guard_tecnico_no_cambia_prioridad()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.current_user_role() = 'TECNICO_RED' and new.priority is distinct from old.priority then
    raise exception 'Solo admin/soporte puede cambiar la prioridad de un ticket';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tickets_guard_prioridad_tecnico on public.tickets;
create trigger trg_tickets_guard_prioridad_tecnico
  before update on public.tickets
  for each row execute procedure public.guard_tecnico_no_cambia_prioridad();
