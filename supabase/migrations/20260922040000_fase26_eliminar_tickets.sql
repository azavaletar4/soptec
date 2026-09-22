-- Fase 26: permite eliminar tickets (limpieza de pruebas), devolviendo a
-- bodega los materiales que tuviera asignados.
--
-- De paso corrige un bug real en las policies de tickets: la Fase 6c creo
-- "tickets_admin_delete" (solo SUPERADMIN/ADMIN), pero la Fase 15 intento
-- reemplazar las policies haciendo "drop policy tickets_staff_only" (que ya
-- no existia, la Fase 6c la habia reemplazado) y creando POLICIES NUEVAS
-- CON OTRO NOMBRE ("tickets_delete_staff" en vez de "tickets_admin_delete")
-- en vez de reemplazar las de la Fase 6c. Como las policies del mismo
-- comando se OR-ean, terminaron coexistiendo "tickets_admin_delete"
-- (SUPERADMIN/ADMIN) y "tickets_delete_staff" (+ TECNICO_RED/SOPORTE) al
-- mismo tiempo — el delete quedo abierto a mas roles de los que la Fase 6c
-- queria. Mismo problema en insert ("tickets_admin_insert" vs
-- "tickets_insert_staff"). select/update no se vieron afectados (mismos
-- roles en ambas versiones). Se dropean TODOS los nombres historicos y se
-- recrean limpias, una sola vez, con los roles realmente pedidos: crear y
-- borrar solo SUPERADMIN/ADMIN (igual que canCreateTickets ya hace en el
-- frontend); ver/editar sigue como en la Fase 15 (TECNICO_RED solo sus
-- propios tickets asignados).

drop policy if exists "tickets_staff_only" on public.tickets;
drop policy if exists "tickets_staff_select" on public.tickets;
drop policy if exists "tickets_staff_update" on public.tickets;
drop policy if exists "tickets_admin_insert" on public.tickets;
drop policy if exists "tickets_admin_delete" on public.tickets;
drop policy if exists "tickets_select_staff" on public.tickets;
drop policy if exists "tickets_insert_staff" on public.tickets;
drop policy if exists "tickets_delete_staff" on public.tickets;
drop policy if exists "tickets_update_staff" on public.tickets;

create policy "tickets_select_staff"
  on public.tickets for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "tickets_insert_admin"
  on public.tickets for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

create policy "tickets_update_staff"
  on public.tickets for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  );

create policy "tickets_delete_admin"
  on public.tickets for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));
