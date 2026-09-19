-- Fase 19: permite eliminar (borrado real, no solo "dar de baja") una
-- unidad de inventario puntual (ONU/router por serie/MAC) — util para
-- limpiar equipos de prueba cargados por error. Solo SUPERADMIN/ADMIN,
-- igual criterio que eliminar productos (Fase 11d). select/insert/update
-- se dejan igual que antes (todo el staff, incluye TECNICO_RED: sigue
-- pudiendo registrar/asignar/devolver equipos).
--
-- inventory_unit_events.unit_id ya tiene "on delete cascade" (Fase 11c),
-- asi que borrar una unidad se lleva su historial de eventos con ella sin
-- violar ninguna llave foranea.

drop policy if exists "inventory_units_staff_only" on public.inventory_units;

create policy "inventory_units_select_staff"
  on public.inventory_units for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "inventory_units_insert_staff"
  on public.inventory_units for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "inventory_units_update_staff"
  on public.inventory_units for update to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "inventory_units_delete_staff"
  on public.inventory_units for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));
