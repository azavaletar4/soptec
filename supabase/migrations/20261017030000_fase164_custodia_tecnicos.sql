-- Fase 164: propuesta LOCAL. No aplicar sin autorizacion explicita.
-- Requiere Fase 164a (ALTER TYPE) ya comiteada por separado.
--
-- PROBLEMA REAL (piloto, octubre 2026): SmartRayco mostraba 9 TV Box
-- "disponibles en almacen" cuando fisicamente solo habia 1 — porque nunca
-- existio un estado intermedio "entregado a un tecnico, aun no instalado".
-- Un equipo serializado solo podia estar en bodega (in_stock) o ya
-- vinculado a un cliente/orden (assigned/pending_approval) — igual que un
-- consumible solo se descontaba de golpe contra una orden especifica
-- (inventory_movements.installation_id/ticket_id/routine_id), nunca con
-- un paso intermedio de "en la mochila/camioneta del tecnico".
--
-- DISEÑO (gradual, aditivo, no cambia ningun flujo existente de
-- consumo/instalacion salvo UN ensanche puntual en cada uno — ver abajo):
--
-- 1. Equipos serializados: reusa inventory_units/inventory_unit_events
--    (mismo Kardex insert-only de Fase 11c), agregando custody_technician_id
--    (cache en la unidad, mismo patron que pending_pickup_by de Fase 51b) y
--    delegando los 3 nuevos estados a una funcion dedicada
--    (apply_technician_custody_event), exactamente igual que Fase 162 ya
--    delego el camino de rutinas a apply_routine_inventory_event sin tocar
--    el resto de apply_inventory_unit_event.
-- 2. Consumibles: NO hay fila por unidad, asi que la custodia es una tabla
--    de saldo aparte (technician_material_custody) + su propio Kardex
--    insert-only (technician_material_custody_events) — misma arquitectura
--    que inventory_products.current_stock/inventory_movements, pero sin
--    tocarlos: entregar material a un tecnico NUNCA descuenta
--    current_stock ni crea un movimiento de egreso — eso solo pasa cuando
--    el tecnico de verdad lo consume en una orden real (campo_inventory_operation/
--    routine_inventory_operation, SIN CAMBIOS en esta fase). Entrega ≠ consumo.
-- 3. Un tecnico puede INSTALAR un equipo que tiene en custodia exactamente
--    igual que uno que viene directo de bodega — se ensancha la condicion
--    de origen valido en campo_inventory_operation (assign/stage) y en
--    apply_routine_inventory_event (install), un solo OR agregado a cada
--    uno, con guardas de deriva (igual patron que Fase 162) para detener
--    la migracion si esas funciones ya cambiaron en Cloud desde que se
--    preparo este archivo.
-- 4. Reconciliacion (Fase C del pedido): inventory_custody_summary() de
--    solo lectura para ADMIN/SUPERADMIN. Muestra los conteos REALES del
--    sistema (almacen / custodia por tecnico / instalado) sin inventar
--    ningun ajuste — si el fisico no coincide, lo resuelve un ajuste
--    administrativo aparte, no esta migracion.
begin;

-- Falla antes de tocar el esquema si las 3 funciones compartidas ya
-- cambiaron en Cloud desde que se preparo este archivo.
do $$
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_inventory_unit_event()')
   and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='b7769fa47a1f4afd77b62ef8f4378341') then
  raise exception 'apply_inventory_unit_event difiere de la version revisada; detener y comparar antes de migrar';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.campo_inventory_operation(uuid,text,uuid,text,jsonb)')
   and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='d1198b2298967fb6c23c1d7a35108ae5') then
  raise exception 'campo_inventory_operation difiere de la version revisada; detener y comparar antes de migrar';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_routine_inventory_event(public.inventory_unit_events)')
   and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='0d446d088bca97fcf4fd18a4c8da6d9a') then
  raise exception 'apply_routine_inventory_event difiere de la version revisada; detener y comparar antes de migrar';
 end if;
end $$;

-- ===================== Equipos serializados =====================

alter table public.inventory_units
  add column custody_technician_id uuid references public.profiles(id);
create index idx_inventory_units_custody on public.inventory_units(custody_technician_id)
  where custody_technician_id is not null;

-- Rama dedicada de custodia, mismo patron que apply_routine_inventory_event
-- (Fase 162): entrega (-> with_technician), solicitud de devolucion
-- (-> pending_return) y recepcion administrativa confirmada (pending_return
-- -> in_stock/damaged/in_repair). Instalar un equipo en custodia SI pasa
-- por la rama original de apply_inventory_unit_event (ensanchada abajo),
-- no por aqui.
create function public.apply_technician_custody_event(e public.inventory_unit_events)
returns public.inventory_unit_events language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  u public.inventory_units;
  actor uuid := auth.uid();
  staff public.user_role := public.current_user_role();
begin
  select * into strict u from public.inventory_units where id = e.unit_id for update;
  e.from_status := u.status;
  e.client_id := null; e.contract_id := null; e.installation_id := null; e.ticket_id := null;

  if u.status = 'retired' then
    raise exception 'El equipo esta dado de baja y no admite mas movimientos';
  end if;

  if e.to_status = 'with_technician' then
    if staff not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'Solo administracion puede entregar un equipo a un tecnico';
    end if;
    if u.status <> 'in_stock' then
      raise exception 'Solo se puede entregar un equipo que este en bodega (estado actual: %)', u.status;
    end if;
    if e.assigned_to is null then
      raise exception 'Debe indicar el tecnico que recibe el equipo';
    end if;
    if not exists(select 1 from public.profiles where id = e.assigned_to and active and role = 'TECNICO_RED') then
      raise exception 'El destinatario debe ser un tecnico de red activo';
    end if;
    update public.inventory_units
      set status = 'with_technician', custody_technician_id = e.assigned_to, updated_at = now()
      where id = u.id;

  elsif e.to_status = 'pending_return' then
    if u.status <> 'with_technician' then
      raise exception 'Solo se puede solicitar devolucion de un equipo en custodia de un tecnico (estado actual: %)', u.status;
    end if;
    if staff = 'TECNICO_RED' and u.custody_technician_id is distinct from actor then
      raise exception 'Este equipo no esta en tu custodia';
    elsif staff not in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED') then
      raise exception 'Rol no autorizado para solicitar la devolucion';
    end if;
    e.assigned_to := u.custody_technician_id;
    update public.inventory_units set status = 'pending_return', updated_at = now() where id = u.id;

  elsif e.to_status in ('in_stock', 'damaged', 'in_repair') and u.status in ('with_technician', 'pending_return') then
    if staff not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'Solo administracion puede confirmar la recepcion del equipo';
    end if;
    e.assigned_to := u.custody_technician_id;
    update public.inventory_units
      set status = e.to_status, custody_technician_id = null, updated_at = now()
      where id = u.id;

  else
    raise exception 'Transicion de custodia no permitida (% -> %)', u.status, e.to_status;
  end if;

  return e;
end $$;
revoke all on function public.apply_technician_custody_event(public.inventory_unit_events) from public, anon, authenticated;

-- Ensancha apply_inventory_unit_event: delega los 3 casos de arriba ANTES
-- de la rama original, igual que ya hace con new.routine_id — el resto de
-- la funcion (abajo) es copia byte a byte de la version vigente en Cloud,
-- con un solo OR agregado al tramo que decide si un equipo puede entrar a
-- 'assigned'/'pending_approval' (instalarlo desde custodia, ademas de
-- desde bodega) y limpiando custody_technician_id al ocupar la unidad.
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
  -- Fase 162: only authorized routine events enter the isolated branch.
  if new.routine_id is not null then
    return public.apply_routine_inventory_event(new);
  end if;

  -- Fase 164: entrega/solicitud de devolucion/recepcion de custodia de
  -- tecnico entran por su propia rama, igual criterio que la de arriba.
  select status into current_status from public.inventory_units where id = new.unit_id;
  if new.to_status in ('with_technician', 'pending_return') or current_status = 'pending_return' then
    return public.apply_technician_custody_event(new);
  end if;

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
    if installation_status in ('completed', 'cancelled') and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
      raise exception 'La instalación ya fue completada o cancelada; solo un administrador puede corregir el equipo asignado';
    end if;
  end if;

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
    -- Fase 164: ademas de 'in_stock' (bodega) y 'pending_approval' (aprobar
    -- lo pendiente), se admite 'with_technician' — instalar un equipo que
    -- ya estaba en custodia del propio tecnico (verificado en el llamador:
    -- campo_inventory_operation/apply_routine_inventory_event).
    if not (current_status = 'in_stock' or (current_status = 'pending_approval' and new.to_status = 'assigned')
      or current_status = 'with_technician') then
      raise exception 'Solo se puede asignar un equipo que este en bodega, en custodia de un tecnico, o aprobar uno pendiente (estado actual: %)', current_status;
    end if;

    if new.installation_id is not null and new.installation_id is distinct from current_installation_id then
      select status into installation_status from public.installations where id = new.installation_id;
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
    -- Fase 164: una unidad que se instala deja de estar en custodia de un
    -- tecnico (ya esta con el cliente, no en su mochila/camioneta).
    custody_technician_id = case when is_occupying_status then null else custody_technician_id end,
    assigned_at     = case when is_occupying_status then now() else assigned_at end,
    updated_at      = now()
  where id = new.unit_id;

  return new;
end;
$$;

-- Ensancha campo_inventory_operation (Etapa 3): ademas de 'in_stock', un
-- equipo en custodia del propio tecnico tambien es origen valido para
-- assign/stage. Copia byte a byte de la version vigente salvo esa unica
-- condicion (resaltada abajo).
create or replace function public.campo_inventory_operation(
 p_operation_id uuid, p_job_type text, p_job_id uuid, p_action text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
 actor uuid := auth.uid(); actor_role text; job_status text; client uuid; contract uuid;
 receipt public.campo_inventory_operations%rowtype;
 original public.inventory_movements%rowtype;
 unit_row public.inventory_units%rowtype;
 product public.inventory_products%rowtype;
 item jsonb; items jsonb; result_ids jsonb := '[]'; new_id uuid;
 target_id uuid; quantity numeric; destination public.inventory_unit_status;
 reason text; key text; allowed_keys text[];
begin
 if actor is null or p_operation_id is null or p_job_id is null
 or p_job_type is null or p_job_type not in ('installation','ticket')
 or p_action is null or p_action not in ('consume','kit','correct','reverse','assign','unassign','stage','return','unlink')
 or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
  raise exception 'Solicitud de inventario inválida' using errcode='22023';
 end if;
 if length(p_payload::text)>12000 then raise exception 'Solicitud demasiado grande' using errcode='22023'; end if;
 allowed_keys:=case p_action
  when 'consume' then array['productId','quantity','reason']
  when 'kit' then array['items','reason']
  when 'correct' then array['movementId','quantity','reason']
  when 'reverse' then array['movementId','reason']
  when 'return' then array['unitId','condition','reason']
  else array['unitId','reason'] end;
 for key in select jsonb_object_keys(p_payload) loop
  if not key=any(allowed_keys) then
   raise exception 'Campo no permitido' using errcode='22023';
  end if;
 end loop;
 reason := p_payload->>'reason';
 if length(coalesce(reason,''))>500 then raise exception 'Motivo demasiado largo' using errcode='22023'; end if;
 select role::text into actor_role from public.profiles where id=actor and active for share;
 if actor_role is null or actor_role not in ('ADMIN','SUPERADMIN','TECNICO_RED') then
  raise exception 'Acceso denegado' using errcode='42501';
 end if;
 if p_job_type='installation' then
  select status::text,client_id,contract_id into job_status,client,contract
   from public.installations where id=p_job_id for update;
 else
  select status::text,client_id,contract_id into job_status,client,contract
   from public.tickets where id=p_job_id for update;
 end if;
 if not found then raise exception 'Orden no autorizada' using errcode='42501'; end if;
 if actor_role='TECNICO_RED' then
  perform 1 from public.job_assignees where job_type=p_job_type and job_id=p_job_id
   and technician_id=actor and role in ('leader','support') for share nowait;
  if not found then raise exception 'Asignación no vigente' using errcode='42501'; end if;
 end if;
 if contract is not null then
  perform 1 from public.service_contracts where id=contract and client_id=client for update;
  if not found then raise exception 'Contrato no corresponde a la orden' using errcode='42501'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into receipt from public.campo_inventory_operations where id=p_operation_id;
 if found then
  if receipt.actor_id<>actor or receipt.job_type<>p_job_type or receipt.job_id<>p_job_id
    or receipt.action<>p_action or receipt.payload<>p_payload
    or receipt.client_id is distinct from client or receipt.contract_id is distinct from contract then
   raise exception 'Identificador de operación ya utilizado' using errcode='22023';
  end if;
  return receipt.result;
 end if;
 if (p_job_type='installation' and job_status not in ('pending','scheduled','in_progress'))
 or (p_job_type='ticket' and job_status not in ('open','in_progress','rescheduled')) then
  raise exception 'La orden no admite nuevas operaciones' using errcode='42501';
 end if;
 insert into public.campo_inventory_operations(id,actor_id,job_type,job_id,client_id,contract_id,action,payload)
 values(p_operation_id,actor,p_job_type,p_job_id,client,contract,p_action,p_payload);

 if p_action in ('consume','kit','correct','reverse') then
  if p_action in ('correct','reverse') then
   select * into original from public.inventory_movements where id=(p_payload->>'movementId')::uuid for update;
   if not found or original.movement_type::text<>'egreso' or original.reverses_movement_id is not null
    or (p_job_type='installation' and (original.installation_id is distinct from p_job_id or original.ticket_id is not null))
    or (p_job_type='ticket' and (original.ticket_id is distinct from p_job_id or original.installation_id is not null)) then
    raise exception 'Movimiento no corresponde a la orden' using errcode='42501';
   end if;
   if exists(select 1 from public.inventory_movements where reverses_movement_id=original.id) then
    raise exception 'Movimiento ya revertido' using errcode='22023';
   end if;
   target_id:=original.product_id;
   items:=case when p_action='correct' then jsonb_build_array(jsonb_build_object('productId',target_id,'quantity',p_payload->'quantity')) else '[]'::jsonb end;
  elsif p_action='kit' then
   if p_job_type<>'installation' then raise exception 'Kit solo para Altas' using errcode='22023'; end if;
   items:=p_payload->'items';
   if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 25 then
    raise exception 'Kit inválido' using errcode='22023';
   end if;
   for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item)<>'object' or item-ARRAY['productId','quantity']<>'{}'::jsonb then
     raise exception 'Material de kit inválido' using errcode='22023';
    end if;
   end loop;
  else items:=jsonb_build_array(p_payload); end if;
  for target_id in
   select distinct value from (
    select (x->>'productId')::uuid value from jsonb_array_elements(items) x
    union select original.product_id where p_action in ('correct','reverse')
   ) ids order by value
  loop
   select * into product from public.inventory_products where id=target_id for update;
   if not found or not product.is_active or product.is_serialized then
    raise exception 'Producto no admite consumo de material' using errcode='22023';
   end if;
  end loop;
  if p_action in ('correct','reverse') then
   insert into public.inventory_movements(product_id,movement_type,quantity,reason,installation_id,ticket_id,reverses_movement_id,created_by)
   values(original.product_id,'ingreso',original.quantity,coalesce(reason,'Reversión contextual de Campo'),
    original.installation_id,original.ticket_id,original.id,actor) returning id into new_id;
   result_ids:=result_ids||jsonb_build_array(new_id);
  end if;
  for item in select value from jsonb_array_elements(items) loop
   quantity:=(item->>'quantity')::numeric;
   if quantity is null or quantity<=0 or quantity>1000000 or quantity<>round(quantity,2) then
    raise exception 'Cantidad inválida' using errcode='22023';
   end if;
   insert into public.inventory_movements(product_id,movement_type,quantity,reason,installation_id,ticket_id,created_by)
   values((item->>'productId')::uuid,'egreso',quantity,coalesce(reason,'Consumo contextual de Campo'),
    case when p_job_type='installation' then p_job_id end,case when p_job_type='ticket' then p_job_id end,actor)
   returning id into new_id;
   result_ids:=result_ids||jsonb_build_array(new_id);
  end loop;
 else
  if client is null or contract is null then
   raise exception 'Equipo requiere servicio verificable; revisión administrativa' using errcode='42501';
  end if;
  if (p_action in ('assign','unassign') and p_job_type<>'installation')
   or (p_action in ('stage','return','unlink') and p_job_type<>'ticket') then
   raise exception 'Acción incompatible con orden' using errcode='22023';
  end if;
  select * into unit_row from public.inventory_units where id=(p_payload->>'unitId')::uuid for update;
  if not found then raise exception 'Equipo no autorizado' using errcode='42501'; end if;
  select * into product from public.inventory_products where id=unit_row.product_id for update;
  if not product.is_active or not product.is_serialized then raise exception 'Equipo no operativo' using errcode='22023'; end if;
  if p_action in ('assign','stage') then
   -- Fase 164: ademas de in_stock sin vinculo previo, se admite un equipo
   -- en custodia del PROPIO actor (entregado antes por administracion).
   if not (
     (unit_row.status::text='in_stock' and unit_row.client_id is null and unit_row.contract_id is null
      and unit_row.installation_id is null and unit_row.ticket_id is null)
     or (unit_row.status::text='with_technician' and unit_row.custody_technician_id=actor)
   ) then
    raise exception 'Equipo no disponible' using errcode='42501';
   end if;
   destination:=case when p_action='assign' then 'assigned'::public.inventory_unit_status else 'pending_approval'::public.inventory_unit_status end;
  else
   if unit_row.client_id is distinct from client or unit_row.contract_id is distinct from contract
    or (p_action='unassign' and (unit_row.installation_id is distinct from p_job_id or unit_row.status::text<>'assigned'))
    or (p_action='unlink' and (unit_row.ticket_id is distinct from p_job_id or unit_row.status::text<>'pending_approval'))
    or (p_action='return' and unit_row.status::text<>'assigned') then
    raise exception 'Equipo no corresponde al servicio de la orden' using errcode='42501';
   end if;
   destination:=case when p_action='return' then (p_payload->>'condition')::public.inventory_unit_status else 'in_stock'::public.inventory_unit_status end;
   if destination is null or destination::text not in ('in_stock','damaged','in_repair') then raise exception 'Condición inválida' using errcode='22023'; end if;
  end if;
  insert into public.inventory_unit_events(unit_id,to_status,client_id,contract_id,installation_id,ticket_id,reason,created_by)
  values(unit_row.id,destination,client,contract,
   case when p_job_type='installation' then p_job_id end,case when p_job_type='ticket' then p_job_id end,
   coalesce(reason,'Operación contextual de Campo'),actor) returning id into new_id;
  result_ids:=jsonb_build_array(new_id);
 end if;
 receipt.result:=jsonb_build_object('operationId',p_operation_id,'jobType',p_job_type,'jobId',p_job_id,
  'action',p_action,'ids',result_ids,'at',now());
 update public.campo_inventory_operations set result=receipt.result where id=p_operation_id;
 return receipt.result;
end;
$$;
revoke all on function public.campo_inventory_operation(uuid,text,uuid,text,jsonb) from public, anon;
grant execute on function public.campo_inventory_operation(uuid,text,uuid,text,jsonb) to authenticated;

-- Ensancha apply_routine_inventory_event (Fase 162): mismo criterio, un
-- equipo en custodia del propio tecnico tambien es origen valido para
-- 'install'. Copia byte a byte de la version vigente salvo esa condicion.
create or replace function public.apply_routine_inventory_event(e public.inventory_unit_events)
returns public.inventory_unit_events language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare op public.routine_inventory_operations; u public.inventory_units;
 r public.routines; destination uuid; expected_client uuid;
begin
 op:=public.check_routine_inventory_receipt(e.operation_id,e.routine_id);
 select * into strict r from public.routines where id=e.routine_id;
 select * into strict u from public.inventory_units where id=e.unit_id for update;
 if op.payload->>'unit_id' is distinct from u.id::text then raise exception 'Equipo no corresponde a operacion'; end if;
 e.from_status:=u.status;
 e.installation_id:=u.installation_id; e.ticket_id:=u.ticket_id;
 if op.action in ('install','withdraw') then
   if r.client_id is null then raise exception 'Vincule el cliente a la rutina'; end if;
   destination:=coalesce(r.contract_id,nullif(op.payload->>'contract_id','')::uuid);
   if r.contract_id is not null and nullif(op.payload->>'contract_id','')::uuid is not null
      and r.contract_id is distinct from (op.payload->>'contract_id')::uuid then raise exception 'Contrato distinto al de la rutina'; end if;
   if destination is not null then
     select client_id into expected_client from public.service_contracts where id=destination for update;
     if expected_client is distinct from r.client_id then raise exception 'Contrato ajeno al cliente de la rutina'; end if;
   elsif exists(select 1 from public.service_contracts where client_id=r.client_id) then
     raise exception 'Seleccione el contrato del cliente';
   end if;
   e.client_id:=r.client_id; e.contract_id:=destination;
 end if;
 if op.action='install' then
   -- Fase 164: ademas de 'in_stock', se admite un equipo en custodia del
   -- PROPIO tecnico que ejecuta la operacion (verificado por routine_inventory_operation,
   -- que ya exige que el actor sea tecnico de la cuadrilla de la rutina).
   if not (u.status='in_stock' or (u.status='with_technician' and u.custody_technician_id=auth.uid())) or u.routine_id is not null then
     raise exception 'Equipo no disponible en bodega'; end if;
   if not exists(select 1 from public.inventory_products where id=u.product_id and is_active and is_serialized)
      or coalesce(nullif(btrim(u.serial_number),''),nullif(btrim(u.mac_address),'')) is null then raise exception 'Equipo sin identidad serializada valida'; end if;
   if exists(select 1 from public.inventory_products p join public.inventory_categories c on c.id=p.category_id where p.id=u.product_id and c.slug='onu')
   and exists(select 1 from public.inventory_units x join public.inventory_products p on p.id=x.product_id join public.inventory_categories c on c.id=p.category_id
      where x.id<>u.id and x.contract_id=destination and x.status in ('assigned','pending_approval') and c.slug='onu') then raise exception 'Solo se puede asignar 1 ONT por contrato'; end if;
   e.to_status:='pending_approval';
   update public.inventory_units set status=e.to_status,client_id=e.client_id,contract_id=e.contract_id,
     routine_id=e.routine_id,pending_pickup_by=null,custody_technician_id=null,assigned_at=now(),updated_at=now() where id=u.id;
 elsif op.action='withdraw' then
   if u.status<>'assigned' or u.client_id is distinct from r.client_id
      or u.contract_id is distinct from destination then raise exception 'Equipo no asignado a este cliente/contrato o estado incompatible'; end if;
   e.to_status:='en_recupero'; e.assigned_to:=auth.uid();
   update public.inventory_units set status=e.to_status,routine_id=e.routine_id,
     pending_pickup_by=auth.uid(),updated_at=now() where id=u.id;
 elsif op.action in ('approve','reject','unlink','receive') then
   if u.routine_id is distinct from e.routine_id then raise exception 'Equipo no pertenece a esta rutina'; end if;
   e.client_id:=u.client_id; e.contract_id:=u.contract_id;
   if op.action='receive' then
     if u.status<>'en_recupero' or op.payload->>'condition' not in ('in_stock','damaged','in_repair')
       or op.payload->>'condition' is null then raise exception 'Recepcion o condicion incompatible'; end if;
     e.to_status:=(op.payload->>'condition')::public.inventory_unit_status;
     update public.inventory_units set status=e.to_status,client_id=null,contract_id=null,routine_id=null,
       installation_id=null,ticket_id=null,
       pending_pickup_by=null,updated_at=now() where id=u.id;
   else
     if u.status<>'pending_approval' then raise exception 'Equipo no pendiente de aprobacion'; end if;
     e.to_status:=case when op.action='approve' then 'assigned'::public.inventory_unit_status else 'en_recupero'::public.inventory_unit_status end;
     update public.inventory_units set status=e.to_status,pending_pickup_by=case when op.action='approve' then null else auth.uid() end,
       updated_at=now() where id=u.id;
   end if;
 else raise exception 'Accion de equipo desconocida';
 end if;
 return e;
end $$;
revoke all on function public.apply_routine_inventory_event(public.inventory_unit_events) from public,anon,authenticated,service_role;

-- RPCs de entrega/devolucion de equipos serializados — simples envoltorios
-- que insertan en inventory_unit_events; toda la logica/validacion real
-- vive en apply_technician_custody_event (trigger), para no duplicarla.
create function public.deliver_unit_to_technician(p_unit_id uuid, p_technician_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo administracion puede entregar equipo a un tecnico';
  end if;
  insert into public.inventory_unit_events(unit_id, to_status, assigned_to, reason)
  values (p_unit_id, 'with_technician', p_technician_id, coalesce(nullif(btrim(p_reason), ''), 'Entrega a tecnico'));
end $$;
revoke all on function public.deliver_unit_to_technician(uuid, uuid, text) from public, anon;
grant execute on function public.deliver_unit_to_technician(uuid, uuid, text) to authenticated;

create function public.request_unit_return(p_unit_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Solo el tecnico que tiene el equipo puede solicitar su devolucion';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Escribe el motivo de la devolucion';
  end if;
  insert into public.inventory_unit_events(unit_id, to_status, reason)
  values (p_unit_id, 'pending_return', btrim(p_reason));
end $$;
revoke all on function public.request_unit_return(uuid, text) from public, anon;
grant execute on function public.request_unit_return(uuid, text) to authenticated;

create function public.receive_unit_return(p_unit_id uuid, p_condition text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo administracion puede confirmar la recepcion del equipo';
  end if;
  if p_condition not in ('in_stock', 'damaged', 'in_repair') then
    raise exception 'Condicion de recepcion invalida';
  end if;
  insert into public.inventory_unit_events(unit_id, to_status, reason)
  values (p_unit_id, p_condition::public.inventory_unit_status, coalesce(nullif(btrim(p_reason), ''), 'Recepcion administrativa de devolucion'));
end $$;
revoke all on function public.receive_unit_return(uuid, text, text) from public, anon;
grant execute on function public.receive_unit_return(uuid, text, text) to authenticated;

-- ===================== Consumibles =====================
-- Saldo por tecnico (mismo rol que inventory_products.current_stock, pero
-- a nivel tecnico) + su propio Kardex insert-only. NUNCA tocan
-- inventory_movements/current_stock: entregar material a un tecnico no es
-- consumo. Solo el consumo real (campo_inventory_operation/
-- routine_inventory_operation, sin cambios) descuenta el almacen central.

create table public.technician_material_custody (
  technician_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid not null references public.inventory_products(id) on delete restrict,
  quantity numeric not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (technician_id, product_id)
);
alter table public.technician_material_custody enable row level security;
revoke all on public.technician_material_custody from public, anon, authenticated;
grant select on public.technician_material_custody to authenticated;
create policy technician_material_custody_select on public.technician_material_custody
  for select to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and technician_id = auth.uid())
  );

create table public.technician_material_custody_events (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid not null references public.inventory_products(id) on delete restrict,
  event_type text not null check (event_type in ('delivery', 'return')),
  quantity numeric not null check (quantity > 0),
  reason text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default clock_timestamp()
);
create index idx_technician_material_custody_events_tech
  on public.technician_material_custody_events(technician_id, product_id, created_at desc);
alter table public.technician_material_custody_events enable row level security;
revoke all on public.technician_material_custody_events from public, anon, authenticated;
grant select on public.technician_material_custody_events to authenticated;
create policy technician_material_custody_events_select on public.technician_material_custody_events
  for select to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and technician_id = auth.uid())
  );

-- Kardex insert-only -> aplica el saldo de forma atomica (lock de fila),
-- mismo patron que apply_inventory_unit_event.
create function public.apply_technician_material_custody_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_qty numeric; delta numeric;
begin
  delta := case when new.event_type = 'delivery' then new.quantity else -new.quantity end;
  select quantity into current_qty from public.technician_material_custody
    where technician_id = new.technician_id and product_id = new.product_id for update;
  current_qty := coalesce(current_qty, 0);
  if current_qty + delta < 0 then
    raise exception 'El tecnico no tiene suficiente material en custodia para esta devolucion (tiene %, se intenta devolver %)', current_qty, new.quantity;
  end if;
  insert into public.technician_material_custody(technician_id, product_id, quantity, updated_at)
  values (new.technician_id, new.product_id, current_qty + delta, now())
  on conflict (technician_id, product_id) do update
    set quantity = excluded.quantity, updated_at = excluded.updated_at;
  return new;
end $$;
create trigger trg_technician_material_custody_apply
  before insert on public.technician_material_custody_events
  for each row execute function public.apply_technician_material_custody_event();

-- Solicitudes de devolucion de consumibles, sujetas a recepcion
-- administrativa (no hay fila-por-unidad como en serializados, asi que la
-- solicitud vive aparte y solo se convierte en evento de Kardex al
-- confirmarse).
create table public.technician_material_return_requests (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid not null references public.inventory_products(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  reason text not null check (btrim(reason) <> ''),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  requested_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index idx_technician_material_return_requests_pending
  on public.technician_material_return_requests(status, requested_at) where status = 'pending';
alter table public.technician_material_return_requests enable row level security;
revoke all on public.technician_material_return_requests from public, anon, authenticated;
grant select on public.technician_material_return_requests to authenticated;
create policy technician_material_return_requests_select on public.technician_material_return_requests
  for select to authenticated
  using (
    public.current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (public.current_user_role() = 'TECNICO_RED' and technician_id = auth.uid())
  );

create function public.deliver_material_to_technician(p_technician_id uuid, p_product_id uuid, p_quantity numeric, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p public.inventory_products;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo administracion puede entregar material a un tecnico';
  end if;
  if not exists(select 1 from public.profiles where id = p_technician_id and active and role = 'TECNICO_RED') then
    raise exception 'El destinatario debe ser un tecnico de red activo';
  end if;
  select * into p from public.inventory_products where id = p_product_id for share;
  if not found or not p.is_active or p.is_serialized then
    raise exception 'Producto consumible activo requerido';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity, 2) then
    raise exception 'Cantidad positiva con hasta dos decimales requerida';
  end if;
  insert into public.technician_material_custody_events(technician_id, product_id, event_type, quantity, reason)
  values (p_technician_id, p_product_id, 'delivery', p_quantity, coalesce(nullif(btrim(p_reason), ''), 'Entrega a tecnico'));
end $$;
revoke all on function public.deliver_material_to_technician(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.deliver_material_to_technician(uuid, uuid, numeric, text) to authenticated;

create function public.request_material_return(p_product_id uuid, p_quantity numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare current_qty numeric; req_id uuid;
begin
  if public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Solo el tecnico puede solicitar la devolucion de su propio material';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Escribe el motivo de la devolucion';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Cantidad positiva requerida';
  end if;
  select quantity into current_qty from public.technician_material_custody
    where technician_id = auth.uid() and product_id = p_product_id;
  if coalesce(current_qty, 0) < p_quantity then
    raise exception 'No tienes esa cantidad en custodia (tienes %)', coalesce(current_qty, 0);
  end if;
  insert into public.technician_material_return_requests(technician_id, product_id, quantity, reason)
  values (auth.uid(), p_product_id, p_quantity, btrim(p_reason))
  returning id into req_id;
  return req_id;
end $$;
revoke all on function public.request_material_return(uuid, numeric, text) from public, anon;
grant execute on function public.request_material_return(uuid, numeric, text) to authenticated;

create function public.confirm_material_return(p_request_id uuid, p_approved boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare req public.technician_material_return_requests;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo administracion puede confirmar una devolucion';
  end if;
  select * into req from public.technician_material_return_requests where id = p_request_id for update;
  if not found or req.status <> 'pending' then
    raise exception 'Solicitud no encontrada o ya resuelta';
  end if;
  if p_approved then
    insert into public.technician_material_custody_events(technician_id, product_id, event_type, quantity, reason)
    values (req.technician_id, req.product_id, 'return', req.quantity, coalesce(nullif(btrim(p_note), ''), 'Recepcion administrativa de devolucion'));
    update public.technician_material_return_requests
      set status = 'confirmed', resolved_at = now(), resolved_by = auth.uid()
      where id = p_request_id;
  else
    update public.technician_material_return_requests
      set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
      where id = p_request_id;
  end if;
end $$;
revoke all on function public.confirm_material_return(uuid, boolean, text) from public, anon;
grant execute on function public.confirm_material_return(uuid, boolean, text) to authenticated;

-- ===================== Fase C: conciliacion (solo lectura) =====================
-- Muestra los conteos REALES del sistema; no inventa ni corrige nada. La
-- diferencia fisica (ej. "9 TV Box en el sistema, 1 fisico") se resuelve
-- con un ajuste administrativo aparte, no aqui.
create function public.inventory_custody_summary()
returns table(
  product_id uuid, product_name text, is_serialized boolean, unit text,
  warehouse_qty numeric, custody_qty numeric, installed_qty numeric,
  other_qty numeric, custody_by_technician jsonb
) language plpgsql stable security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Resumen de custodia exclusivo de ADMIN y SUPERADMIN';
  end if;
  return query
  select p.id, p.name, p.is_serialized, p.unit,
    case when p.is_serialized then
      coalesce((select count(*) from public.inventory_units u where u.product_id = p.id and u.status = 'in_stock'), 0)::numeric
    else p.current_stock - coalesce((select sum(c.quantity) from public.technician_material_custody c where c.product_id = p.id), 0)
    end as warehouse_qty,
    case when p.is_serialized then
      coalesce((select count(*) from public.inventory_units u where u.product_id = p.id and u.status in ('with_technician', 'pending_return')), 0)::numeric
    else coalesce((select sum(c.quantity) from public.technician_material_custody c where c.product_id = p.id), 0)
    end as custody_qty,
    case when p.is_serialized then
      coalesce((select count(*) from public.inventory_units u where u.product_id = p.id and u.status in ('assigned', 'pending_approval')), 0)::numeric
    else null
    end as installed_qty,
    case when p.is_serialized then
      coalesce((select count(*) from public.inventory_units u where u.product_id = p.id and u.status in ('damaged', 'in_repair', 'retired', 'en_recupero')), 0)::numeric
    else null
    end as other_qty,
    case when p.is_serialized then
      coalesce((select jsonb_object_agg(t.full_name, t.cnt) from (
        select coalesce(pr.full_name, pr.email, u.custody_technician_id::text) as full_name, count(*) as cnt
        from public.inventory_units u left join public.profiles pr on pr.id = u.custody_technician_id
        where u.product_id = p.id and u.status in ('with_technician', 'pending_return')
        group by coalesce(pr.full_name, pr.email, u.custody_technician_id::text)
      ) t), '{}'::jsonb)
    else
      coalesce((select jsonb_object_agg(t.full_name, t.qty) from (
        select coalesce(pr.full_name, pr.email, c.technician_id::text) as full_name, c.quantity as qty
        from public.technician_material_custody c left join public.profiles pr on pr.id = c.technician_id
        where c.product_id = p.id and c.quantity > 0
      ) t), '{}'::jsonb)
    end as custody_by_technician
  from public.inventory_products p
  where p.is_active
  order by p.name;
end $$;
revoke all on function public.inventory_custody_summary() from public, anon, service_role;
grant execute on function public.inventory_custody_summary() to authenticated;

-- Tecnico: solo lo suyo (equipos en custodia + saldo de materiales).
create function public.my_inventory_custody()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); units jsonb; materials jsonb; requests jsonb;
begin
  if uid is null or public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Exclusivo del propio tecnico';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'serial_number', u.serial_number, 'mac_address', u.mac_address,
    'status', u.status, 'product', jsonb_build_object('id', p.id, 'name', p.name)
  ) order by u.updated_at desc), '[]') into units
  from public.inventory_units u join public.inventory_products p on p.id = u.product_id
  where u.custody_technician_id = uid and u.status in ('with_technician', 'pending_return');
  select coalesce(jsonb_agg(jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit), 'quantity', c.quantity
  ) order by p.name), '[]') into materials
  from public.technician_material_custody c join public.inventory_products p on p.id = c.product_id
  where c.technician_id = uid and c.quantity > 0;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'product', jsonb_build_object('id', p.id, 'name', p.name), 'quantity', r.quantity,
    'status', r.status, 'requested_at', r.requested_at
  ) order by r.requested_at desc), '[]') into requests
  from public.technician_material_return_requests r join public.inventory_products p on p.id = r.product_id
  where r.technician_id = uid and r.status = 'pending';
  return jsonb_build_object('units', units, 'materials', materials, 'pendingReturnRequests', requests);
end $$;
revoke all on function public.my_inventory_custody() from public, anon, service_role;
grant execute on function public.my_inventory_custody() to authenticated;

commit;
