-- SOLO PREPARADO LOCALMENTE. Requiere autorizacion posterior para aplicarse en Cloud.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN IF md5(pg_get_functiondef('public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)'::regprocedure)) <> 'ee3caff47e2d49870faacd85faca9f0b' THEN RAISE EXCEPTION 'Deriva en public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text); detener'; END IF; END $$;
DO $$ BEGIN IF md5(pg_get_functiondef('public.campo_inventory_operation(uuid,text,uuid,text,jsonb)'::regprocedure)) <> 'b1d5aeb3aad0f12cf3eaa1b0511929fc' THEN RAISE EXCEPTION 'Deriva en public.campo_inventory_operation(uuid,text,uuid,text,jsonb); detener'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.inventory_order_read(p_job_type text, p_job_id uuid, p_view text, p_page integer DEFAULT 0, p_product_id uuid DEFAULT NULL::uuid, p_unit_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
 actor uuid:=auth.uid(); staff text; job_status text; client uuid; contract uuid;
 job_column text; rows jsonb:='[]'; context jsonb; warning text; offset_rows integer;
begin
 if actor is null or p_job_id is null or p_job_type is null
 or p_job_type not in ('installation','ticket','routine')
 or p_view is null or p_view not in ('products','materials','assigned','pending','available','unit-context','linked','events','contracts')
 or p_page is null or p_page<0 or p_page>10000 then
  raise exception 'Consulta de inventario invalida' using errcode='22023';
 end if;
 select role::text into staff from public.profiles where id=actor and active for share nowait;
 if staff is null or staff not in ('ADMIN','SUPERADMIN','TECNICO_RED','SOPORTE')
 or (staff='SOPORTE' and p_job_type='installation') then
  raise exception 'Acceso no autorizado a esta orden' using errcode='42501';
 end if;
 if p_job_type='installation' then
  select status::text,client_id,contract_id into job_status,client,contract
   from public.installations where id=p_job_id for share nowait;
  job_column:='installation_id';
 elsif p_job_type='ticket' then
  select status::text,client_id,contract_id into job_status,client,contract
   from public.tickets where id=p_job_id for share nowait;
  job_column:='ticket_id';
 else
  select status::text,client_id,contract_id into job_status,client,contract
   from public.routines where id=p_job_id for share nowait;
  job_column:='routine_id';
 end if;
 if not found then raise exception 'Orden no autorizada' using errcode='42501'; end if;
 if staff='TECNICO_RED' then
  perform 1 from public.job_assignees where job_type=p_job_type and job_id=p_job_id
   and technician_id=actor and role in ('leader','support') for share nowait;
  if not found then raise exception 'Asignacion no vigente' using errcode='42501'; end if;
  if not (case p_job_type
    when 'installation' then job_status in ('pending','scheduled','in_progress')
    when 'ticket' then job_status in ('open','in_progress','rescheduled')
    else job_status in ('pending','scheduled','in_progress') end)
   and not (p_view in ('materials','assigned','pending','linked','events') and
    case when p_job_type='ticket' then job_status in ('resolved','closed') else job_status='completed' end) then
   raise exception 'Estado de orden no autorizado' using errcode='42501';
  end if;
 end if;
 if staff='SOPORTE' and p_view not in ('materials','pending','assigned','linked','events') then
  raise exception 'Consulta exclusiva de la operacion de Campo' using errcode='42501';
 end if;
 if contract is not null then
  perform 1 from public.service_contracts where id=contract and client_id=client for share nowait;
  if not found then raise exception 'Contrato no corresponde a la orden' using errcode='42501'; end if;
 end if;
 if p_view in ('linked','events','contracts') and p_job_type<>'routine' then
  raise exception 'Consulta no valida para esta orden' using errcode='22023';
 end if;
 context:=jsonb_build_object('jobType',p_job_type,'jobId',p_job_id,'actorId',actor,'clientId',client,'contractId',contract);
 offset_rows:=p_page*100;
 if p_view='products' then
  select coalesce(jsonb_agg(x.dto),'[]') into rows from (
   select jsonb_build_object('id',p.id,'name',p.name,'unit',p.unit,'is_active',p.is_active,
    'is_serialized',p.is_serialized,'current_stock',p.current_stock,
    'inventory_categories',case when c.id is null then null else jsonb_build_object('slug',c.slug) end) dto
   from public.inventory_products p left join public.inventory_categories c on c.id=p.category_id
   where p.is_active order by p.id limit 101 offset offset_rows
  )x;
 elsif p_view='materials' then
  execute format($q$select coalesce(jsonb_agg(x.dto),'[]') from (
   select jsonb_build_object('id',m.id,'product_id',m.product_id,'movement_type',m.movement_type,
    'quantity',m.quantity,'reason',m.reason,'ticket_id',m.ticket_id,'installation_id',m.installation_id,
    'routine_id',m.routine_id,'created_at',m.created_at,'reverses_movement_id',m.reverses_movement_id,
    'product',jsonb_build_object('id',p.id,'name',p.name,'unit',p.unit)) dto
   from public.inventory_movements m join public.inventory_products p on p.id=m.product_id
   where m.%I=$1 order by m.created_at,m.id limit 101 offset $2)x$q$,job_column)
   into rows using p_job_id,offset_rows;
 elsif p_view='contracts' then
  select coalesce(jsonb_agg(x.dto),'[]') into rows from (
   select jsonb_build_object('id',c.id,'contract_number',c.contract_number) dto
   from public.service_contracts c where c.client_id=client and (contract is null or c.id=contract)
   order by c.id limit 101 offset offset_rows)x;
 elsif p_view='events' then
  select coalesce(jsonb_agg(x.dto),'[]') into rows from (
   select jsonb_build_object('id',e.id,'from_status',e.from_status,'to_status',e.to_status,
    'reason',e.reason,'created_at',e.created_at,
    'unit',jsonb_build_object('serial_number',u.serial_number,'mac_address',u.mac_address)) dto
   from public.inventory_unit_events e join public.inventory_units u on u.id=e.unit_id
   where e.routine_id=p_job_id order by e.created_at,e.id limit 101 offset offset_rows)x;
 else
  if p_view='available' and p_product_id is null then
   raise exception 'Selecciona un producto' using errcode='22023';
  end if;
  if p_view='unit-context' and (p_unit_id is null or p_action is null or p_action not in ('unassign','unlink')
    or (p_action='unassign') is distinct from (p_job_type='installation')) then
   raise exception 'La operacion no corresponde a esta orden' using errcode='22023';
  end if;
  execute format($q$select coalesce(jsonb_agg(x.dto),'[]') from (
   select (jsonb_build_object('id',u.id,'product_id',u.product_id,'serial_number',u.serial_number,
    'mac_address',u.mac_address,'status',u.status,'client_id',u.client_id,'contract_id',u.contract_id,
    'installation_id',u.installation_id,'ticket_id',u.ticket_id,'routine_id',u.routine_id,
    'product',jsonb_build_object('id',p.id,'name',p.name,'unit',p.unit,
     'inventory_categories',case when c.id is null then null else jsonb_build_object('slug',c.slug) end))
    || case when $9 in ('ADMIN','SUPERADMIN') then jsonb_build_object('notes',u.notes) else '{}'::jsonb end) dto
   from public.inventory_units u join public.inventory_products p on p.id=u.product_id
    left join public.inventory_categories c on c.id=p.category_id
   where case
    when $1='available' then p.is_active and p.is_serialized and u.product_id=$2 and ((u.status='in_stock' and u.custody_technician_id is null)
     or ($8='installation' and u.status='with_technician' and u.custody_technician_id=$11))
     and u.client_id is null and u.contract_id is null and u.installation_id is null and u.ticket_id is null and u.routine_id is null
    when $1='unit-context' then u.id=$3 and u.%I=$4 and u.client_id is not distinct from $5
     and (u.contract_id is null or u.contract_id=$6)
     and u.status=case when $7='unassign' then 'assigned' else 'pending_approval' end::public.inventory_unit_status
    when $1='linked' then u.routine_id=$4 and u.client_id is not distinct from $5 and (u.contract_id is null or $6 is null or u.contract_id=$6)
    when $1='pending' or $8='installation' or $9='SOPORTE' then
     u.%I=$4 and u.client_id is not distinct from $5 and (u.contract_id is null or u.contract_id=$6)
     and ($1<>'pending' or u.status='pending_approval')
    when $6 is not null then u.client_id=$5 and u.contract_id=$6 and u.status='assigned'
    when $8='routine' then u.client_id=$5 and u.status='assigned' and
     (exists(select 1 from public.service_contracts c where c.id=u.contract_id and c.client_id=$5) or u.routine_id=$4)
    else u.%I=$4 and u.client_id is not distinct from $5 and u.contract_id is null and u.status='assigned'
   end order by u.id limit 101 offset $10)x$q$,job_column,job_column,job_column)
   into rows using p_view,p_product_id,p_unit_id,p_job_id,client,contract,p_action,p_job_type,staff,offset_rows,actor;
  if p_view='unit-context' and jsonb_array_length(rows)=0 then
   raise exception 'El equipo no corresponde a esta orden' using errcode='42501';
  end if;
  if p_view='assigned' and p_job_type='ticket' and contract is null then
   warning:='Esta orden no tiene contrato vinculado. Solo se muestran equipos vinculados directamente a ella; solicita revision de los equipos historicos.';
  end if;
 end if;
 return jsonb_build_object('context',context,'items',case when jsonb_array_length(rows)>100 then rows-100 else rows end,
  'next',case when jsonb_array_length(rows)>100 then p_page+1 else null end)
  ||case when warning is null then '{}'::jsonb else jsonb_build_object('warning',warning) end;
end $function$
;
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
$function$
;
COMMIT;
