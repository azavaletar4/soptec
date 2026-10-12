-- Isolated fixture: relevant tables/constraints, not a dump of production
-- data. current_user_role() se carga aparte desde el archivo real (Fase
-- 13) en el .test.ts, igual que closedOrdersSchema.sql/napSchema.sql, para
-- poder probar RLS con roles de verdad (no un stub fijo).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create type public.user_role as enum ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION','CLIENTE');
create table public.profiles(id uuid primary key, role public.user_role, active boolean default true);

create table public.tickets(
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed','rescheduled')),
  assigned_to uuid references public.profiles(id),
  ticket_number text
);
create table public.installations(
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','scheduled','in_progress','completed','cancelled')),
  assigned_to uuid references public.profiles(id)
);
create table public.routines(
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','scheduled','in_progress','completed','cancelled')),
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

insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','SUPERADMIN',true),
 ('00000000-0000-0000-0000-000000000002','ADMIN',true),
 ('00000000-0000-0000-0000-000000000003','TECNICO_RED',true),
 ('00000000-0000-0000-0000-000000000004','SOPORTE',true),
 ('00000000-0000-0000-0000-000000000005','FACTURACION',true),
 ('00000000-0000-0000-0000-000000000006','CLIENTE',true);

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
