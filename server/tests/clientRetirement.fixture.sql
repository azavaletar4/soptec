-- Datos sintéticos; base efímera sin red ni acceso a producción.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create type public.user_role as enum ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION','TECNICO_RED','CLIENTE');
create type public.client_status as enum ('prospect','active','suspended','retired');
create type public.contract_status as enum ('active','suspended','cancelled');
create type public.installation_status as enum ('pending','scheduled','in_progress','completed','cancelled');
create table public.profiles(id uuid primary key,role public.user_role,active boolean default true);
create table public.clients(id uuid primary key,first_name text default 'Cliente',last_name text default 'Sintético',status public.client_status default 'active',document_number text unique,updated_at timestamptz default now());
create table public.service_contracts(id uuid primary key,client_id uuid not null references public.clients(id),contract_number text,client_code text,status public.contract_status default 'active',updated_at timestamptz default now(),service_type text default 'internet_combo',mikrotik_device_id uuid,pppoe_username text,xui_line_id integer);
create table public.installations(id uuid primary key,client_id uuid not null references public.clients(id),contract_id uuid references public.service_contracts(id),status public.installation_status default 'pending',updated_at timestamptz default now());
create table public.olt_onts(id uuid primary key,client_id uuid,contract_id uuid,status text default 'online');
create table public.inventory_units(id uuid primary key,client_id uuid,contract_id uuid,status text default 'assigned');
create table public.preserved_history(kind text primary key,payload jsonb);
insert into public.preserved_history values ('invoices','{"pending":50,"paid":25}'),('payments','{"payment":"preserve"}'),('inventory','{"serial":"SYNTHETIC","events":3}'),('orders','{"closed":true}'),('nap','{"occupied":true}'),('prospects','{"converted":true}');
create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
create trigger trg_clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger trg_service_contracts_updated_at before update on public.service_contracts for each row execute function public.set_updated_at();
alter table public.clients enable row level security;
alter table public.service_contracts enable row level security;
alter table public.installations enable row level security;
create policy clients_staff_only on public.clients for all to authenticated using (public.current_user_role()::text in ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION','TECNICO_RED')) with check (public.current_user_role()::text in ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION','TECNICO_RED'));
create policy contracts_staff on public.service_contracts for all to authenticated using(true) with check(true);
create policy installations_staff on public.installations for all to authenticated using(true) with check(true);
grant usage on schema public,auth to authenticated,anon,service_role;
grant select,insert,update on public.clients,public.service_contracts,public.installations to authenticated;
insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','ADMIN',true),
 ('00000000-0000-0000-0000-000000000002','SUPERADMIN',true),
 ('00000000-0000-0000-0000-000000000003','SOPORTE',true),
 ('00000000-0000-0000-0000-000000000004','ADMIN',false),
 ('00000000-0000-0000-0000-000000000005','FACTURACION',true),
 ('00000000-0000-0000-0000-000000000006','TECNICO_RED',true),
 ('00000000-0000-0000-0000-000000000007','CLIENTE',true);
