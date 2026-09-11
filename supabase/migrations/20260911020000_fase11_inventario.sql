-- SmartRayco — Fase 11: Inventario (productos + Kardex de movimientos).
--
-- current_stock en inventory_products es un saldo desnormalizado, mantenido
-- solo por el trigger de inventory_movements (nunca se edita a mano) — asi
-- el Kardex (historial con saldo acumulado por movimiento) y el stock actual
-- del producto nunca se desincronizan. Mismo criterio de RLS que
-- service_contracts (Fase 2): todo el staff interno.
--
-- Idempotente (ver nota en fase9): permite re-ejecutar el archivo completo
-- sin error si una corrida anterior ya creo parte de estos objetos.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'inventory_movement_type') then
    create type public.inventory_movement_type as enum ('ingreso', 'egreso');
  end if;
end
$$;

create table if not exists public.inventory_products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text,
  unit          text not null default 'unidad',
  price         numeric(10, 2) not null default 0,
  min_stock     numeric(12, 2) not null default 0,
  current_stock numeric(12, 2) not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.inventory_products (id) on delete cascade,
  movement_type  public.inventory_movement_type not null,
  quantity       numeric(12, 2) not null check (quantity > 0),
  reason         text,
  balance_after  numeric(12, 2) not null,
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now()
);

alter table public.inventory_products enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_products_staff_only" on public.inventory_products;
create policy "inventory_products_staff_only"
  on public.inventory_products for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

-- Los movimientos son un libro contable: se crean e insertan, nunca se
-- editan ni borran (una correccion se hace con un movimiento inverso), por
-- eso solo hay policy de select + insert (no update/delete).
drop policy if exists "inventory_movements_staff_select" on public.inventory_movements;
create policy "inventory_movements_staff_select"
  on public.inventory_movements for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop policy if exists "inventory_movements_staff_insert" on public.inventory_movements;
create policy "inventory_movements_staff_insert"
  on public.inventory_movements for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop trigger if exists trg_inventory_products_updated_at on public.inventory_products;
create trigger trg_inventory_products_updated_at
  before update on public.inventory_products
  for each row execute procedure public.set_updated_at();

-- Aplica el movimiento al stock del producto de forma atomica (lock de fila)
-- y calcula el saldo acumulado para el Kardex. Bloquea egresos que dejarian
-- el stock en negativo.
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_stock numeric(12, 2);
begin
  select current_stock into new_stock
  from public.inventory_products
  where id = new.product_id
  for update;

  if new.movement_type = 'ingreso' then
    new_stock := new_stock + new.quantity;
  else
    new_stock := new_stock - new.quantity;
    if new_stock < 0 then
      raise exception 'Stock insuficiente: quedarian % unidades', new_stock;
    end if;
  end if;

  new.balance_after := new_stock;

  update public.inventory_products
  set current_stock = new_stock, updated_at = now()
  where id = new.product_id;

  return new;
end;
$$;

drop trigger if exists trg_inventory_movements_apply on public.inventory_movements;
create trigger trg_inventory_movements_apply
  before insert on public.inventory_movements
  for each row execute procedure public.apply_inventory_movement();

create index if not exists idx_inventory_movements_product_id on public.inventory_movements (product_id, created_at desc);
