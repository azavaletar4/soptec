-- SmartRayco — Fase 95: equipa la atencion de averias (App de Campo) con las
-- mismas capacidades de equipos/fotos que una instalacion nueva, pero con un
-- paso de APROBACION del admin antes de tocar la ficha oficial del cliente
-- (a diferencia de una instalacion, que aplica todo de inmediato al cerrar).
--
-- 1) Fotos de fachada/modem capturadas en una averia: se guardan en
--    work_order_photos (ya existia, Fase 32) con un status nuevo —
--    'pending_approval' — en vez de aplicarse directo a client_photos. El
--    admin las aprueba desde TicketDetailView (copia el archivo a
--    client-photos y marca 'approved') o las rechaza ('rejected'). Esto es
--    una operacion de Storage (copiar entre buckets), asi que el "aplicar"
--    real vive en el frontend — un trigger de Postgres no puede tocar
--    Storage — el status en BD es el marcador de que falta revisar.
--
-- 2) Equipo entrante registrado en una averia: la unidad queda en un estado
--    nuevo en inventory_units — 'pending_approval' — en vez de 'assigned'
--    directo. El admin la aprueba (pasa a 'assigned', ahi si queda como el
--    equipo oficial del cliente) o la rechaza (vuelve a 'in_stock'). El
--    equipo SALIENTE (el que se retira/daño) SI se libera de inmediato
--    (returnUnit, sin aprobacion) — ya fisicamente salio de la casa, no
--    tiene sentido dejarlo "assigned" mientras se revisa.
--    A diferencia de las fotos, aqui SI hace falta un candado en BD: insertar
--    un evento 'assigned' aplica el cambio de inmediato (no hay paso
--    intermedio de Storage) — se bloquea que un TECNICO_RED lo haga directo
--    cuando el evento viene de un ticket (ticket_id not null), para que de
--    verdad tenga que pasar por 'pending_approval' primero.
--
-- 3) Lectura de potencia (dBm) y cambio de puerto NAP opcionales en el
--    cierre de una averia (si hizo falta recablear) — reusa
--    work_order_closures + fo_nap_puertos (ya existian).

-- =========================================================
-- 1) work_order_photos: status de aprobacion
-- =========================================================
alter table public.work_order_photos
  add column status text not null default 'approved' check (status in ('pending_approval', 'approved', 'rejected'));

create index idx_work_order_photos_status on public.work_order_photos (status) where status = 'pending_approval';

-- =========================================================
-- 2) inventory_units / inventory_unit_events: ticket_id + estado pending_approval
-- ('pending_approval' se agrego al enum en una migracion APARTE —
-- Fase 95a — porque Postgres no permite usar un valor de enum nuevo dentro
-- de la misma transaccion en que se agrego.)
-- =========================================================
alter table public.inventory_units
  add column ticket_id uuid references public.tickets (id) on delete set null;
create index idx_inventory_units_ticket on public.inventory_units (ticket_id) where ticket_id is not null;

alter table public.inventory_unit_events
  add column ticket_id uuid references public.tickets (id) on delete set null;
create index idx_inventory_unit_events_ticket on public.inventory_unit_events (ticket_id) where ticket_id is not null;

-- Reemplaza apply_inventory_unit_event completo (igual que Fase 71/72):
--   - agrega ticket_id al mismo tratamiento que installation_id/contract_id.
--   - OJO: la version de Fase 72 (la vigente hasta hoy) habia perdido la
--     linea que copiaba contract_id en el UPDATE final (se quedo solo en el
--     chequeo de limite, nunca se aplicaba a la fila) — se corrige aqui de
--     paso, mismo bug, misma funcion que ya tocaba esta fase.
--   - 'pending_approval' se trata igual que 'assigned' para poblar
--     client_id/contract_id/installation_id/ticket_id (el equipo SI esta en
--     la casa del cliente mientras se revisa) y cuenta para el limite de 1
--     ONU — pero un TECNICO_RED no puede insertar un evento 'assigned'
--     directo cuando el evento trae ticket_id (tiene que quedar
--     'pending_approval' y lo aprueba un admin).
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
    -- Camino normal: de bodega. Camino de aprobacion (Fase 95): de
    -- 'pending_approval' a 'assigned' — NO de 'pending_approval' a si mismo
    -- (eso no es una aprobacion real, es el insert original que ya lo dejo
    -- pending_approval la primera vez, que entra por la rama current_status
    -- = 'in_stock' de todos modos).
    if not (current_status = 'in_stock' or (current_status = 'pending_approval' and new.to_status = 'assigned')) then
      raise exception 'Solo se puede asignar un equipo que este en bodega, o aprobar uno pendiente (estado actual: %)', current_status;
    end if;

    if new.installation_id is not null and new.installation_id is distinct from current_installation_id then
      select status into installation_status from public.installations where id = new.installation_id;
      if installation_status = 'completed' and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
        raise exception 'La instalación ya fue completada; solo un administrador puede asignar equipo nuevo';
      end if;
    end if;

    -- Averia ya resuelta/cerrada: de aqui en mas es aprobacion/correccion de
    -- despacho — mismo grupo de roles que puede escribir la cuadrilla
    -- (job_assignees, Fase 94) y aprobar el censo fotografico.
    if new.ticket_id is not null then
      select status into ticket_status from public.tickets where id = new.ticket_id;
      if ticket_status in ('resolved', 'closed') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN', 'SOPORTE') then
        raise exception 'La avería ya fue resuelta; solo administración/soporte puede registrar o aprobar equipo';
      end if;
    end if;

    -- Un tecnico no puede dejar un equipo "assigned" (oficial) directo desde
    -- una averia — tiene que quedar 'pending_approval' y lo aprueba un admin.
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
-- 3) work_order_closures: lectura de potencia opcional (el cambio de puerto
-- NAP reusa fo_nap_puertos/assignContractToNap tal cual, sin columna nueva).
-- =========================================================
alter table public.work_order_closures
  add column potencia_dbm numeric;
