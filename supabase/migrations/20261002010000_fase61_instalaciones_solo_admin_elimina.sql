-- SmartRayco — Fase 61: solo SUPERADMIN/ADMIN/SOPORTE/FACTURACION pueden
-- eliminar una instalacion (nunca TECNICO_RED), y solo si ya esta
-- 'cancelled'.
--
-- Bug real: la Fase 16 dejo "installations_delete_staff" con los mismos 5
-- roles de siempre (incluido TECNICO_RED) — el frontend (InstalacionesView.vue,
-- funcion canDelete) SI bloqueaba el boton para tecnicos y exigia status
-- 'cancelled', pero esa regla nunca se replico en RLS. Cualquier tecnico
-- podia eliminar una instalacion (de cualquier estado) llamando a Supabase
-- directo, sin pasar por el boton. Se corrige la policy para que coincida
-- de verdad con la regla de negocio ya documentada en el frontend.

drop policy if exists "installations_delete_staff" on public.installations;
create policy "installations_delete_staff"
  on public.installations for delete to authenticated
  using (
    status = 'cancelled'
    and public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE', 'FACTURACION')
  );
