-- SmartRayco — Fase 151 (PROPUESTA, NO aplicada todavia): protege ordenes
-- de Instalacion (Alta) ya cerradas (completed/cancelled) — hasta ahora
-- SUPERADMIN y ADMIN teninan exactamente los mismos permisos de escritura
-- en cualquier estado; de aqui en mas solo SUPERADMIN conserva edicion
-- excepcional sobre una orden cerrada. ADMIN pasa a ver la orden en solo
-- lectura real (reforzado en RLS, no solo en el frontend).
--
-- ALCANCE DE ESTA MIGRACION (deliberadamente acotado a Instalaciones):
--   1) installations: estado/prioridad/notas/tipo de servicio.
--   2) job_assignees: cuadrilla — SOLO para job_type='installation'. Se
--      deja job_type IN ('ticket','routine') sin tocar (ver nota abajo).
--   3) apply_inventory_unit_event() / apply_inventory_movement(): se
--      agrega 'cancelled' junto a 'completed' en los candados que YA
--      existian para equipos/materiales de una instalacion (Fase 46/69) —
--      hasta hoy esos candados solo miraban 'completed', 'cancelled'
--      quedaba sin proteccion. Se completa ademas una asimetria real en
--      apply_inventory_unit_event(): el candado de ticket_id (Fase 95b)
--      solo se evaluaba al ASIGNAR equipo nuevo a una averia resuelta/
--      cerrada, no al QUITAR/mover un equipo que ya estaba ligado a esa
--      averia — se agrega el mismo chequeo que ya existe para
--      installation_id, sin cambiar el grupo de roles que fase95b ya
--      establecio (SUPERADMIN/ADMIN/SOPORTE: es a proposito, SOPORTE
--      aprueba equipo/fotos de averias, Fase 95).
--
-- DELIBERADAMENTE FUERA DE ALCANCE (no se toca en esta migracion):
--   - tickets_update_staff / routines_update_staff (estado/prioridad/notas
--     de Averias y Rutinas): tienen su propia semantica de cierre y de
--     roles que NO es igual a instalaciones (confirmado antes de escribir
--     esto): tickets_update_staff ya incluye SOPORTE sin restriccion de
--     estado, y 'resolved' NO es un estado terminal real para un ticket —
--     el admin/soporte sigue necesitando editarlo para pasarlo a 'closed'.
--     Bloquear ADMIN/SOPORTE en 'resolved' romperia ese flujo. Requiere su
--     propio diseño (bloquear solo en 'closed', decidir si SOPORTE pierde
--     el acceso que Fase 95b le dio a proposito para aprobar equipo/fotos
--     de averias) — se deja para una fase separada, no se mezcla aqui.
--   - job_assignees para job_type IN ('ticket','routine'): mismo motivo,
--     depende de la decision de arriba.
--   - apply_inventory_movement() / apply_inventory_unit_event() para
--     tickets mas alla de lo ya descrito: el candado de ticket_id en
--     ambas funciones usa 'resolved'/'closed' (ya existente para equipos
--     via Fase 95b, nuevo aqui para materiales) — se mantiene consistente
--     con el mismo grupo de roles que Fase 95b ya definio para esto
--     (SUPERADMIN/ADMIN/SOPORTE), no se angosta a "solo SUPERADMIN" para
--     no romper el flujo de aprobacion de averias ya en uso.
--
-- Patron: la restriccion nueva para ADMIN va SOLO en USING (que fila es
-- visible/editable, evaluado contra la fila ANTES del update) y NUNCA en
-- WITH CHECK (que fila resulta valida DESPUES del update) — asi un admin
-- sigue pudiendo completar/cancelar una orden abierta con normalidad (la
-- fila ANTES de ese update no esta cerrada todavia), pero ya no puede
-- volver a tocarla una vez que SI quedo cerrada, ni siquiera reabrirla
-- (eso ahora es exclusivo de SUPERADMIN — es la "edicion excepcional" que
-- el Panel Web debe pedir confirmar explicitamente).
--
-- Idempotente: permite re-ejecutar el archivo completo sin error.

-- =========================================================
-- 1) installations: ADMIN bloqueado en completed/cancelled.
-- =========================================================
drop policy if exists "installations_update_staff" on public.installations;
create policy "installations_update_staff"
  on public.installations for update to authenticated
  using (
    public.current_user_role() = 'SUPERADMIN'
    or (public.current_user_role() = 'ADMIN' and status not in ('completed', 'cancelled'))
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid() and status <> 'completed')
  )
  with check (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and assigned_to = auth.uid())
  );

-- =========================================================
-- 2) job_assignees: ADMIN/SOPORTE bloqueados para cuadrilla de una
-- instalacion completed/cancelled. Tickets/rutinas sin cambios (ver nota
-- de alcance arriba).
-- =========================================================
drop policy if exists "job_assignees_write_dispatch" on public.job_assignees;
create policy "job_assignees_write_dispatch"
  on public.job_assignees for all to authenticated
  using (
    public.current_user_role() = 'SUPERADMIN'
    or (
      public.current_user_role() in ('ADMIN', 'SOPORTE')
      and not (
        job_type = 'installation'
        and exists (select 1 from public.installations i where i.id = job_id and i.status in ('completed', 'cancelled'))
      )
    )
  )
  with check (
    public.current_user_role() = 'SUPERADMIN'
    or (
      public.current_user_role() in ('ADMIN', 'SOPORTE')
      and not (
        job_type = 'installation'
        and exists (select 1 from public.installations i where i.id = job_id and i.status in ('completed', 'cancelled'))
      )
    )
  );

-- =========================================================
-- 3) apply_inventory_unit_event(): agrega 'cancelled' a installation_id
-- (ya cubria 'completed'), y agrega el chequeo de ticket_id que faltaba
-- para QUITAR/mover un equipo ya ligado (fase95b solo lo chequeaba al
-- asignar uno nuevo). Base: version vigente de Fase 95b, solo se tocan
-- las lineas señaladas.
-- =========================================================
create or replace function public.apply_inventory_unit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  current_status public.inventory_unit_status;
  current_installation_id uuid;
  current_ticket_id uuid;
  current_product_id uuid;
  installation_status public.installation_status;
  ticket_status public.ticket_status;
  unit_category_slug text;
  existing_onu_count integer;
  is_occupying_status boolean;
begin
  select status, installation_id, ticket_id, product_id
    into current_status, current_installation_id, current_ticket_id, current_product_id
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
    -- Fase 151: se agrega 'cancelled' (antes solo 'completed').
    if installation_status in ('completed', 'cancelled') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada o cancelada; solo un administrador puede corregir el equipo asignado';
    end if;
  end if;

  -- Fase 151: mismo candado que installation_id de arriba, pero para
  -- ticket_id — antes NO se chequeaba al quitar/mover un equipo que ya
  -- estaba ligado a una averia resuelta/cerrada (solo se chequeaba al
  -- ASIGNAR uno nuevo, mas abajo). Mismo grupo de roles que ya establecio
  -- Fase 95b para esto (SUPERADMIN/ADMIN/SOPORTE).
  if current_ticket_id is not null then
    select status into ticket_status from public.tickets where id = current_ticket_id;
    if ticket_status in ('resolved', 'closed') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN', 'SOPORTE') then
      raise exception 'La avería ya fue resuelta; solo administración/soporte puede corregir el equipo asignado';
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
      -- Fase 151: se agrega 'cancelled' (antes solo 'completed').
      if installation_status in ('completed', 'cancelled') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
        raise exception 'La instalación ya fue completada o cancelada; solo un administrador puede asignar equipo nuevo';
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
-- 4) apply_inventory_movement(): agrega 'cancelled' a installation_id (ya
-- cubria 'completed'), y agrega un candado nuevo de ticket_id que no
-- existia (los consumibles de una averia resuelta/cerrada no tenian
-- ninguna proteccion). Mismo grupo de roles que Fase 95b establecio para
-- el equivalente de equipos.
-- =========================================================
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_stock numeric(12, 2);
  installation_status public.installation_status;
  ticket_status public.ticket_status;
begin
  if new.installation_id is not null then
    select status into installation_status from public.installations where id = new.installation_id;
    -- Fase 151: se agrega 'cancelled' (antes solo 'completed').
    if installation_status in ('completed', 'cancelled') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada o cancelada; solo un administrador puede registrar materiales nuevos';
    end if;
  end if;

  -- Fase 151: candado nuevo — antes los consumibles de una averia no
  -- tenian ninguna proteccion por estado del ticket.
  if new.ticket_id is not null then
    select status into ticket_status from public.tickets where id = new.ticket_id;
    if ticket_status in ('resolved', 'closed') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN', 'SOPORTE') then
      raise exception 'La avería ya fue resuelta; solo administración/soporte puede registrar materiales nuevos';
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
