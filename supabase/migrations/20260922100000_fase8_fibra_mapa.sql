-- SmartRayco — Fase 8: modulo de fibra optica sobre el mapa (extiende Fase 7).
-- Agrega trazado de cables (troncal/ramal), estado de hilos por tubo,
-- fusiones/empalmes en mufas y cajas NAP, y ocupacion de puertos de cliente
-- en la caja NAP. Con esto el mapa permite trazabilidad optica extremo a
-- extremo (OLT -> troncal -> mufa -> ramal -> NAP -> puerto -> cliente).

-- Capacidad de puertos de cliente en cajas NAP (splitter interno).
alter table public.infra_elementos add column if not exists puertos_total integer;

create table public.fo_cables (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null,
  tipo         text not null check (tipo in ('troncal', 'ramal')),
  hilos_total  integer not null check (hilos_total in (6, 12, 24, 48, 72, 96, 144)),
  metraje      numeric,
  path         jsonb not null, -- [[lat,lng], [lat,lng], ...] vertices del tendido

  origen_olt_id      uuid references public.olt_devices (id),
  origen_infra_id    uuid references public.infra_elementos (id),
  destino_olt_id     uuid references public.olt_devices (id),
  destino_infra_id   uuid references public.infra_elementos (id),

  is_active    boolean not null default true,
  notes        text,
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint fo_cables_origen_unico check (
    (origen_olt_id is not null)::int + (origen_infra_id is not null)::int <= 1
  ),
  constraint fo_cables_destino_unico check (
    (destino_olt_id is not null)::int + (destino_infra_id is not null)::int <= 1
  )
);

create index idx_fo_cables_origen_infra on public.fo_cables (origen_infra_id);
create index idx_fo_cables_destino_infra on public.fo_cables (destino_infra_id);
create index idx_fo_cables_origen_olt on public.fo_cables (origen_olt_id);
create index idx_fo_cables_destino_olt on public.fo_cables (destino_olt_id);

create trigger trg_fo_cables_updated_at
  before update on public.fo_cables
  for each row execute procedure public.set_updated_at();

-- Estado de cada hilo (sparse: un hilo sin fila aqui se asume "libre").
-- El tubo/color del hilo se deriva en la app del indice (estandar de 12
-- colores ANSI/TIA-598-C), no se persiste.
create table public.fo_hilo_estados (
  id          uuid primary key default gen_random_uuid(),
  cable_id    uuid not null references public.fo_cables (id) on delete cascade,
  hilo_index  integer not null,
  estado      text not null default 'libre' check (estado in ('libre', 'usado', 'reservado', 'dañado')),
  notes       text,
  updated_at  timestamptz not null default now(),
  unique (cable_id, hilo_index)
);

create trigger trg_fo_hilo_estados_updated_at
  before update on public.fo_hilo_estados
  for each row execute procedure public.set_updated_at();

-- Fusiones/empalmes dentro de una mufa o caja NAP. Cada fila conecta el hilo
-- de entrada (cable_a/hilo_a) con:
--   - 'cable': otro hilo de otro cable (empalme directo, mufa de paso), o
--   - 'splitter_out': un puerto de cliente de la caja NAP, a traves del
--     splitter interno (una misma hilo_a puede repetirse en varias filas,
--     una por cada puerto de salida del splitter 1:N), o
--   - 'terminado': hilo cortado/tapado, sin continuidad (reservado).
create table public.fo_fusiones (
  id                 uuid primary key default gen_random_uuid(),
  infra_elemento_id  uuid not null references public.infra_elementos (id) on delete cascade,

  cable_a_id   uuid not null references public.fo_cables (id) on delete cascade,
  hilo_a_index integer not null,

  destino_tipo   text not null default 'cable' check (destino_tipo in ('cable', 'splitter_out', 'terminado')),
  cable_b_id     uuid references public.fo_cables (id) on delete cascade,
  hilo_b_index   integer,
  puerto_nap     integer, -- usado cuando destino_tipo = 'splitter_out'

  notes       text,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),

  constraint fo_fusiones_cable_b_requerido check (
    (destino_tipo = 'cable' and cable_b_id is not null and hilo_b_index is not null)
    or (destino_tipo <> 'cable')
  ),
  constraint fo_fusiones_puerto_requerido check (
    (destino_tipo = 'splitter_out' and puerto_nap is not null)
    or (destino_tipo <> 'splitter_out')
  )
);

-- Un hilo solo puede tener UNA continuidad 1:1 (empalme directo o
-- terminado); en cambio puede repetirse en varias filas 'splitter_out'
-- (una por puerto de salida del splitter), por eso el indice unico es
-- parcial y no cubre ese caso.
create unique index idx_fo_fusiones_hilo_a_unico
  on public.fo_fusiones (cable_a_id, hilo_a_index)
  where destino_tipo <> 'splitter_out';

create index idx_fo_fusiones_infra on public.fo_fusiones (infra_elemento_id);
create index idx_fo_fusiones_cable_a on public.fo_fusiones (cable_a_id, hilo_a_index);
create index idx_fo_fusiones_cable_b on public.fo_fusiones (cable_b_id, hilo_b_index);

-- Ocupacion de puertos de cliente en una caja NAP.
create table public.fo_nap_puertos (
  id                 uuid primary key default gen_random_uuid(),
  infra_elemento_id  uuid not null references public.infra_elementos (id) on delete cascade,
  puerto_numero      integer not null,
  estado             text not null default 'libre' check (estado in ('libre', 'ocupado', 'reservado', 'dañado')),
  client_id          uuid references public.clients (id) on delete set null,
  fusion_id          uuid references public.fo_fusiones (id) on delete set null,
  notes              text,
  updated_at         timestamptz not null default now(),
  unique (infra_elemento_id, puerto_numero)
);

create trigger trg_fo_nap_puertos_updated_at
  before update on public.fo_nap_puertos
  for each row execute procedure public.set_updated_at();

alter table public.fo_cables enable row level security;
alter table public.fo_hilo_estados enable row level security;
alter table public.fo_fusiones enable row level security;
alter table public.fo_nap_puertos enable row level security;

-- Mismo criterio de acceso que infra_elementos (Fase 7): todo el staff interno.
create policy "fo_cables_staff_only" on public.fo_cables for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "fo_hilo_estados_staff_only" on public.fo_hilo_estados for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "fo_fusiones_staff_only" on public.fo_fusiones for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "fo_nap_puertos_staff_only" on public.fo_nap_puertos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));
