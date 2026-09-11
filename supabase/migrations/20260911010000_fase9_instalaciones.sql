-- SmartRayco — Fase 9: Instalaciones (agenda) y Mapa.
--
-- Orden de instalacion ligada al contrato: fecha programada, tecnico
-- asignado, estado y notas. No duplica lat/lng (ya existen en clients
-- desde la Fase 3c) — el pin en el mapa usa la ubicacion del cliente.
-- Mismo criterio de RLS que service_contracts (Fase 2): todo el staff
-- interno, sin restriccion adicional por ahora.
--
-- Idempotente: esta fase ya se habia aplicado a mano antes de existir como
-- migracion versionada, asi que cada create/alter esta guardado para poder
-- re-ejecutar el archivo completo sin error contra una BD que ya la tiene.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'installation_status') then
    create type public.installation_status as enum ('pending', 'scheduled', 'completed', 'cancelled');
  end if;
end
$$;

create table if not exists public.installations (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients (id) on delete cascade,
  contract_id    uuid references public.service_contracts (id) on delete cascade,
  status         public.installation_status not null default 'pending',
  scheduled_date date,
  scheduled_time time,
  assigned_to    uuid references public.profiles (id),
  notes          text,
  completed_at   timestamptz,
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.installations enable row level security;

drop policy if exists "installations_staff_only" on public.installations;
create policy "installations_staff_only"
  on public.installations for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop trigger if exists trg_installations_updated_at on public.installations;
create trigger trg_installations_updated_at
  before update on public.installations
  for each row execute procedure public.set_updated_at();

-- completed_at se marca solo la primera vez que entra a ese estado (no se
-- pisa si se reabre y se vuelve a completar) — mismo patron que tickets.
create or replace function public.set_installation_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_installations_completed_at on public.installations;
create trigger trg_installations_completed_at
  before update on public.installations
  for each row execute procedure public.set_installation_completed_at();

create index if not exists idx_installations_client_id on public.installations (client_id);
create index if not exists idx_installations_contract_id on public.installations (contract_id);
create index if not exists idx_installations_status on public.installations (status);
