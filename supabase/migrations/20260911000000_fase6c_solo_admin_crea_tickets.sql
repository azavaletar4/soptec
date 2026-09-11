-- SmartRayco — Solo ADMIN/SUPERADMIN pueden crear tickets.
--
-- TECNICO_RED y SOPORTE conservan ver/atender tickets (cambiar estado,
-- prioridad, asignacion, comentarios), pero no dar de alta uno nuevo.

drop policy "tickets_staff_only" on public.tickets;

create policy "tickets_staff_select"
  on public.tickets for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "tickets_staff_update"
  on public.tickets for update to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "tickets_admin_insert"
  on public.tickets for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

create policy "tickets_admin_delete"
  on public.tickets for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));
