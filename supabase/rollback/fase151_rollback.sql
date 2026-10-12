-- SmartRayco — ROLLBACK de Fase 151 (proteger órdenes de Instalación
-- cerradas). NO es una migración de avance — vive fuera de
-- supabase/migrations/ a propósito, para que ninguna herramienta la
-- aplique por error junto a las demás. Ejecutar a mano, solo si Fase 151
-- ya se aplicó y hace falta revertirla.
--
-- Restaura EXACTAMENTE las 4 definiciones tal como estaban inmediatamente
-- antes de Fase 151 (mismo texto que sus migraciones originales: Fase 70,
-- Fase 94, Fase 95b, Fase 69) — no un "parecido", el texto literal.
-- Idempotente: se puede re-ejecutar sin error.

-- =========================================================
-- 1) installations_update_staff -> version de Fase 70
-- =========================================================
drop policy if exists "installations_update_staff" on public.installations;
create policy "installations_update_staff"
  on public.installations for update to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid() and status <> 'completed')
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  );

-- =========================================================
-- 2) job_assignees_write_dispatch -> version de Fase 94
-- =========================================================
drop policy if exists "job_assignees_write_dispatch" on public.job_assignees;
create policy "job_assignees_write_dispatch"
  on public.job_assignees for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'SOPORTE'));

-- =========================================================
-- 3) apply_inventory_unit_event() -> version de Fase 95b (la vigente
-- inmediatamente antes de Fase 151)
-- =========================================================
create or replace function public.apply_inventory_unit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_status public.inventory_unit_status;
  current_installation_id uuid;
  current_product_id uuid;
  installation_status public.installation_status;
  ticket_status public.ticket_status;
  unit_category_slug text;
  existing_onu_count integer;
  is_occupying_status boolean;
begin
  select status, installation_id, product_id into current_status, current_installation_id, current_product_id
  from public.inventory_units
  where id = new.unit_id
  for update;

  new.from_status := current_status;
  is_occupying_status := new.to_status in ('assigned', 'pending_approval');

  if current_status = 'retired' then
    raise exception 'El equipo esta dado de baja y no admite mas movimientos';
  end if;

  if current_installation_id is not null then
    select status into installation_status from public.installations where id = current_installation_id;
    if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada; solo un administrador puede corregir el equipo asignado';
    end if;
  end if;

  if is_occupying_status then
    if new.client_id is null then
      raise exception 'Debe indicar el cliente al asignar un equipo';
    end if;
    if not (current_status = 'in_stock' or (current_status = 'pending_approval' and new.to_status = 'assigned')) then
      raise exception 'Solo se puede asignar un equipo que este en bodega, o aprobar uno pendiente (estado actual: %)', current_status;
    end if;

    if new.installation_id is not null and new.installation_id is distinct from current_installation_id then
      select status into installation_status from public.installations where id = new.installation_id;
      if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
        raise exception 'La instalación ya fue completada; solo un administrador puede asignar equipo nuevo';
      end if;
    end if;

    if new.ticket_id is not null then
      select status into ticket_status from public.tickets where id = new.ticket_id;
      if ticket_status in ('resolved', 'closed') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN', 'SOPORTE') then
        raise exception 'La avería ya fue resuelta; solo administración/soporte puede registrar o aprobar equipo';
      end if;
    end if;

    if new.to_status = 'assigned' and new.ticket_id is not null and public.current_user_role() = 'TECNICO_RED' then
      raise exception 'El equipo entrante de una avería queda pendiente de aprobación — un técnico no puede asignarlo directo';
    end if;

    select ic.slug into unit_category_slug
    from public.inventory_products p
    left join public.inventory_categories ic on ic.id = p.category_id
    where p.id = current_product_id;

    if unit_category_slug = 'onu' then
      if new.installation_id is not null then
        select count(*) into existing_onu_count
        from public.inventory_units u
        join public.inventory_products p2 on p2.id = u.product_id
        join public.inventory_categories ic2 on ic2.id = p2.category_id
        where u.installation_id = new.installation_id
          and u.status in ('assigned', 'pending_approval')
          and u.id <> new.unit_id
          and ic2.slug = 'onu';
        if existing_onu_count > 0 then
          raise exception 'Solo se puede asignar 1 ONT/Módem por instalación. Si te equivocaste de serie, quita el equipo actual antes de agregar uno nuevo.';
        end if;
      end if;

      if new.contract_id is not null then
        select count(*) into existing_onu_count
        from public.inventory_units u
        join public.inventory_products p2 on p2.id = u.product_id
        join public.inventory_categories ic2 on ic2.id = p2.category_id
        where u.contract_id = new.contract_id
          and u.status in ('assigned', 'pending_approval')
          and u.id <> new.unit_id
          and ic2.slug = 'onu';
        if existing_onu_count > 0 then
          raise exception 'Solo se puede asignar 1 ONT/Módem por línea. Si te equivocaste, quita o rechaza el equipo actual de esta línea antes de agregar uno nuevo.';
        end if;
      end if;
    end if;
  end if;

  update public.inventory_units
  set
    status          = new.to_status,
    client_id       = case when is_occupying_status then new.client_id else null end,
    contract_id     = case when is_occupying_status then new.contract_id else null end,
    installation_id = case when is_occupying_status then new.installation_id else null end,
    ticket_id       = case when is_occupying_status then new.ticket_id else null end,
    assigned_at     = case when is_occupying_status then now() else assigned_at end,
    updated_at      = now()
  where id = new.unit_id;

  return new;
end;
$$;

-- =========================================================
-- 4) apply_inventory_movement() -> version de Fase 69
-- =========================================================
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_stock numeric(12, 2);
  installation_status public.installation_status;
begin
  if new.installation_id is not null then
    select status into installation_status from public.installations where id = new.installation_id;
    if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada; solo un administrador puede registrar materiales nuevos';
    end if;
  end if;

  select current_stock into new_stock
  from public.inventory_products
  where id = new.product_id
  for update;

  if new.movement_type = 'ingreso' then
    new_stock := new_stock + new.quantity;
  else
    new_stock := new_stock - new.quantity;
    if new_stock < 0 then
      raise exception 'Stock insuficiente: quedarian % unidades', new_stock;
    end if;
  end if;

  new.balance_after := new_stock;

  update public.inventory_products
  set current_stock = new_stock, updated_at = now()
  where id = new.product_id;

  return new;
end;
$$;
