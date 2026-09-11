-- SmartRayco — Fase 6f: configuracion del servidor ACS (GenieACS) por OLT.
--
-- Adaptado de la migracion 073 de fosmikro (Huawei): se quita profile_id
-- (1-32) y scanned_at porque son un concepto de la OLT Huawei (perfiles
-- numerados que se consultan/sincronizan desde el equipo) que no existe en
-- la ZTE C300 — ahi el ACS se apunta directo por ONU via
-- "tr069-mgmt {veip} acs <url>" (ver zteCommands.ts). Esta tabla guarda que
-- URL/credenciales de ACS usar por defecto al registrar/asignar TR-069 en
-- cada OLT.
--
-- Idempotente (ver nota en fase9): permite re-ejecutar el archivo completo
-- sin error si una corrida anterior ya creo parte de estos objetos.

create table if not exists public.olt_tr069_acs_profiles (
  id                 uuid primary key default gen_random_uuid(),
  olt_device_id      uuid not null references public.olt_devices (id) on delete cascade,
  profile_name       text not null default 'genieacs',
  acs_url            text not null,   -- ej. http://192.168.100.136:7547
  acs_username       text,
  acs_password       text,
  inform_interval    integer not null default 300,
  is_default         boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists idx_olt_tr069_acs_default
  on public.olt_tr069_acs_profiles (olt_device_id)
  where is_default = true;

alter table public.olt_tr069_acs_profiles enable row level security;

drop policy if exists "olt_tr069_acs_profiles_staff_only" on public.olt_tr069_acs_profiles;
create policy "olt_tr069_acs_profiles_staff_only"
  on public.olt_tr069_acs_profiles for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

drop trigger if exists trg_olt_tr069_acs_profiles_updated_at on public.olt_tr069_acs_profiles;
create trigger trg_olt_tr069_acs_profiles_updated_at
  before update on public.olt_tr069_acs_profiles
  for each row execute procedure public.set_updated_at();
