-- SmartRayco — Fase 6: soporte tecnico (tickets)
-- Tablas: tickets, ticket_comments. Numeracion automatica (TCK-YYYY-NNNNN),
-- igual criterio que service_contracts (Fase 3).

-- =========================================================
-- Tipos
-- =========================================================

create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.ticket_category as enum (
  'no_service', 'slow_speed', 'billing', 'installation', 'equipment', 'other'
);

-- =========================================================
-- tickets
-- =========================================================

create table public.tickets (
  id           uuid primary key default gen_random_uuid(),
  ticket_number text unique,
  client_id    uuid not null references public.clients (id) on delete cascade,
  contract_id  uuid references public.service_contracts (id),
  title        text not null,
  description  text,
  category     public.ticket_category not null default 'other',
  priority     public.ticket_priority not null default 'medium',
  status       public.ticket_status not null default 'open',
  assigned_to  uuid references public.profiles (id),
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  closed_at    timestamptz
);

-- Contador por año para la numeracion de tickets (mismo patron que contratos).
create table public.ticket_number_counters (
  year       int primary key,
  last_value int not null default 0
);
alter table public.ticket_number_counters enable row level security;

create or replace function public.generate_ticket_number()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  current_year int := extract(year from now())::int;
  seq_value    int;
begin
  insert into public.ticket_number_counters (year, last_value)
  values (current_year, 1)
  on conflict (year) do update
    set last_value = public.ticket_number_counters.last_value + 1
  returning last_value into seq_value;

  return 'TCK-' || current_year::text || '-' || lpad(seq_value::text, 5, '0');
end;
$$;

create or replace function public.set_ticket_number()
returns trigger
language plpgsql
as $$
begin
  if new.ticket_number is null then
    new.ticket_number := public.generate_ticket_number();
  end if;
  return new;
end;
$$;

create trigger trg_tickets_number
  before insert on public.tickets
  for each row execute procedure public.set_ticket_number();

-- resolved_at/closed_at se marcan solos la primera vez que el ticket entra
-- a ese estado (no se pisan si se reabre y se vuelve a cerrar).
create or replace function public.set_ticket_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now();
  end if;
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_tickets_status_timestamps
  before update on public.tickets
  for each row execute procedure public.set_ticket_status_timestamps();

create trigger trg_tickets_updated_at
  before update on public.tickets
  for each row execute procedure public.set_updated_at();

-- =========================================================
-- ticket_comments — bitacora/seguimiento de un ticket
-- =========================================================

create table public.ticket_comments (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id) on delete cascade,
  author_id  uuid references public.profiles (id) default auth.uid(),
  body       text not null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Indices
-- =========================================================

create index idx_tickets_client_id on public.tickets (client_id);
create index idx_tickets_status on public.tickets (status);
create index idx_tickets_assigned_to on public.tickets (assigned_to);
create index idx_ticket_comments_ticket_id on public.ticket_comments (ticket_id);

-- =========================================================
-- Row Level Security
-- =========================================================

alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;

-- tickets/ticket_comments: personal tecnico/soporte (no FACTURACION, no
-- necesita ver tickets de soporte tecnico).
create policy "tickets_staff_only"
  on public.tickets for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "ticket_comments_staff_only"
  on public.ticket_comments for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

-- profiles: la Fase 2 solo dejaba ver el propio perfil o ser admin. Para
-- poder asignar tickets a un companero, el personal de soporte/red necesita
-- listar otros perfiles de staff (no de clientes). Se agrega, no reemplaza,
-- la policy de select existente (las policies de un mismo comando se OR-ean).
create policy "profiles_select_staff_for_assignment"
  on public.profiles for select to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE')
    and role <> 'CLIENTE'
  );
