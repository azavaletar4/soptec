-- Fase 174 (continuacion) — alertas de caida/recuperacion de enlaces WAN
-- del MikroTik BALANCEADOR (device_role='borde_balanceador', Fase 174).
--
-- Mismo patron que mikrotik_saturation_alerts (Fase 172): activo/resuelto,
-- nunca se borra -- el indice unico sobre status='active' es lo que evita
-- alertas duplicadas por el mismo enlace mientras siga activa. La decision
-- de abrir/cerrar vive en server/src/mikrotik/balancerAlerts.ts (puro, con
-- pruebas) -- esta tabla solo guarda el resultado.
--
-- Dos tipos de enlace, nunca mezclados en la misma fila (requisito: "no
-- asumir que una sesion PPPoE caida significa que el puerto SFP tambien
-- esta caido"):
--   - 'pppoe_connection': link_name = pppoe_interface_name (ej. "PPPoE-WAN031").
--     connection_id referencia la fila real en mikrotik_balancer_connections
--     (puede quedar en null si esa conexion fue borrada -- nunca pasa en la
--     practica, las conexiones solo se marcan removed_at, pero la FK usa
--     "on delete set null" por las dudas, para nunca perder el historial
--     de la alerta por un ON DELETE CASCADE).
--   - 'physical_port': link_name = el nombre del puerto fisico SFP (ej.
--     "sfp-sfpplus2"). connection_id siempre null.
--
-- physical_interface_name es un SNAPSHOT (puerto asociado al momento del
-- evento) -- igual criterio que el resto del proyecto para historiales
-- (nunca el vinculo de hoy, ver CLAUDE.md): si una sesion cambia de puerto
-- fisico mas adelante, una alerta vieja sigue mostrando el puerto que tenia
-- cuando se detecto, no el actual.
create table public.mikrotik_balancer_link_alerts (
  id                       uuid primary key default gen_random_uuid(),
  device_id                uuid not null references public.mikrotik_devices(id) on delete cascade,
  link_kind                text not null check (link_kind in ('pppoe_connection', 'physical_port')),
  link_name                text not null,
  connection_id            uuid references public.mikrotik_balancer_connections(id) on delete set null,
  physical_interface_name  text,
  status                   text not null check (status in ('active', 'resolved')) default 'active',
  started_at               timestamptz not null default now(),
  resolved_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index if not exists idx_mikrotik_balancer_link_alerts_active
  on public.mikrotik_balancer_link_alerts (device_id, link_kind, link_name)
  where status = 'active';

create index if not exists idx_mikrotik_balancer_link_alerts_device_time
  on public.mikrotik_balancer_link_alerts (device_id, started_at desc);

drop trigger if exists trg_mikrotik_balancer_link_alerts_updated_at on public.mikrotik_balancer_link_alerts;
create trigger trg_mikrotik_balancer_link_alerts_updated_at
  before update on public.mikrotik_balancer_link_alerts
  for each row execute procedure public.set_updated_at();

-- Igual que el resto de tablas de MikroTik: acceso EXCLUSIVO desde el
-- backend (service_role bypasea RLS). Sin policies a proposito.
alter table public.mikrotik_balancer_link_alerts enable row level security;
