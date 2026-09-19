-- Fase 15: TECNICO_RED ve todos los tickets de soporte, pero solo puede
-- editar (cambiar estado/prioridad/asignacion, comentar) los que tiene
-- asignados. SUPERADMIN/ADMIN/SOPORTE siguen pudiendo editar cualquiera.
--
-- La policy "tickets_staff_only" (Fase 6) era "for all" con el mismo check
-- para select/insert/update/delete — hay que separarla por comando para
-- poder restringir solo el update de TECNICO_RED sin tocar el resto.

drop policy if exists "tickets_staff_only" on public.tickets;

create policy "tickets_select_staff"
  on public.tickets for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "tickets_insert_staff"
  on public.tickets for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "tickets_delete_staff"
  on public.tickets for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

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

-- Comentarios de seguimiento: agregar uno nuevo cuenta como "editar" el
-- ticket, asi que sigue la misma regla en el insert. Select/update/delete
-- de comentarios se dejan igual que antes (abiertos a todo el staff).
drop policy if exists "ticket_comments_staff_only" on public.ticket_comments;

create policy "ticket_comments_select_staff"
  on public.ticket_comments for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "ticket_comments_update_staff"
  on public.ticket_comments for update to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "ticket_comments_delete_staff"
  on public.ticket_comments for delete to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'));

create policy "ticket_comments_insert_staff"
  on public.ticket_comments for insert to authenticated
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (
      public.current_user_role() = 'TECNICO_RED'
      and exists (select 1 from public.tickets t where t.id = ticket_id and t.assigned_to = auth.uid())
    )
  );
