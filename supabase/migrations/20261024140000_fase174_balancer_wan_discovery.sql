-- Fase 174: descubrimiento automatico de conexiones WAN del MikroTik
-- BALANCEADOR (device_role='borde_balanceador', Fase 171) a partir de
-- RouterOS real -- nunca de nombres fijos ni cantidades asumidas.
--
-- Cadena real confirmada con lectura de solo lectura contra el balanceador
-- (nunca inferida por nombre): puerto fisico SFP <- interfaz MACVLAN
-- (campo propio `interface` de /interface/macvlan) <- sesion PPPoE-client
-- (campo propio `interface` de /interface/pppoe-client). El trafico se
-- toma SIEMPRE del nivel PPPoE-client (una sola fuente por conexion) --
-- el puerto fisico acumula el trafico de TODAS sus macvlan juntas y nunca
-- debe sumarse aparte (ver mikrotikBalancerDiscoveryService.ts).
create table public.mikrotik_balancer_connections (
  id                       uuid primary key default gen_random_uuid(),
  device_id                uuid not null references public.mikrotik_devices(id) on delete cascade,
  pppoe_interface_name     text not null, -- nombre real tal cual lo reporta RouterOS (ej. "PPPoE-WAN031")
  macvlan_interface_name   text,          -- resuelto via /interface/pppoe-client.interface -- nunca adivinado
  physical_interface_name  text,          -- resuelto via /interface/macvlan.interface -- nunca adivinado
  pppoe_user               text,
  disabled                 boolean not null default false,
  running                  boolean not null default false,
  first_seen_at            timestamptz not null default now(),
  last_seen_at             timestamptz not null default now(),
  -- NUNCA se borra la fila cuando una conexion deja de verse en el router
  -- (retirada/renombrada) -- se marca aqui para conservar su historial.
  removed_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (device_id, pppoe_interface_name)
);

create trigger trg_mikrotik_balancer_connections_updated_at
  before update on public.mikrotik_balancer_connections
  for each row execute procedure public.set_updated_at();

create index idx_mikrotik_balancer_connections_device
  on public.mikrotik_balancer_connections (device_id)
  where removed_at is null;

-- Historial de trafico YA EN DELTA/BPS (nunca contadores crudos), una sola
-- fuente por conexion (el nivel PPPoE-client) -- jamas se suma con el
-- puerto fisico ni con la macvlan.
create table public.mikrotik_balancer_connection_samples (
  id               uuid primary key default gen_random_uuid(),
  connection_id    uuid not null references public.mikrotik_balancer_connections(id) on delete cascade,
  sampled_at       timestamptz not null default now(),
  interval_seconds int not null,
  rx_bytes         bigint not null default 0,
  tx_bytes         bigint not null default 0,
  rx_bps           bigint not null default 0,
  tx_bps           bigint not null default 0,
  -- false = no se pudo leer el router este ciclo -- NUNCA se interpreta
  -- como "conexion caida", solo como perdida de monitoreo puntual.
  online           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index idx_mikrotik_balancer_connection_samples_time
  on public.mikrotik_balancer_connection_samples (connection_id, sampled_at desc);

-- Ultimo contador crudo leido por conexion, para calcular el delta del
-- siguiente ciclo (mismo patron que mikrotik_interface_counters_state,
-- Fase 172).
create table public.mikrotik_balancer_connection_counters_state (
  connection_id  uuid primary key references public.mikrotik_balancer_connections(id) on delete cascade,
  last_rx_bytes  bigint not null default 0,
  last_tx_bytes  bigint not null default 0,
  updated_at     timestamptz not null default now()
);

create trigger trg_mikrotik_balancer_connection_counters_state_updated_at
  before update on public.mikrotik_balancer_connection_counters_state
  for each row execute procedure public.set_updated_at();

-- Igual que el resto de tablas de MikroTik: acceso EXCLUSIVO desde el
-- backend (service_role bypasea RLS). Sin policies a proposito.
alter table public.mikrotik_balancer_connections enable row level security;
alter table public.mikrotik_balancer_connection_samples enable row level security;
alter table public.mikrotik_balancer_connection_counters_state enable row level security;
