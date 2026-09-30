-- SmartRayco — Fase 51c: separa el álbum virtual único "Equipos por Recoger /
-- En Recupero" (Fase 51/51b) en DOS álbumes virtuales distintos, porque en la
-- practica seguian mostrandose mezclados "recojo pendiente por baja de
-- servicio" (en_recupero) y "avería / en reparación" (damaged/in_repair) —
-- justamente lo que Fase 51 separo con los botones de accion, pero el álbum
-- resumen los volvia a juntar.
--
-- - 'por_recoger'  -> "Equipos por Recoger"          -> solo status 'en_recupero'.
-- - 'averiados'    -> "Averiados / En Reparación"    -> status 'damaged'/'in_repair'/'retired'
--   ("Dados de baja" se queda en el mismo álbum donde ya estaba, no se mueve).
--
-- No requiere ALTER TYPE (no toca el enum), por eso se puede correr de una
-- sola vez sin el problema de transaccion de fase51/51b.
--
-- Idempotente: permite re-ejecutar sin error si ya se corrio antes.

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

  -- Álbum virtual "Equipos por Recoger": recojo pendiente por baja de
  -- servicio/falta de pago/migracion (Fase 51), aun no se sabe en que estado
  -- llega. A proposito no es una fila de inventory_categories (Fase 44).
  select
    'por_recoger',
    'Equipos por Recoger',
    '🔄',
    'rose',
    98,
    count(*),
    0::bigint,
    coalesce(sum(p.price), 0)
  from public.inventory_units iu
  join public.inventory_products p on p.id = iu.product_id
  where iu.status = 'en_recupero'

  union all

  -- Álbum virtual "Averiados / En Reparación": equipo que fallo estando con
  -- el cliente, ya recibido en bodega para reparar, o dado de baja.
  select
    'averiados',
    'Averiados / En Reparación',
    '🛠️',
    'amber',
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
