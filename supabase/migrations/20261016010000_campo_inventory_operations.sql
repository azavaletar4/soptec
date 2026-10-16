-- Etapa 3 LOCAL: no aplicar en Cloud sin revisión y autorización de despliegue.
-- Recibo necesario para conservar intención, carga y resultado de correct (2 filas)
-- y de kit (N filas), incluso tras pérdida de respuesta o reinicio del cliente.
begin;
create table public.campo_inventory_operations (
 id uuid primary key,
 actor_id uuid not null references public.profiles(id),
 job_type text not null check(job_type in ('installation','ticket')),
 job_id uuid not null,
 client_id uuid,
 contract_id uuid,
 action text not null,
 payload jsonb not null,
 result jsonb,
 created_at timestamptz not null default now()
);
alter table public.campo_inventory_operations enable row level security;
revoke all on public.campo_inventory_operations from public, anon, authenticated;

create function public.campo_inventory_operation(
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
 -- Solo claves declaradas: nunca actor, cliente, contrato, saldo o estado libre.
 for key in select jsonb_object_keys(p_payload) loop
  if not key=any(allowed_keys) then
   raise exception 'Campo no permitido' using errcode='22023';
  end if;
 end loop;
 reason := p_payload->>'reason';
 if length(coalesce(reason,''))>500 then raise exception 'Motivo demasiado largo' using errcode='22023'; end if;
 -- SHARE protege baja/cambio de rol durante toda la transacción.
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
  -- DML legacy puede retener la asignación antes de su trigger que bloquea
  -- el padre. No esperar aquí teniendo ya el padre: evitar ciclo padre↔hijo.
  -- 55P03 aborta toda la operación sin recibo/movimiento; admite reintento.
  perform 1 from public.job_assignees where job_type=p_job_type and job_id=p_job_id
   and technician_id=actor and role in ('leader','support') for share nowait;
  if not found then raise exception 'Asignación no vigente' using errcode='42501'; end if;
 end if;
 if contract is not null then
  perform 1 from public.service_contracts where id=contract and client_id=client for update;
  if not found then raise exception 'Contrato no corresponde a la orden' using errcode='42501'; end if;
 end if;
 -- UUID global: serializa también colisiones de intención entre distintas órdenes.
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into receipt from public.campo_inventory_operations where id=p_operation_id;
 if found then
  if receipt.actor_id<>actor or receipt.job_type<>p_job_type or receipt.job_id<>p_job_id
    or receipt.action<>p_action or receipt.payload<>p_payload
    or receipt.client_id is distinct from client or receipt.contract_id is distinct from contract then
   raise exception 'Identificador de operación ya utilizado' using errcode='22023';
  end if;
  -- Replay autorizado, incluso si la orden se cerró después del commit original.
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
  -- Bloquear productos en orden estable antes de los triggers existentes.
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
   if unit_row.status::text<>'in_stock' or unit_row.client_id is not null or unit_row.contract_id is not null
    or unit_row.installation_id is not null or unit_row.ticket_id is not null then
    raise exception 'Equipo no disponible' using errcode='42501';
   end if;
   destination:=case when p_action='assign' then 'assigned'::public.inventory_unit_status else 'pending_approval'::public.inventory_unit_status end;
  else
   -- Sin excepciones por cliente/historial: las ocho unidades ambiguas quedan fuera.
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
commit;
