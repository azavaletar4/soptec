-- PROPUESTA DE ROLLBACK: NO EJECUTADA. Requiere autorizacion explicita.
-- Fuente: catalogo de produccion READ ONLY, 2026-10-19T16:09:27Z.
-- Restaurar SOLO funciones anteriores. Conserva columna, indices, eventos y saldos.
-- No revierte consumos ni repone material. Coordinar pausa de escrituras antes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_technician_material_custody_event()')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='9aa95eb9dd3c7ed3bfc3b6b2f6c738b0') then
  raise exception 'Rollback detenido: apply_technician_material_custody_event no coincide con el candidato revisado';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.campo_inventory_operation(uuid,text,uuid,text,jsonb)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='350f42e206a24baccc1a9622c80a3b8b') then
  raise exception 'Rollback detenido: campo_inventory_operation no coincide con el candidato revisado';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='44358785bd63d7835aa668b1d2ef899e') then
  raise exception 'Rollback detenido: routine_inventory_operation no coincide con el candidato revisado';
 end if;
end $$;
-- Candidato ampliado: retirar SOLO las guardas nuevas, preservando los rechazos.
drop trigger if exists guard_material_closure on public.work_order_closures;
drop trigger if exists guard_material_installation on public.installations;
drop trigger if exists guard_material_ticket on public.tickets;
drop trigger if exists guard_material_routine on public.routines;
CREATE OR REPLACE FUNCTION public.apply_technician_material_custody_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.campo_inventory_operation(p_operation_id uuid, p_job_type text, p_job_id uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
   -- Alta: comprobacion bajo el bloqueo de la unidad, incluso para clientes antiguos/manipulados.
   if p_job_type='installation' and p_action='assign' and (
    unit_row.status::text is distinct from 'with_technician'
    or unit_row.custody_technician_id is distinct from actor
    or unit_row.client_id is not null or unit_row.contract_id is not null
    or unit_row.installation_id is not null or unit_row.ticket_id is not null or unit_row.routine_id is not null
   ) then raise exception 'El equipo no esta disponible bajo tu custodia vigente' using errcode='42501'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.routine_inventory_operation(p_routine_id uuid, p_operation_id uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
 select * into r from public.routines where id=p_routine_id for update;
 if not found then raise exception 'Rutina inexistente'; end if;
 if p_action in ('approve','reject','receive') then
   if staff not in ('SUPERADMIN','ADMIN','SOPORTE') then raise exception 'Aprobacion/recepcion exclusiva de oficina'; end if;
 elsif p_action in ('consume','correct','remove','install','withdraw','unlink') then
   if staff<>'TECNICO_RED' then raise exception 'Tecnico activo requerido'; end if;
   -- DELETE legacy retiene la fila antes de que su trigger bloquee la Rutina.
   -- No esperar esa fila teniendo el padre: 55P03 revierte sin movimientos.
   -- SHARE protege la asignación propia hasta COMMIT, también al leer recibos.
   perform 1 from public.job_assignees where job_type='routine' and job_id=r.id
     and technician_id=uid and role in ('leader','support') for share nowait;
   if not found then raise exception 'No pertenece a la cuadrilla'; end if;
 else raise exception 'Accion desconocida'; end if;
 -- También los recibos requieren identidad, rol y cuadrilla vigentes.
 select * into receipt from public.routine_inventory_operations where id=p_operation_id;
 if found then
   if receipt.actor_id is distinct from uid or receipt.routine_id is distinct from p_routine_id
      or receipt.action is distinct from p_action or receipt.payload is distinct from p_payload then
     raise exception 'Clave idempotente reutilizada con otra carga o identidad';
   end if;
   return receipt.result;
 end if;
 -- Reintentar un recibo no vuelve a escribir: conserva recuperación tras cierre
 -- para el técnico que sigue asignado. Solo una operación nueva exige progreso.
 if p_action in ('consume','correct','remove','install','withdraw','unlink') and r.status<>'in_progress' then
   raise exception 'Tecnico y rutina en progreso requeridos';
 end if;
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
end $function$;
commit;

