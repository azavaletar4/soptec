-- SmartRayco — Fase 4: OLT (dispositivos y ONTs)
--
-- OLT real del cliente: ZTE C300 (ZXA10). Se deja 'huawei' y 'vsol' en el
-- enum por si se agrega soporte multi-marca mas adelante, pero la
-- implementacion de comandos SSH de esta fase es especifica para ZTE
-- (ver server/src/ssh/zteCommands.ts).
--
-- olt_devices y olt_onts son de acceso EXCLUSIVO desde el backend Hono
-- (usa la service_role key, que bypasea RLS). El frontend nunca las consulta
-- directo via supabase-js: RLS queda habilitado SIN policies para
-- authenticated/anon, asi nadie puede leerlas/escribirlas salvo el backend.
-- El backend valida el rol del usuario (via su JWT) antes de cada operacion.

create type public.olt_brand as enum ('zte', 'huawei', 'vsol');
create type public.ont_status as enum ('online', 'offline', 'unknown');

create table public.olt_devices (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  host         text not null,
  brand        public.olt_brand not null default 'zte',
  ssh_port     int not null default 22,
  username     text not null,
  password     text not null, -- nunca se devuelve al frontend (ver server/src/routes/olt.ts)
  zone_id      uuid references public.zones (id),
  extra_params jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- "frame" se usa como "shelf" en terminologia ZTE (gpon-olt_{shelf}/{slot}/{port}).
create table public.olt_onts (
  id                 uuid primary key default gen_random_uuid(),
  olt_device_id      uuid not null references public.olt_devices (id) on delete cascade,
  client_id          uuid references public.clients (id),
  frame              int not null default 1,
  slot               int not null,
  port               int not null,
  ont_id             int not null,
  serial             text not null,
  description        text,
  onu_type           text, -- perfil/tipo de ONU configurado en la OLT (ej. "ZTE-F660")
  vlan               int,
  status             public.ont_status not null default 'unknown',
  rx_power           numeric(6, 2),
  tx_power           numeric(6, 2),
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (olt_device_id, frame, slot, port, ont_id)
);

create trigger trg_olt_devices_updated_at
  before update on public.olt_devices
  for each row execute procedure public.set_updated_at();

create trigger trg_olt_onts_updated_at
  before update on public.olt_onts
  for each row execute procedure public.set_updated_at();

create index idx_olt_onts_device on public.olt_onts (olt_device_id);
create index idx_olt_onts_client on public.olt_onts (client_id);

alter table public.olt_devices enable row level security;
alter table public.olt_onts enable row level security;
-- Sin policies a proposito: acceso solo via backend (service_role bypasea RLS).
