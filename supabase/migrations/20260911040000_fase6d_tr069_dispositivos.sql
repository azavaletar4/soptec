-- SmartRayco — Fase 6d: dispositivos TR-069/CWMP gestionados por GenieACS.
--
-- Adaptado de REPLICA-TR069-GENIEACS.md (migraciones 029+030 de fosmikro):
-- se quita tenant_id (SmartRayco es single-tenant, ver Fase 2) y el RLS pasa
-- al mismo patron de current_user_role() que usa el resto del proyecto.
-- Las columnas de cache (last_seen_at, model_name, etc.) permiten mostrar
-- datos en el panel aunque GenieACS este offline en ese momento.
--
-- Idempotente (ver nota en fase9): permite re-ejecutar el archivo completo
-- sin error si una corrida anterior ya creo parte de estos objetos.

create table if not exists public.tr069_devices (
  id                   uuid primary key default gen_random_uuid(),
  genieacs_id          text not null unique, -- formato GenieACS: "OUI-ProductClass-SerialNumber"
  cpe_oui              text,
  cpe_product_class    text,
  cpe_serial           text not null,
  service_contract_id  uuid references public.service_contracts (id) on delete set null,
  notes                text,
  last_seen_at         timestamptz,
  model_name           text,
  firmware_version     text,
  wan_ip               text,
  ssid                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists tr069_devices_contract_unique
  on public.tr069_devices (service_contract_id)
  where service_contract_id is not null;

create index if not exists idx_tr069_devices_wan_ip on public.tr069_devices (wan_ip) where wan_ip is not null;

alter table public.tr069_devices enable row level security;

-- Mismo criterio que tickets (Fase 6): todo el staff tecnico/soporte, sin
-- FACTURACION (no le concierne el estado de los CPEs).
drop policy if exists "tr069_devices_staff_only" on public.tr069_devices;
create policy "tr069_devices_staff_only"
  on public.tr069_devices for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

drop trigger if exists trg_tr069_devices_updated_at on public.tr069_devices;
create trigger trg_tr069_devices_updated_at
  before update on public.tr069_devices
  for each row execute procedure public.set_updated_at();
