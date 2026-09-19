-- Fase 17: TECNICO_RED ya no puede crear instalaciones (solo completar/
-- gestionar las que tiene asignadas, ver Fase 16). Programarlas sigue
-- siendo tarea de SUPERADMIN/ADMIN/SOPORTE/FACTURACION.

drop policy if exists "installations_insert_staff" on public.installations;

create policy "installations_insert_staff"
  on public.installations for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'));
