-- SmartRayco — Fase 11c: control de inventario por unidad serializada
-- (numero de serie / MAC), asignacion a cliente y modulo de devoluciones.
--
-- inventory_products sigue siendo el catalogo con stock agregado (Fase 11)
-- para consumibles (cable, conectores, etc). Los productos serializados
-- (is_serialized = true: ONUs, routers Wi-Fi, antenas) ademas llevan una
-- fila por unidad fisica en inventory_units, cada una con su propio estado
-- y, si esta asignada, el cliente que la tiene.
--
-- inventory_unit_events es un Kardex insert-only (mismo patron que
-- inventory_movements en Fase 11): el trigger BEFORE INSERT
-- apply_inventory_unit_event aplica el cambio de estado/asignacion a
-- inventory_units de forma atomica (lock de fila), asi el historial nunca
-- se desincroniza del estado actual de la unidad.
--
-- Idempotente: permite re-ejecutar el archivo completo sin error si una
-- corrida anterior ya creo parte de estos objetos.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'inventory_unit_status') then
    create type public.inventory_unit_status as enum ('in_stock', 'assigned', 'damaged', 'in_repair', 'retired');
  end if;
end
$$;

alter table public.inventory_products
  add column if not exists is_serialized boolean not null default false;

create table if not exists public.inventory_units (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.inventory_products (id) on delete cascade,
  serial_number   text,
  mac_address     text,
  status          public.inventory_unit_status not null default 'in_stock',
  client_id       uuid references public.clients (id) on delete set null,
  installation_id uuid references public.installations (id) on delete set null,
  assigned_at     timestamptz,
  notes           text,
  created_by      uuid references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inventory_units_identifier_chk check (serial_number is not null or mac_address is not null)
);

create unique index if not exists idx_inventory_units_serial_unique
  on public.inventory_units (serial_number) where serial_number is not null;
create unique index if not exists idx_inventory_units_mac_unique
  on public.inventory_units (lower(mac_address)) where mac_address is not null;
create index if not exists idx_inventory_units_product on public.inventory_units (product_id);
create index if not exists idx_inventory_units_client on public.inventory_units (client_id) where client_id is not null;
create index if not exists idx_inventory_units_status on public.inventory_units (status);

alter table public.inventory_units enable row level security;

drop policy if exists "inventory_units_staff_only" on public.inventory_units;
create policy "inventory_units_staff_only"
  on public.inventory_units for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop trigger if exists trg_inventory_units_updated_at on public.inventory_units;
create trigger trg_inventory_units_updated_at
  before update on public.inventory_units
  for each row execute procedure public.set_updated_at();

-- Kardex de unidades: se crea e inserta, nunca se edita ni borra (igual que
-- inventory_movements) — por eso solo hay policy de select + insert.
create table if not exists public.inventory_unit_events (
  id              uuid primary key default gen_random_uuid(),
  unit_id         uuid not null references public.inventory_units (id) on delete cascade,
  from_status     public.inventory_unit_status,
  to_status       public.inventory_unit_status not null,
  client_id       uuid references public.clients (id) on delete set null,
  installation_id uuid references public.installations (id) on delete set null,
  reason          text,
  created_by      uuid references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now()
);

alter table public.inventory_unit_events enable row level security;

drop policy if exists "inventory_unit_events_staff_select" on public.inventory_unit_events;
create policy "inventory_unit_events_staff_select"
  on public.inventory_unit_events for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop policy if exists "inventory_unit_events_staff_insert" on public.inventory_unit_events;
create policy "inventory_unit_events_staff_insert"
  on public.inventory_unit_events for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create index if not exists idx_inventory_unit_events_unit on public.inventory_unit_events (unit_id, created_at desc);

-- Aplica el evento a la unidad de forma atomica (lock de fila). Asignar
-- (to_status = 'assigned') exige cliente y solo se permite desde 'in_stock';
-- cualquier otro destino (devolucion a bodega, dañado, en reparacion, baja)
-- limpia la asignacion. Una unidad dada de baja no admite mas movimientos.
create or replace function public.apply_inventory_unit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_status public.inventory_unit_status;
begin
  select status into current_status
  from public.inventory_units
  where id = new.unit_id
  for update;

  new.from_status := current_status;

  if current_status = 'retired' then
    raise exception 'El equipo esta dado de baja y no admite mas movimientos';
  end if;

  if new.to_status = 'assigned' then
    if new.client_id is null then
      raise exception 'Debe indicar el cliente al asignar un equipo';
    end if;
    if current_status is distinct from 'in_stock' then
      raise exception 'Solo se puede asignar un equipo que este en bodega (estado actual: %)', current_status;
    end if;
  end if;

  update public.inventory_units
  set
    status          = new.to_status,
    client_id       = case when new.to_status = 'assigned' then new.client_id else null end,
    installation_id = case when new.to_status = 'assigned' then new.installation_id else null end,
    assigned_at     = case when new.to_status = 'assigned' then now() else assigned_at end,
    updated_at      = now()
  where id = new.unit_id;

  return new;
end;
$$;

drop trigger if exists trg_inventory_unit_events_apply on public.inventory_unit_events;
create trigger trg_inventory_unit_events_apply
  before insert on public.inventory_unit_events
  for each row execute procedure public.apply_inventory_unit_event();
