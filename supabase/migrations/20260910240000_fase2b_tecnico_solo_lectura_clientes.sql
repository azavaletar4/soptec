-- SmartRayco — TECNICO_RED ya no puede crear ni eliminar clientes.
--
-- El tecnico de campo necesita ver y actualizar datos del cliente ligados
-- a su visita (GPS, fotos de instalacion via client_photos), pero dar de
-- alta o borrar un cliente es tarea de SOPORTE/ADMIN/FACTURACION. Se
-- reemplaza la policy unica "for all" por selec/update (todo el staff,
-- incluye TECNICO_RED) + insert/delete (sin TECNICO_RED).

drop policy "clients_staff_only" on public.clients;

create policy "clients_staff_select"
  on public.clients for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "clients_staff_update"
  on public.clients for update to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

create policy "clients_staff_insert"
  on public.clients for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'));

create policy "clients_staff_delete"
  on public.clients for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION'));
