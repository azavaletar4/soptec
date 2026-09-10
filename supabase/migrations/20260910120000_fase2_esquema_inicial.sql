-- SmartRayco — Fase 2: esquema inicial (single-tenant)
-- Tablas: profiles, zones, plans, clients, service_contracts
-- RLS basado en rol (public.profiles.role), sin tenant_id (proyecto single-tenant).

-- =========================================================
-- Tipos
-- =========================================================

create type public.user_role as enum (
  'SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION', 'CLIENTE'
);

create type public.connection_technology as enum ('fiber', 'radio', 'cable', 'dsl');
create type public.document_type as enum ('cedula', 'ruc', 'pasaporte');
create type public.client_status as enum ('prospect', 'active', 'suspended', 'retired');
create type public.contract_status as enum ('active', 'suspended', 'cancelled');

-- =========================================================
-- profiles — espeja auth.users, agrega el rol de la aplicacion
-- =========================================================

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  full_name  text,
  role       public.user_role not null default 'CLIENTE',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Crea el perfil automaticamente cuando alguien se registra en Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Rol del usuario autenticado actual (helper para las politicas RLS de abajo).
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- =========================================================
-- zones — zonas / sectores de cobertura
-- =========================================================

create table public.zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- =========================================================
-- plans — planes de servicio (velocidad, precio, perfil MikroTik)
-- =========================================================

create table public.plans (
  id               uuid primary key default gen_random_uuid(),
  name             varchar(100) not null,
  description      text,
  download_speed   smallint not null,
  upload_speed     smallint not null,
  price            numeric(10, 2) not null,
  technology       public.connection_technology not null default 'fiber',
  burst_download   int,
  burst_upload     int,
  mikrotik_profile varchar(100),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- =========================================================
-- clients — clientes del ISP
-- =========================================================

create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  zone_id         uuid references public.zones (id),
  document_type   public.document_type not null default 'cedula',
  document_number text not null unique,
  first_name      text not null,
  last_name       text not null,
  phone           text,
  email           text,
  birthdate       date,
  status          public.client_status not null default 'prospect',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- =========================================================
-- service_contracts — contrato de servicio (cliente + plan)
-- =========================================================

create table public.service_contracts (
  id             uuid primary key default gen_random_uuid(),
  -- Numeracion automatica (CTR-YYYY-NNNNN via RPC) se agrega en la Fase 3.
  contract_number text unique,
  client_id      uuid not null references public.clients (id) on delete cascade,
  plan_id        uuid references public.plans (id),
  monthly_fee    numeric(10, 2) not null default 0,
  status         public.contract_status not null default 'active',
  start_date     date not null default current_date,
  end_date       date,
  billing_day    int check (billing_day between 1 and 28) default 1,
  payment_method text default 'cash',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- =========================================================
-- updated_at automatico
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create trigger trg_plans_updated_at
  before update on public.plans
  for each row execute procedure public.set_updated_at();

create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute procedure public.set_updated_at();

create trigger trg_service_contracts_updated_at
  before update on public.service_contracts
  for each row execute procedure public.set_updated_at();

-- =========================================================
-- Indices
-- =========================================================

create index idx_clients_zone_id on public.clients (zone_id);
create index idx_clients_status on public.clients (status);
create index idx_service_contracts_client_id on public.service_contracts (client_id);
create index idx_service_contracts_plan_id on public.service_contracts (plan_id);
create index idx_service_contracts_status on public.service_contracts (status);

-- =========================================================
-- Row Level Security
-- =========================================================

alter table public.profiles enable row level security;
alter table public.zones enable row level security;
alter table public.plans enable row level security;
alter table public.clients enable row level security;
alter table public.service_contracts enable row level security;

-- profiles: cada quien ve su propio perfil; SUPERADMIN/ADMIN ven todos.
-- Solo SUPERADMIN/ADMIN pueden editar perfiles (asignar roles); el alta la
-- hace el trigger handle_new_user (security definer), no una policy INSERT.
create policy "profiles_select_own_or_admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

create policy "profiles_update_admin_only"
  on public.profiles for update to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- zones: lectura para cualquier usuario autenticado; escritura ADMIN/SUPERADMIN.
create policy "zones_select_authenticated"
  on public.zones for select to authenticated using (true);

create policy "zones_write_admin"
  on public.zones for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- plans: lectura para cualquier usuario autenticado; escritura ADMIN/SUPERADMIN/FACTURACION.
create policy "plans_select_authenticated"
  on public.plans for select to authenticated using (true);

create policy "plans_write_admin_billing"
  on public.plans for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

-- clients: solo personal (ADMIN/SUPERADMIN/TECNICO_RED/SOPORTE/FACTURACION).
-- El portal del cliente (rol CLIENTE viendo sus propios datos) llega en la Fase 12.
create policy "clients_staff_only"
  on public.clients for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

-- service_contracts: mismo criterio que clients.
create policy "service_contracts_staff_only"
  on public.service_contracts for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));
