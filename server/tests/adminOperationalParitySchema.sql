-- Fixture minimo aislado para probar 20261124120000_admin_operational_parity.sql
-- sin levantar el esquema completo de produccion. Mismo patron que
-- closedOrdersSchema.sql: solo las tablas/tipos/columnas que la migracion
-- real necesita, con datos sinteticos.
create extension if not exists pgcrypto;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create type public.user_role as enum ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION','CLIENTE');
create type public.installation_status as enum ('scheduled','in_progress','completed','cancelled');

create table public.profiles (
  id uuid primary key,
  role public.user_role not null,
  active boolean not null default true
);

-- Shim minimo de auth.uid()/auth.jwt() para el entorno aislado (igual
-- patron que napAssignment.sql.test.ts/closedOrders.sql.test.ts) — debe
-- existir ANTES de current_user_role(), que lo usa.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create table public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true
);

create table public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.inventory_products(id),
  serial_number text,
  contract_id uuid,
  status text
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  amount numeric not null default 0,
  contract_id uuid
);

-- Minimo para contract_cancel_unfulfilled (no se ejerce a fondo en esta
-- suite — ya tiene su propia prueba aislada completa en
-- contractCancelUnfulfilled.sql.test.ts; aqui solo hace falta que la
-- funcion COMPILE, ya que declara `c service_contracts%rowtype`).
create type public.client_status as enum ('prospect','active','suspended','retired');
create type public.contract_status as enum ('active','suspended','cancelled');
create table public.clients (id uuid primary key default gen_random_uuid(), status public.client_status not null default 'prospect');
create table public.service_contracts (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
  status public.contract_status not null default 'active', updated_at timestamptz not null default now()
);
create table public.olt_onts (id uuid primary key default gen_random_uuid(), contract_id uuid);
create table public.tickets (id uuid primary key default gen_random_uuid(), contract_id uuid, status text not null default 'open');
create table public.contract_unfulfilled_cancellations (
  id uuid primary key default gen_random_uuid(), contract_id uuid not null, client_id uuid not null,
  installation_id uuid, previous_contract_status public.contract_status, previous_client_status public.client_status,
  new_client_status public.client_status, reason text, created_at timestamptz not null default now()
);

create table public.infra_elementos (id uuid primary key default gen_random_uuid(), tipo text, map_removed_at timestamptz);
create table public.fo_fusiones (id uuid primary key default gen_random_uuid(), cable_a_id uuid, cable_b_id uuid, infra_elemento_id uuid, map_removed_at timestamptz);
create table public.fo_nap_puertos (id uuid primary key default gen_random_uuid(), infra_elemento_id uuid);
create table public.routines (id uuid primary key default gen_random_uuid(), status text, routine_number text, nap_elemento_id uuid, contract_id uuid);
create table public.fo_hilo_estados (cable_id uuid, hilo_index integer, map_removed_at timestamptz, estado text default 'libre', notes text, primary key (cable_id, hilo_index));
create table public.fo_cables (
  id uuid primary key default gen_random_uuid(),
  origen_olt_id uuid, origen_infra_id uuid, destino_olt_id uuid, destino_infra_id uuid,
  map_removed_at timestamptz
);

-- Resumen minimo necesario para remove_from_network_map (solo lo que se
-- usa en la prueba: snapshot vacio con token md5 reproducible).
create or replace function public.map_removal_snapshot(p_kind text, p_id uuid, p_hilo integer)
returns jsonb language sql stable as $$ select jsonb_build_object('fusiones', '[]'::jsonb); $$;

create table public.installations (
  id uuid primary key default gen_random_uuid(),
  status public.installation_status not null default 'scheduled',
  assigned_to uuid,
  client_id uuid,
  contract_id uuid,
  created_at timestamptz not null default now()
);

create table public.job_assignees (
  job_type text not null,
  job_id uuid not null,
  technician_id uuid not null,
  role text not null,
  primary key (job_type, job_id, technician_id)
);

create table public.asistencia_horarios_personales (
  user_id uuid not null, dia_semana integer not null, hora_ingreso time, hora_salida time, updated_at timestamptz,
  primary key (user_id, dia_semana)
);
create table public.company_settings (id integer primary key, lunes_hora_ingreso time, resto_hora_ingreso time);
create table public.feriados (fecha date primary key);
create table public.asistencia_registros (user_id uuid, fecha date, hora_ingreso time);
create table public.asistencia_intercambios (
  id uuid primary key, user_id uuid not null, fecha_descanso date not null, fecha_trabajo date not null,
  hora_ingreso time not null, hora_salida time not null, estado text not null default 'activo',
  created_by uuid, cancelled_by uuid, cancelled_at timestamptz, cancel_motivo text
);
create table public.asistencia_novedades (
  id uuid primary key, user_id uuid not null, tipo text not null, fecha_inicio date not null, fecha_fin date not null,
  turno text, hora_inicio time, hora_fin time, motivo text, estado text not null default 'activa', version integer not null default 0,
  created_by uuid, cancelled_by uuid, cancelled_at timestamptz, cancel_motivo text
);
create table public.asistencia_solicitudes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, fecha date not null, motivo text, observacion text,
  estado text not null default 'pendiente', version integer not null default 0,
  resolved_at timestamptz, resolved_by uuid, decision_motivo text
);
create table public.asistencia_solicitud_eventos (
  id uuid primary key default gen_random_uuid(), solicitud_id uuid not null, actor_id uuid, actor_rol text,
  estado_anterior text, estado_nuevo text, motivo text, created_at timestamptz not null default now()
);
create table public.asistencia_config_eventos (
  id bigint generated always as identity primary key, actor_id uuid not null, tabla text not null, accion text not null,
  anterior jsonb, nuevo jsonb, created_at timestamptz not null default now()
);

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

alter table public.inventory_products enable row level security;
alter table public.inventory_units enable row level security;
alter table public.invoices enable row level security;
alter table public.installations enable row level security;
alter table public.job_assignees enable row level security;
alter table public.asistencia_horarios_personales enable row level security;
alter table public.asistencia_intercambios enable row level security;
alter table public.asistencia_novedades enable row level security;
alter table public.asistencia_solicitudes enable row level security;
alter table public.asistencia_solicitud_eventos enable row level security;
alter table public.asistencia_config_eventos enable row level security;
alter table public.fo_cables enable row level security;

-- Policies base (select/insert/update genericas) que la migracion real NO
-- toca pero hacen falta para que la prueba pueda armar datos y, en el caso
-- de installations/job_assignees, para aislar el efecto de la migracion
-- (ella SI reemplaza installations_update_staff/job_assignees_write_dispatch).
create policy p_products on public.inventory_products for all to authenticated using (true) with check (true);
create policy p_units on public.inventory_units for all to authenticated using (true) with check (true);
create policy p_invoices_select on public.invoices for select to authenticated using (true);
create policy p_invoices_insert on public.invoices for insert to authenticated with check (true);
create policy p_invoices_update on public.invoices for update to authenticated using (true) with check (true);
create policy p_installations_select on public.installations for select to authenticated using (true);
create policy p_installations_insert on public.installations for insert to authenticated with check (true);
create policy p_job_assignees_select on public.job_assignees for select to authenticated using (true);
create policy p_horarios_insert on public.asistencia_horarios_personales for insert to authenticated with check (true);
create policy p_intercambios_rw on public.asistencia_intercambios for all to authenticated using (true) with check (true);
create policy p_novedades_rw on public.asistencia_novedades for all to authenticated using (true) with check (true);
create policy p_solicitudes_rw on public.asistencia_solicitudes for all to authenticated using (true) with check (true);
create policy p_solicitud_eventos_rw on public.asistencia_solicitud_eventos for all to authenticated using (true) with check (true);
create policy p_config_eventos_insert on public.asistencia_config_eventos for insert to authenticated with check (true);
create policy p_fo_cables_rw on public.fo_cables for all to authenticated using (true) with check (true);

-- Nota: invoices DELETE, installations UPDATE y job_assignees (todo)
-- quedan definidos EXCLUSIVAMENTE por la propia migracion real
-- (invoices_delete_staff, installations_update_staff,
-- job_assignees_write_dispatch) — no se declara ninguna policy propia de
-- esas operaciones aqui, para no enmascarar lo que se esta probando.
