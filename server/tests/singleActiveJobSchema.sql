-- Isolated fixture: relevant tables/constraints, not a dump of production data.
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

insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','TECNICO_RED',true),
 ('00000000-0000-0000-0000-000000000002','TECNICO_RED',true),
 ('00000000-0000-0000-0000-000000000003','TECNICO_RED',true);
