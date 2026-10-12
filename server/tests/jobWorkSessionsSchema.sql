-- Isolated fixture: relevant tables/constraints, not a dump of production data.
-- Reusa el mismo criterio que singleActiveJobSchema.sql (mismo trigger de
-- Fase 137 se carga junto a esta migracion en el test) + un stub minimo de
-- current_user_role() para que la policy de SELECT de job_work_sessions
-- cargue tal cual el archivo real, sin modificarlo. Roles base igual que
-- napSchema.sql (Postgres pelado no trae authenticated/anon de Supabase).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.profiles(id uuid primary key, role text, active boolean default true);

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

create function public.current_user_role() returns text language sql stable as $$
  select 'SUPERADMIN';
$$;

insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','TECNICO_RED',true);
