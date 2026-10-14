-- Isolated fixture: relevant tables/constraints, not a dump of production data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create type public.user_role as enum ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION','CLIENTE');
create table public.profiles(id uuid primary key, role public.user_role, active boolean default true);
create table public.clients(id uuid primary key);
create table public.service_contracts(id uuid primary key, client_id uuid not null references public.clients(id));
create table public.olt_devices(id uuid primary key);
-- Minima: solo lo que olt_alert_log necesita referenciar.
create table public.olt_onts(
  id uuid primary key default gen_random_uuid(),
  olt_device_id uuid not null references public.olt_devices(id),
  client_id uuid references public.clients(id),
  contract_id uuid references public.service_contracts(id)
);
insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','ADMIN',true),
 ('00000000-0000-0000-0000-000000000002','TECNICO_RED',true),
 ('00000000-0000-0000-0000-000000000003','CLIENTE',true),
 ('00000000-0000-0000-0000-000000000004','ADMIN',false),
 ('00000000-0000-0000-0000-000000000005','SOPORTE',true),
 ('00000000-0000-0000-0000-000000000006','FACTURACION',true),
 ('00000000-0000-0000-0000-000000000007','SUPERADMIN',true);
insert into public.clients values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.service_contracts values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'), -- internet
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001'), -- iptv, MISMO cliente (multi-servicio)
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002');
insert into public.olt_devices values ('50000000-0000-0000-0000-000000000001');
insert into public.olt_onts values
 ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'), -- vinculada (internet)
 ('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'), -- vinculada (iptv, mismo cliente)
 ('60000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001',null,null); -- sin vincular (migracion SmartOLT)

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
-- La migracion bajo prueba crea olt_alert_log DESPUES de este fixture — sin
-- esto, esa tabla nueva no heredaria el grant de arriba (que solo cubre las
-- tablas que ya existen al momento de ejecutarse).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

