-- Fase 18: se puede eliminar una instalacion, pero solo si esta cancelada
-- (evita borrar por error una activa/completada) y no por TECNICO_RED —
-- mismo criterio que clients_staff_delete (Fase 2b): housekeeping de
-- registros queda para SUPERADMIN/ADMIN/SOPORTE/FACTURACION.

drop policy if exists "installations_delete_staff" on public.installations;

create policy "installations_delete_staff"
  on public.installations for delete to authenticated
  using (
    status = 'cancelled'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION')
  );
