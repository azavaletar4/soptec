-- Isolated fixture: relevant tables/constraints, not a dump of production
-- data. current_user_role() se carga aparte desde el archivo real (ver el
-- .test.ts) para no duplicarla a mano.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create type public.user_role as enum ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION','CLIENTE');
create type public.installation_status as enum ('pending','scheduled','in_progress','completed','cancelled');
create type public.ticket_status as enum ('open','in_progress','resolved','closed','rescheduled');
create type public.routine_status as enum ('pending','scheduled','in_progress','completed','cancelled');
create type public.inventory_unit_status as enum ('in_stock','assigned','damaged','in_repair','retired','en_recupero','pending_approval');
create type public.inventory_movement_type as enum ('ingreso','egreso');

create table public.profiles(id uuid primary key, role public.user_role, active boolean default true);

create table public.clients(id uuid primary key default gen_random_uuid());

create table public.tickets(
  id uuid primary key default gen_random_uuid(),
  status public.ticket_status not null default 'open',
  assigned_to uuid references public.profiles(id),
  ticket_number text
);
create table public.installations(
  id uuid primary key default gen_random_uuid(),
  status public.installation_status not null default 'pending',
  assigned_to uuid references public.profiles(id)
);
create table public.routines(
  id uuid primary key default gen_random_uuid(),
  status public.routine_status not null default 'pending',
  assigned_to uuid references public.profiles(id),
  routine_number text
);
create table public.job_assignees(
  job_type text not null check (job_type in ('ticket','installation','routine')),
  job_id uuid not null,
  technician_id uuid not null references public.profiles(id),
  role text not null default 'support' check (role in ('leader','support')),
  primary key (job_type, job_id, technician_id)
);

create table public.inventory_categories(id uuid primary key default gen_random_uuid(), slug text unique);
create table public.inventory_products(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'unidad',
  current_stock numeric(12,2) not null default 0,
  is_active boolean not null default true,
  is_serialized boolean not null default false,
  category_id uuid references public.inventory_categories(id),
  updated_at timestamptz not null default now()
);
create table public.inventory_units(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.inventory_products(id),
  serial_number text,
  mac_address text,
  status public.inventory_unit_status not null default 'in_stock',
  client_id uuid references public.clients(id),
  installation_id uuid references public.installations(id),
  contract_id uuid,
  ticket_id uuid references public.tickets(id),
  assigned_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.inventory_unit_events(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.inventory_units(id),
  from_status public.inventory_unit_status,
  to_status public.inventory_unit_status not null,
  client_id uuid references public.clients(id),
  installation_id uuid references public.installations(id),
  contract_id uuid,
  ticket_id uuid references public.tickets(id),
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
-- El trigger de inventory_unit_events se crea en el .test.ts DESPUES de
-- cargar la migracion real (fase151 solo reemplaza la funcion con
-- CREATE OR REPLACE, no vuelve a crear el trigger — en produccion ya
-- existe desde Fase 11c).

create table public.inventory_movements(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.inventory_products(id),
  movement_type public.inventory_movement_type not null,
  quantity numeric(12,2) not null check (quantity > 0),
  reason text,
  balance_after numeric(12,2) not null default 0,
  installation_id uuid references public.installations(id),
  ticket_id uuid references public.tickets(id),
  reverses_movement_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
-- Mismo caso que inventory_unit_events: el trigger se crea en el .test.ts
-- despues de cargar fase151.

insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','SUPERADMIN',true),
 ('00000000-0000-0000-0000-000000000002','ADMIN',true),
 ('00000000-0000-0000-0000-000000000003','TECNICO_RED',true),
 ('00000000-0000-0000-0000-000000000004','SOPORTE',true);

insert into public.clients (id) values ('30000000-0000-0000-0000-000000000001');

insert into public.inventory_categories (id, slug) values ('40000000-0000-0000-0000-000000000001','onu');
insert into public.inventory_products (id, name, is_serialized, category_id) values
 ('50000000-0000-0000-0000-000000000001','ONT generico', true, '40000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','Cable Drop 100m', false, null);

-- Supabase real otorga estos GRANTs de base (separados de RLS) a los 3
-- roles estandar — un Postgres pelado no los trae.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
