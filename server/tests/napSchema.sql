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
create table public.infra_elementos(id uuid primary key, tipo text not null, puertos_total integer);
create table public.fo_nap_puertos(
  id uuid primary key default gen_random_uuid(),
  infra_elemento_id uuid not null references public.infra_elementos(id),
  puerto_numero integer not null check(puerto_numero > 0),
  estado text not null check(estado in ('libre','ocupado','reservado','dañado')),
  client_id uuid references public.clients(id), contract_id uuid references public.service_contracts(id),
  unique(infra_elemento_id,puerto_numero)
);
-- 136c also restricts this existing history RPC. Its implementation is not under test here.
create function public.append_provisioning_step(uuid,text,text,text) returns void language sql as $$ select; $$;
insert into public.profiles values
 ('00000000-0000-0000-0000-000000000001','ADMIN',true),
 ('00000000-0000-0000-0000-000000000002','TECNICO_RED',true),
 ('00000000-0000-0000-0000-000000000003','CLIENTE',true),
 ('00000000-0000-0000-0000-000000000004','ADMIN',false);
insert into public.clients values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.service_contracts values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into public.infra_elementos values
 ('30000000-0000-0000-0000-000000000001','caja_nap',2),
 ('30000000-0000-0000-0000-000000000002','caja_nap',1),
 ('30000000-0000-0000-0000-000000000003','caja_nap',3);
