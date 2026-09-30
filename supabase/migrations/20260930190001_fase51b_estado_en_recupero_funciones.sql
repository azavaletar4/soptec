-- SmartRayco — Fase 51b: columnas de trazabilidad del recojo y funciones que
-- usan el valor 'en_recupero' agregado en fase51.
--
-- Correr SOLO despues de que fase51 (ALTER TYPE ... ADD VALUE) haya quedado
-- commiteado — si Supabase reclama "unsafe use of new value ... must be
-- committed before they can be used", es porque este archivo se pego junto
-- con fase51 y se corrieron como una sola transaccion. Hay que ejecutar cada
-- archivo por separado (Run, esperar, recien despues el siguiente).
--
-- Idempotente: permite re-ejecutar sin error si ya se corrio antes.

-- Tecnico asignado a ir a recoger el equipo (Fase 51) — cacheado en la unidad
-- igual que installation_id/client_id, para listarlo sin JOIN al ultimo
-- evento del Kardex.
alter table public.inventory_units
  add column if not exists pending_pickup_by uuid references public.profiles (id);

-- Tecnico responsable del recojo en ese evento puntual (Kardex).
alter table public.inventory_unit_events
  add column if not exists assigned_to uuid references public.profiles (id);

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
    status            = new.to_status,
    client_id         = case when new.to_status = 'assigned' then new.client_id else null end,
    installation_id   = case when new.to_status = 'assigned' then new.installation_id else null end,
    assigned_at       = case when new.to_status = 'assigned' then now() else assigned_at end,
    pending_pickup_by = case when new.to_status = 'en_recupero' then new.assigned_to else null end,
    updated_at        = now()
  where id = new.unit_id;

  return new;
end;
$$;

-- Agrega 'en_recupero' al album virtual (Fase 44) y renombra su titulo: ya
-- no es solo "Averiados", ahora agrupa tambien el recojo pendiente por baja
-- de servicio.
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

  -- Álbum virtual "Equipos por Recoger / En Recupero": cruza todas las
  -- categorias filtrando por status de inventory_units. A proposito no es
  -- una fila de inventory_categories (ver nota de Fase 44).
  select
    'por_recoger',
    'Equipos por Recoger / En Recupero',
    '🔄',
    'rose',
    99,
    count(*),
    0::bigint,
    coalesce(sum(p.price), 0)
  from public.inventory_units iu
  join public.inventory_products p on p.id = iu.product_id
  where iu.status in ('damaged', 'in_repair', 'retired', 'en_recupero')

  order by sort_order;
$$;

grant execute on function public.inventory_get_albums() to authenticated;
