-- Isolated fixture: relevant tables only, not a dump of production data.
create table public.tickets(id uuid primary key default gen_random_uuid());
create table public.installations(id uuid primary key default gen_random_uuid());
create table public.routines(id uuid primary key default gen_random_uuid());

create table public.work_order_photos(
  id           uuid primary key default gen_random_uuid(),
  job_type     text not null check (job_type in ('ticket', 'installation', 'routine')),
  job_id       uuid not null,
  category     text not null,
  storage_path text not null,
  created_at   timestamptz not null default now(),
  status       text not null default 'approved' check (status in ('pending_approval', 'approved', 'rejected'))
);

insert into public.tickets (id) values ('10000000-0000-0000-0000-000000000001');
insert into public.installations (id) values ('20000000-0000-0000-0000-000000000001');
insert into public.routines (id) values ('30000000-0000-0000-0000-000000000001');
