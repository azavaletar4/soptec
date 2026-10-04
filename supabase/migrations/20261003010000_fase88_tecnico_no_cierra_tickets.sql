-- Fase 88: TECNICO_RED puede pasar su averia asignada a "in_progress" o
-- "resolved", pero cerrarla (validacion final de admin/soporte, que archiva
-- el ticket) le queda vedado. La policy de update de Fase 15 solo exigia
-- que el ticket fuera suyo, sin restringir a que estado podia moverlo.

drop policy if exists "tickets_update_staff" on public.tickets;

create policy "tickets_update_staff"
  on public.tickets for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE')
    or (
      public.current_user_role() = 'TECNICO_RED'
      and assigned_to = auth.uid()
      and status <> 'closed'
    )
  );
