-- SmartRayco — Fase 58: RBAC de Inventario/Kardex, solo SUPERADMIN elimina.
--
-- Hasta ahora ADMIN tambien podia eliminar productos (Fase 11d) y unidades
-- serializadas (Fase 19). Se pide acotar esa facultad a SUPERADMIN unico —
-- ADMIN y el resto del staff conservan crear/editar productos y registrar
-- movimientos (+Ingreso/-Egreso), pero ya no pueden eliminar nada.
--
-- El Kardex (inventory_movements) sigue siendo un libro contable insert-only
-- (Fase 11, sin policy de update/delete) — NO se agrega DELETE ahi: en vez
-- de borrar una fila (lo que dejaria mal el balance_after de todas las
-- filas posteriores de ese producto), SUPERADMIN "revierte" un movimiento
-- insertando el movimiento opuesto, trazado por `reverses_movement_id`. Esa
-- insercion ya la permite la policy de insert existente (todo el staff) —
-- aqui solo se agrega la columna de trazabilidad; restringir el boton de
-- "Revertir" a SUPERADMIN es una decision de UI, no de RLS, porque
-- cualquier staff ya puede insertar un +Ingreso/-Egreso manual equivalente.
--
-- Idempotente: permite re-ejecutar el archivo completo sin error.

alter table public.inventory_movements
  add column if not exists reverses_movement_id uuid references public.inventory_movements (id);

create index if not exists idx_inventory_movements_reverses on public.inventory_movements (reverses_movement_id);

-- ---- Productos: solo SUPERADMIN desactiva (Fase 11d, acotado) ----
create or replace function public.guard_inventory_product_deactivation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.is_active = true and new.is_active = false and public.current_user_role() <> 'SUPERADMIN' then
    raise exception 'Solo el Super Admin tiene permisos para eliminar o alterar registros de inventario';
  end if;
  return new;
end;
$$;

-- ---- Unidades serializadas: solo SUPERADMIN elimina (Fase 19, acotado) ----
drop policy if exists "inventory_units_delete_staff" on public.inventory_units;
create policy "inventory_units_delete_staff"
  on public.inventory_units for delete to authenticated
  using (public.current_user_role() = 'SUPERADMIN');
