-- SmartRayco — Fase 11d: solo ADMIN/SUPERADMIN pueden eliminar (desactivar)
-- un producto del inventario.
--
-- "Eliminar" en Inventario es un soft-delete (is_active: true -> false, ver
-- Fase 11) para no perder el Kardex ni el historial de equipos serializados
-- (Fase 11c) ligados al producto. El resto del staff (TECNICO_RED, SOPORTE,
-- FACTURACION) conserva crear/editar productos y registrar movimientos; solo
-- se restringe esa transicion puntual. RLS no puede comparar el valor
-- anterior y nuevo de un mismo campo en una sola policy, por eso se valida
-- con un trigger en vez de separar la policy de update.
--
-- Idempotente: permite re-ejecutar el archivo completo sin error.

create or replace function public.guard_inventory_product_deactivation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.is_active = true and new.is_active = false and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo un administrador puede eliminar productos del inventario';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_products_guard_deactivation on public.inventory_products;
create trigger trg_inventory_products_guard_deactivation
  before update on public.inventory_products
  for each row execute procedure public.guard_inventory_product_deactivation();
