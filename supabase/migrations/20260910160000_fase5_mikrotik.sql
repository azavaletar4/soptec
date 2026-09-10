-- SmartRayco — Fase 5: MikroTik REST API (RouterOS v7+)
--
-- Igual que olt_devices: acceso EXCLUSIVO desde el backend (service_role).
-- El frontend nunca ve el password ni llama directo al router.

create table public.mikrotik_devices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  host       text not null,
  port       int not null default 443,
  use_tls    boolean not null default true, -- la mayoria de ISPs usa TLS autofirmado
  username   text not null,
  password   text not null,
  zone_id    uuid references public.zones (id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_mikrotik_devices_updated_at
  before update on public.mikrotik_devices
  for each row execute procedure public.set_updated_at();

alter table public.mikrotik_devices enable row level security;
-- Sin policies a proposito: acceso solo via backend (service_role bypasea RLS).

-- Preparacion para cruzar ONT <-> IP MikroTik por MAC de WAN (Fase futura:
-- requiere validar el comando "display/show ont wan-info" contra la OLT real
-- para poblar este campo automaticamente).
alter table public.olt_onts add column wan_mac text;
