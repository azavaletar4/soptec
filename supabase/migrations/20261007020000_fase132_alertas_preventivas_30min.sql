-- SmartRayco — Fase 132: alertas preventivas 30 min antes de la hora
-- programada (Altas/Averias/Rutinas) — banner en Panel Web (toast + campana)
-- y App de Campo ("Mis Pendientes de Hoy").
--
-- alerta_enviada es el "ya se avisó" que evita duplicar el aviso: un
-- scheduler en el backend (server/src/services/scheduleAlertScheduler.ts,
-- mismo patron setInterval que tr069Scheduler/debtHoldScheduler) la pone en
-- true la primera vez que scheduled_start_at cae dentro de los proximos 30
-- min. Si se reagenda (scheduled_start_at cambia), el trigger de abajo la
-- vuelve a poner en false para que el aviso se dispare de nuevo en la hora
-- nueva.
--
-- El Panel Web se entera en vivo via Supabase Realtime (postgres_changes) —
-- ninguna de estas 3 tablas estaba en la publicacion todavia (solo
-- `profiles`, Fase 115b); se agregan aqui. Realtime respeta las RLS de
-- SELECT ya existentes, igual que profiles — no expone nada que un staff no
-- pudiera ver ya con un fetch normal.

alter table public.tickets add column alerta_enviada boolean not null default false;
alter table public.installations add column alerta_enviada boolean not null default false;
alter table public.routines add column alerta_enviada boolean not null default false;

create or replace function public.reset_alerta_enviada()
returns trigger
language plpgsql
as $$
begin
  if new.scheduled_start_at is distinct from old.scheduled_start_at then
    new.alerta_enviada := false;
  end if;
  return new;
end;
$$;

create trigger trg_tickets_reset_alerta
  before update on public.tickets
  for each row execute procedure public.reset_alerta_enviada();

create trigger trg_installations_reset_alerta
  before update on public.installations
  for each row execute procedure public.reset_alerta_enviada();

create trigger trg_routines_reset_alerta
  before update on public.routines
  for each row execute procedure public.reset_alerta_enviada();

alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.installations;
alter publication supabase_realtime add table public.routines;
