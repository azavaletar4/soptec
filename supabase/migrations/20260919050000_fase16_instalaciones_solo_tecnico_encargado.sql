-- Fase 16: en Instalaciones, solo SUPERADMIN/ADMIN o el TECNICO_RED
-- encargado (assigned_to) pueden editar una instalacion. A diferencia de
-- Soporte (Fase 15), aqui SOPORTE/FACTURACION pueden seguir viendo la
-- lista pero ya no pueden editar ninguna.

drop policy if exists "installations_staff_only" on public.installations;

create policy "installations_select_staff"
  on public.installations for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "installations_insert_staff"
  on public.installations for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "installations_delete_staff"
  on public.installations for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "installations_update_staff"
  on public.installations for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  );
