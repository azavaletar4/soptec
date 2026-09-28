-- SmartRayco — Fase 44: Álbumes visuales de Inventario.
--
-- Reemplaza el agrupamiento por texto libre (inventory_products.category) por
-- una taxonomia real (inventory_categories), y agrega una funcion agregada
-- (inventory_get_albums) para que la UI de álbumes no tenga que traer todo
-- el inventario al navegador para calcular contadores/valor total.
--
-- No se toca el modelo de trazabilidad de Fase 11c/37b (inventory_units +
-- inventory_unit_events): el álbum "Equipos por Recoger / Averiados" es
-- virtual (se arma agregando por status), no una fila de esta tabla — mover
-- un equipo ahi sigue siendo un evento de inventory_unit_events, igual que
-- hoy en Devoluciones, para no duplicar ni romper esa trazabilidad.
--
-- category (texto libre) NO se elimina: queda como etiqueta heredada para no
-- romper selects existentes que ya la piden (product:inventory_products(id,
-- name, category) en inventoryUnits store, DevolucionesView, etc). La UI
-- nueva agrupa por category_id.
--
-- Idempotente: permite re-ejecutar el archivo completo sin error si una
-- corrida anterior ya creo parte de estos objetos.

create table if not exists public.inventory_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  icon        text not null default '📦',
  color       text not null default 'slate',
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.inventory_products
  add column if not exists category_id uuid references public.inventory_categories (id);

alter table public.inventory_categories enable row level security;

drop policy if exists "inventory_categories_staff_only" on public.inventory_categories;
create policy "inventory_categories_staff_only"
  on public.inventory_categories for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop trigger if exists trg_inventory_categories_updated_at on public.inventory_categories;
create trigger trg_inventory_categories_updated_at
  before update on public.inventory_categories
  for each row execute procedure public.set_updated_at();

create index if not exists idx_inventory_products_category_id on public.inventory_products (category_id);

-- Seed de las categorias pedidas + una de resguardo para lo que no matchee
-- en el backfill de abajo.
insert into public.inventory_categories (slug, name, icon, color, sort_order) values
  ('onu',        'ONUs / ONTs',                   '📦', 'sky',     10),
  ('ferreteria', 'Ferretería & Planta Exterior',   '🛠️', 'amber',   20),
  ('tvbox',      'TV Box',                         '📺', 'violet',  30),
  ('mesh',       'Mesh / Routers',                 '🌐', 'emerald', 40),
  ('otros',      'Otros',                          '🗂️', 'slate',   90)
on conflict (slug) do nothing;

-- Backfill heuristico best-effort a partir del nombre/categoria de texto
-- existente. ADVERTENCIA: es una primera aproximacion por palabras clave —
-- antes de dar esto por definitivo, revisar con:
--   select id, name, category, category_id from inventory_products order by category_id;
-- y recategorizar a mano (desde el selector de categoria del producto) lo
-- que haya caido en 'otros' o matcheado mal.
update public.inventory_products p
set category_id = c.id
from public.inventory_categories c
where p.category_id is null and c.slug = case
  when p.name ~* 'onu|ont' or p.category ~* 'onu|ont' then 'onu'
  when p.name ~* 'tv ?box|decodificador' or p.category ~* 'tv ?box' then 'tvbox'
  when p.name ~* 'mesh|router|k562' or p.category ~* 'mesh|router' then 'mesh'
  when p.name ~* 'brazo|bobina|drop|herraje|conector|cable' or p.category ~* 'ferreter|drop' then 'ferreteria'
  else 'otros'
end;

-- Agrega los contadores/valor total por álbum, agregando en SQL la
-- diferencia entre productos por cantidad (current_stock) y productos
-- serializados (cuentan sus inventory_units en status 'in_stock', ver nota
-- de Fase 11c: current_stock no se usa para is_serialized = true).
create or replace function public.inventory_get_albums()
returns table (
  album_slug   text,
  album_name   text,
  icon         text,
  color        text,
  sort_order   int,
  item_count   bigint,
  low_stock    bigint,
  total_value  numeric
)
language sql
stable
security definer set search_path = public
as $$
  select
    c.slug,
    c.name,
    c.icon,
    c.color,
    c.sort_order,
    coalesce(count(distinct p.id) filter (where p.id is not null and not p.is_serialized), 0)
      + coalesce(sum(u_counts.in_stock_count) filter (where p.is_serialized), 0) as item_count,
    coalesce(count(*) filter (where not p.is_serialized and p.current_stock <= p.min_stock), 0) as low_stock,
    coalesce(sum(case when p.is_serialized
      then u_counts.in_stock_count * p.price
      else p.current_stock * p.price end), 0) as total_value
  from public.inventory_categories c
  left join public.inventory_products p on p.category_id = c.id and p.is_active
  left join lateral (
    select count(*) as in_stock_count
    from public.inventory_units iu
    where iu.product_id = p.id and iu.status = 'in_stock'
  ) u_counts on p.is_serialized
  where c.is_active
  group by c.slug, c.name, c.icon, c.color, c.sort_order

  union all

  -- Álbum virtual "Equipos por Recoger / Averiados": cruza todas las
  -- categorias filtrando por status de inventory_units. A proposito no es
  -- una fila de inventory_categories (ver nota al inicio del archivo).
  select
    'por_recoger',
    'Equipos por Recoger / Averiados',
    '🔄',
    'rose',
    99,
    count(*),
    0::bigint,
    coalesce(sum(p.price), 0)
  from public.inventory_units iu
  join public.inventory_products p on p.id = iu.product_id
  where iu.status in ('damaged', 'in_repair', 'retired')

  order by sort_order;
$$;

grant execute on function public.inventory_get_albums() to authenticated;
