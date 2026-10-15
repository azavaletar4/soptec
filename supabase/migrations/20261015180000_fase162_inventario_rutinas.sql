-- LOCAL, pending explicit production authorization. Requires phases 151/159/161.
begin;

-- Fail before changing schema if the shared legacy implementation has drifted.
do $$
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_inventory_unit_event()')
   and md5(regexp_replace(regexp_replace(replace(prosrc,E'\r',''),'--[^\n]*','','g'),'[[:space:]]','','g'))='b4a94f7668c730756e7a85998c6e4389') then
   raise exception 'Fase 151 de inventario difiere de la version revisada; detener y comparar antes de migrar';
 end if;
end $$;

-- Operation receipts, not a second inventory: the existing Kardex is authoritative.
create table public.routine_inventory_operations (
  id uuid primary key,
  routine_id uuid not null references public.routines(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  payload jsonb not null,
  transaction_id xid8 not null default pg_current_xact_id(),
  result jsonb,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.routine_inventory_operations enable row level security;
revoke all on public.routine_inventory_operations from public,anon,authenticated,service_role;

alter table public.inventory_movements
  add column routine_id uuid references public.routines(id) on delete restrict,
  add column operation_id uuid references public.routine_inventory_operations(id) on delete restrict;
alter table public.inventory_unit_events
  add column routine_id uuid references public.routines(id) on delete restrict,
  add column operation_id uuid references public.routine_inventory_operations(id) on delete restrict;
alter table public.inventory_units
  add column routine_id uuid references public.routines(id) on delete restrict;
create index idx_inventory_movements_routine on public.inventory_movements(routine_id,created_at) where routine_id is not null;
create index idx_inventory_events_routine on public.inventory_unit_events(routine_id,created_at) where routine_id is not null;
create index idx_inventory_units_routine on public.inventory_units(routine_id) where routine_id is not null;
create unique index idx_routine_inventory_single_reversal on public.inventory_movements(reverses_movement_id)
  where routine_id is not null and reverses_movement_id is not null;

-- No setting, role switch or trigger disabling grants the exception. A receipt
-- created by the private RPC in this transaction is required by every write.
create function public.check_routine_inventory_receipt(p_id uuid,p_routine uuid)
returns public.routine_inventory_operations language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare r public.routine_inventory_operations;
begin
 select * into r from public.routine_inventory_operations where id=p_id;
 if not found or r.routine_id is distinct from p_routine or r.actor_id is distinct from auth.uid()
    or r.transaction_id is distinct from pg_current_xact_id() or r.result is not null then
   raise exception 'Operacion de inventario de rutina no autorizada';
 end if;
 return r;
end $$;

create function public.guard_routine_inventory_movement()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare source_routine uuid;
begin
 if tg_op<>'INSERT' then
   if old.routine_id is not null then raise exception 'El Kardex de rutina es inmutable'; end if;
   if tg_op='DELETE' then return old; end if;
   if new.routine_id is not null then raise exception 'No se puede convertir un movimiento existente'; end if;
   return new;
 end if;
 if new.reverses_movement_id is not null then
   select routine_id into source_routine from public.inventory_movements where id=new.reverses_movement_id;
   if source_routine is not null and new.routine_id is distinct from source_routine then
     raise exception 'La reversion debe conservar la rutina de origen';
   end if;
 end if;
 if new.routine_id is not null then
   perform public.check_routine_inventory_receipt(new.operation_id,new.routine_id);
   if new.ticket_id is not null or new.installation_id is not null then raise exception 'Origen de material ambiguo'; end if;
   new.created_by:=auth.uid();
 elsif new.operation_id is not null then raise exception 'Operacion sin rutina';
 end if;
 return new;
end $$;
create trigger fase162_inventory_movement_guard before insert or update or delete on public.inventory_movements
 for each row execute function public.guard_routine_inventory_movement();

create function public.guard_routine_inventory_unit()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_op='INSERT' then
   if new.routine_id is not null then raise exception 'No se crean equipos desde una rutina'; end if;
   return new;
 end if;
 if tg_op='DELETE' then
   if exists(select 1 from public.inventory_unit_events where unit_id=old.id and routine_id is not null) then
     raise exception 'No se puede borrar un equipo con historial de rutina';
   end if;
   return old;
 end if;
 if (old.routine_id is not null or new.routine_id is not null)
 and (old.status,old.client_id,old.contract_id,old.installation_id,old.ticket_id,old.routine_id,old.pending_pickup_by)
 is distinct from (new.status,new.client_id,new.contract_id,new.installation_id,new.ticket_id,new.routine_id,new.pending_pickup_by)
 and not exists(select 1 from public.routine_inventory_operations r
   where r.actor_id=auth.uid() and r.transaction_id=pg_current_xact_id() and r.result is null
   and r.payload->>'unit_id'=old.id::text and r.action in ('install','withdraw','approve','reject','unlink','receive')) then
   raise exception 'Use la operacion especifica de inventario de rutina';
 end if;
 return new;
end $$;
create trigger fase162_inventory_unit_guard before insert or update or delete on public.inventory_units
 for each row execute function public.guard_routine_inventory_unit();

create function public.guard_routine_inventory_event()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare linked uuid;
begin
 if tg_op<>'INSERT' then
   if old.routine_id is not null then raise exception 'El historial de equipo de rutina es inmutable'; end if;
   if tg_op='DELETE' then return old; end if;
   if new.routine_id is not null then raise exception 'No se puede convertir un evento existente'; end if;
   return new;
 end if;
 select routine_id into linked from public.inventory_units where id=new.unit_id;
 if new.routine_id is not null then
   perform public.check_routine_inventory_receipt(new.operation_id,new.routine_id);
   new.created_by:=auth.uid();
 elsif linked is not null or new.operation_id is not null then
   raise exception 'Use la operacion especifica de inventario de rutina';
 end if;
 return new;
end $$;
create trigger fase162_inventory_event_guard before insert or update or delete on public.inventory_unit_events
 for each row execute function public.guard_routine_inventory_event();

-- This branch alone handles routine events; the original Phase 151 branch
-- will remain byte-for-byte intact below for tickets/installations.
create function public.apply_routine_inventory_event(e public.inventory_unit_events)
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
 -- Preserve original order identifiers in every immutable event. Withdrawal
 -- also keeps them on the unit until office confirms physical reception.
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
   if u.status<>'in_stock' or u.routine_id is not null then raise exception 'Equipo no disponible en bodega'; end if;
   if not exists(select 1 from public.inventory_products where id=u.product_id and is_active and is_serialized)
      or coalesce(nullif(btrim(u.serial_number),''),nullif(btrim(u.mac_address),'')) is null then raise exception 'Equipo sin identidad serializada valida'; end if;
   -- Keep the existing one-ONT-per-contract rule; TV Box/Mesh have no such limit.
   if exists(select 1 from public.inventory_products p join public.inventory_categories c on c.id=p.category_id where p.id=u.product_id and c.slug='onu')
   and exists(select 1 from public.inventory_units x join public.inventory_products p on p.id=x.product_id join public.inventory_categories c on c.id=p.category_id
      where x.id<>u.id and x.contract_id=destination and x.status in ('assigned','pending_approval') and c.slug='onu') then raise exception 'Solo se puede asignar 1 ONT por contrato'; end if;
   e.to_status:='pending_approval';
   update public.inventory_units set status=e.to_status,client_id=e.client_id,contract_id=e.contract_id,
     routine_id=e.routine_id,pending_pickup_by=null,assigned_at=now(),updated_at=now() where id=u.id;
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

create function public.routine_inventory_operation(p_routine_id uuid,p_operation_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare uid uuid:=auth.uid(); staff public.user_role; r public.routines;
 receipt public.routine_inventory_operations; m public.inventory_movements; p public.inventory_products;
 qty numeric; result_id uuid; reversal_id uuid; v_result jsonb;
begin
 staff:=public.current_user_role();
 if uid is null or staff is null then raise exception 'Identidad activa requerida'; end if;
 if p_routine_id is null or p_operation_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
   or p_action is null then raise exception 'Operacion y carga requeridas'; end if;
 -- Serializes retries (including the same operation UUID on different routines).
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,162));
 select * into receipt from public.routine_inventory_operations where id=p_operation_id;
 if found then
   if receipt.actor_id is distinct from uid or receipt.routine_id is distinct from p_routine_id
      or receipt.action is distinct from p_action or receipt.payload is distinct from p_payload then
     raise exception 'Clave idempotente reutilizada con otra carga o identidad';
   end if;
   return receipt.result;
 end if;
 select * into r from public.routines where id=p_routine_id for update;
 if not found then raise exception 'Rutina inexistente'; end if;
 if p_action in ('approve','reject','receive') then
   if staff not in ('SUPERADMIN','ADMIN','SOPORTE') then raise exception 'Aprobacion/recepcion exclusiva de oficina'; end if;
 elsif p_action in ('consume','correct','remove','install','withdraw','unlink') then
   if staff<>'TECNICO_RED' or r.status<>'in_progress' then raise exception 'Tecnico y rutina en progreso requeridos'; end if;
   perform 1 from public.job_assignees where job_type='routine' and job_id=r.id for update;
   if not exists(select 1 from public.job_assignees where job_type='routine' and job_id=r.id and technician_id=uid) then raise exception 'No pertenece a la cuadrilla'; end if;
 else raise exception 'Accion desconocida'; end if;
 if p_action='withdraw' and nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'Motivo de retiro requerido'; end if;
 insert into public.routine_inventory_operations(id,routine_id,actor_id,action,payload)
 values(p_operation_id,r.id,uid,p_action,p_payload);
 if p_action in ('consume','correct','remove') then
   if p_action='consume' then
     select * into p from public.inventory_products where id=(p_payload->>'product_id')::uuid for update;
   else
     select * into m from public.inventory_movements where id=(p_payload->>'movement_id')::uuid for update;
     if not found or m.routine_id is distinct from r.id or m.movement_type<>'egreso'
       or exists(select 1 from public.inventory_movements where reverses_movement_id=m.id) then raise exception 'Consumo no vigente de esta rutina'; end if;
     select * into p from public.inventory_products where id=m.product_id for update;
   end if;
   if p.id is null or not p.is_active or p.is_serialized then raise exception 'Producto consumible activo requerido'; end if;
   qty:=case when p_action='remove' then 0 else (p_payload->>'quantity')::numeric end;
   if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<0 or (qty=0 and p_action<>'remove')
      or qty<>round(qty,2) or qty>=10000000000 then raise exception 'Cantidad positiva con hasta dos decimales requerida'; end if;
   if lower(btrim(p.unit)) in ('unidad','unidades','und','u','pieza','piezas') and qty<>trunc(qty) then raise exception 'Este producto requiere unidades enteras'; end if;
   if p_action<>'consume' then
     insert into public.inventory_movements(product_id,movement_type,quantity,reason,routine_id,operation_id,reverses_movement_id)
     values(p.id,'ingreso',m.quantity,'Correccion de consumo en rutina',r.id,p_operation_id,m.id) returning id into reversal_id;
   end if;
   if qty>0 then
     insert into public.inventory_movements(product_id,movement_type,quantity,reason,routine_id,operation_id)
     values(p.id,'egreso',qty,nullif(btrim(p_payload->>'reason'),''),r.id,p_operation_id) returning id into result_id;
   end if;
 else
   insert into public.inventory_unit_events(unit_id,to_status,reason,routine_id,operation_id)
   values((p_payload->>'unit_id')::uuid,'pending_approval',coalesce(nullif(btrim(p_payload->>'reason'),''),p_action),r.id,p_operation_id)
   returning id into result_id;
 end if;
 v_result:=jsonb_build_object('movement_or_event_id',result_id,'reversal_id',reversal_id,'operation_id',p_operation_id);
 update public.routine_inventory_operations set result=v_result where id=p_operation_id;
 return v_result;
end $$;

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

revoke all on function public.check_routine_inventory_receipt(uuid,uuid),
 public.guard_routine_inventory_movement(),public.guard_routine_inventory_unit(),public.guard_routine_inventory_event(),
 public.apply_routine_inventory_event(public.inventory_unit_events),public.routine_inventory_operation(uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.routine_inventory_operation(uuid,uuid,text,jsonb) to authenticated;
commit;
