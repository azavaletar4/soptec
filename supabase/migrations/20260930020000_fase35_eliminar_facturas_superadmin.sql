-- SmartRayco — Fase 35: permite eliminar facturas de prueba, solo SUPERADMIN.
--
-- Mismo patron que la Fase 26 (tickets): separa el "delete" de la policy
-- monolitica "invoices_billing_staff" (Fase 7, for all a SUPERADMIN/ADMIN/
-- FACTURACION) en su propia policy mas restrictiva. select/insert/update
-- quedan igual que hoy (todo el staff de facturacion); solo eliminar se
-- restringe a SUPERADMIN, tal como ya funciona "Eliminar contrato" en la
-- ficha del cliente (canDeleteContracts) y "Editar factura" en Facturacion
-- (isSuperadmin).
--
-- Las referencias desde otras tablas ya estan preparadas para esto sin
-- necesitar nada mas: invoice_adjustments.invoice_id es on delete cascade
-- (se limpia solo), y referidos.invoice_id / client_credit_movements.invoice_id
-- / service_contracts.debt_hold_invoice_id son on delete set null (no
-- bloquean el borrado).

drop policy if exists "invoices_billing_staff" on public.invoices;

create policy "invoices_select_staff"
  on public.invoices for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

create policy "invoices_insert_staff"
  on public.invoices for insert to authenticated
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

create policy "invoices_update_staff"
  on public.invoices for update to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

create policy "invoices_delete_superadmin"
  on public.invoices for delete to authenticated
  using (public.current_user_role() = 'SUPERADMIN');
