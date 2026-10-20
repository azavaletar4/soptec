-- Fase 165, etapa 2: propuesta LOCAL. No aplicar sin autorizacion explicita
-- del usuario en el mismo turno (ver CLAUDE.md regla 16).
--
-- PROBLEMA REAL (etapa 1, 18-19/10/2026): campo_inventory_operation
-- ('kit'/'consume', Altas/Averias) y routine_inventory_operation
-- ('consume', Rutinas) nunca verifican technician_material_custody antes
-- de descontar el almacen central -- un tecnico puede liquidar cualquier
-- material activo no serializado sin haber recibido nunca una entrega
-- formal. Confirmado con datos reales: 158 consumos historicos sin
-- ninguna entrega de custodia asociada (ver Fase 165 etapa 1, ya
-- desplegada como advertencia de solo lectura).
--
-- DISEÑO (etapa 2 -- bloqueo obligatorio en servidor):
--
-- technician_material_custody ya tiene el mecanismo exacto que se pide
-- (atomico, a prueba de concurrencia, nunca negativo): el trigger
-- apply_technician_material_custody_event() hace "for update" + "if
-- current_qty + delta < 0 then raise exception" en cada insert de
-- technician_material_custody_events. Hoy solo lo usan 'delivery'/
-- 'return'. Esta fase reusa el MISMO mecanismo para el consumo real en
-- vez de construir uno nuevo:
--
-- 1. Antes de cada 'egreso' real (consumo), se inserta un evento
--    'consumption' -- si no alcanza la custodia, el trigger existente
--    aborta TODA la operacion (misma transaccion, nada queda a medias).
-- 2. Antes de cada 'ingreso' que revierte un consumo (correct/reverse/
--    remove), se inserta un evento 'consumption_reversal' -- PERO
--    UNICAMENTE si el consumo original quedo rastreado por esta misma
--    fase (ver mas abajo) -- nunca se repone custodia "ficticia" sobre
--    un consumo historico que jamas paso por este control.
--
-- CORRECCION DE DISEÑO (rechazada la opcion que reponia custodia
-- siempre con solo "el monto completo del movimiento original", por
-- riesgo de custodia ficticia en reversiones de consumos historicos):
-- se agrega technician_material_custody_events.source_movement_id
-- (uuid, referencia nullable a inventory_movements.id) -- la UNICA
-- columna nueva de esta fase, con una guarda de integridad que exige
-- que sea NOT NULL si y solo si el evento es 'consumption' o
-- 'consumption_reversal' (nunca en 'delivery'/'return', que no tocan
-- el Kardex). Al corregir/revertir un movimiento, se busca si existe
-- un evento 'consumption' con ese source_movement_id exacto: si existe,
-- se repone la custodia de ESE tecnico exacto (trazabilidad real); si
-- no existe (consumo historico, nunca paso por este control), NO se
-- toca la custodia -- ni se repone de mas, ni se bloquea la correccion.
-- Esto satisface el punto 5 del pedido (nunca re-descontar ni bloquear
-- ordenes/datos historicos) sin inventar una reposicion no verificable.
--
-- 3. El tecnico que se descuenta es SIEMPRE quien registra el consumo
--    real (auth.uid()) -- en 'correct' (cantidad corregida), se le
--    atribuye al tecnico del evento de consumo vinculado, nunca a
--    quien ejecuta la correccion (puede ser otro miembro de la
--    cuadrilla o un admin) -- mismo criterio exacto que pide el punto 6.
-- 4. Equipos serializados (ONT/Mesh/TV Box): SIN CAMBIOS -- la rama de
--    materiales ya exige "not product.is_serialized" antes de tocar
--    cualquier movimiento; estructuralmente no puede mezclarse.
--
-- Riesgo operativo (dejar documentado, no resuelto por este archivo):
-- hoy existen 0 entregas de material registradas en todo el sistema.
-- Si esto se activa sin que administracion use antes "Entregar material
-- a un tecnico", NINGUN tecnico podra registrar material nuevo en
-- Altas/Averias/Rutinas. Por eso esta migracion queda preparada pero
-- SIN APLICAR -- el bloqueo real no se activa con este commit.
begin;

-- Falla antes de tocar nada si las 3 funciones compartidas ya
-- cambiaron en Cloud desde que se preparo este archivo (mismo patron
-- de guarda que Fases 162/164).
do $$
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.campo_inventory_operation(uuid,text,uuid,text,jsonb)')
   and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='47908cff64839ee19034db975a8b0e3e') then
  raise exception 'campo_inventory_operation difiere de la version revisada; detener y comparar antes de migrar';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)')
   and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='7720f97852485732433b3f33495955e2') then
  raise exception 'routine_inventory_operation difiere de la version revisada; detener y comparar antes de migrar';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_technician_material_custody_event()')
   and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='d51b35789ee58f189512b4f3c989e711') then
  raise exception 'apply_technician_material_custody_event difiere de la version revisada; detener y comparar antes de migrar';
 end if;
end $$;

-- ===================== Unica columna nueva =====================
-- Correlaciona un evento de custodia con el movimiento real del Kardex
-- que lo origino -- solo asi se puede saber, sin adivinar, si un
-- consumo que se esta corrigiendo/revirtiendo tuvo alguna vez un
-- descuento de custodia real que reponer.
alter table public.technician_material_custody_events
  add column source_movement_id uuid references public.inventory_movements(id);

create unique index idx_technician_material_custody_events_source_movement
  on public.technician_material_custody_events(source_movement_id, event_type)
  where source_movement_id is not null;

alter table public.technician_material_custody_events
  drop constraint technician_material_custody_events_event_type_check;
alter table public.technician_material_custody_events
  add constraint technician_material_custody_events_event_type_check
  check (event_type = any (array['delivery','return','consumption','consumption_reversal']));

-- Integridad: source_movement_id es obligatorio en consumo/reversion de
-- consumo (son los unicos eventos que corresponden a un movimiento real
-- del Kardex) y debe estar vacio en entrega/devolucion (esos nunca
-- tocan inventory_movements, por diseño de la Fase 164 original).
alter table public.technician_material_custody_events
  add constraint technician_material_custody_events_source_matches_type
  check ((event_type in ('consumption','consumption_reversal')) = (source_movement_id is not null));

-- ===================== Trigger: saldo atomico incluso sin fila previa =====================
-- 'consumption_reversal' se suma al lado positivo del delta (repone
-- custodia), igual que 'delivery' -- 'return' y 'consumption' siguen
-- siendo el lado negativo. Mensajes de error separados: el generico
-- de "devolucion" ya no aplica cuando el evento es un consumo real.
create or replace function public.apply_technician_material_custody_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_qty numeric; delta numeric;
begin
  delta := case when new.event_type in ('delivery', 'consumption_reversal') then new.quantity else -new.quantity end;
  -- Incluso sin saldo previo: crear primero la fila evita actualizaciones perdidas.
  insert into public.technician_material_custody(technician_id, product_id, quantity)
  values (new.technician_id, new.product_id, 0) on conflict do nothing;
  select quantity into current_qty from public.technician_material_custody
    where technician_id = new.technician_id and product_id = new.product_id for update;
  current_qty := coalesce(current_qty, 0);
  if current_qty + delta < 0 then
    if new.event_type = 'return' then
      raise exception 'El tecnico no tiene esa cantidad en custodia para devolver (tiene %, intenta devolver %)', current_qty, new.quantity;
    else
      raise exception 'No tienes suficiente material en custodia para este consumo (tienes %, intentas usar %). Pide la entrega a un administrador.', current_qty, new.quantity using errcode='P1650';
    end if;
  end if;
  insert into public.technician_material_custody(technician_id, product_id, quantity, updated_at)
  values (new.technician_id, new.product_id, current_qty + delta, now())
  on conflict (technician_id, product_id) do update
    set quantity = excluded.quantity, updated_at = excluded.updated_at;
  return new;
end $$;

-- ===================== campo_inventory_operation (Altas/Averias) =====================
-- Copia byte a byte de la version vigente en Cloud (MD5 verificado
-- arriba) salvo dos inserciones puntuales en la rama de materiales:
-- descuento de custodia antes de cada 'egreso' real, y reposicion
-- condicionada (solo si el original quedo rastreado) antes de cada
-- 'ingreso' de correct/reverse. La rama de equipos serializados
-- (assign/unassign/stage/return/unlink) queda intacta.
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
 v_tracked_technician uuid;
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
   -- Fase 165 etapa 2: repone custodia SOLO si el consumo original
   -- quedo rastreado por este mismo control -- nunca custodia ficticia
   -- sobre un consumo historico que nunca paso por aqui (punto 5).
   select technician_id into v_tracked_technician from public.technician_material_custody_events
     where source_movement_id = original.id and event_type = 'consumption' limit 1;
   if v_tracked_technician is not null then
    insert into public.technician_material_custody_events(technician_id,product_id,event_type,quantity,reason,created_by,source_movement_id)
    values(v_tracked_technician, original.product_id, 'consumption_reversal', original.quantity,
     coalesce(reason,'Reversión contextual de Campo'), actor, original.id);
   end if;
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
   -- Fase 165 etapa 2: descuenta la custodia del tecnico que
   -- REALMENTE lo registra -- en 'correct' es quien hizo el consumo
   -- original (evento vinculado), nunca quien ejecuta la correccion.
   -- Responsable verificable en el evento, incluso tras varias correcciones.
   -- Sin evento: cadena historica, no exigir ni inventar custodia.
   if p_action <> 'correct' or v_tracked_technician is not null then
   insert into public.technician_material_custody_events(technician_id,product_id,event_type,quantity,reason,created_by,source_movement_id)
   values(case when p_action='correct' then v_tracked_technician else actor end,
    (item->>'productId')::uuid,'consumption',quantity,coalesce(reason,'Consumo contextual de Campo'),actor,new_id);
   end if;
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
$$;

-- ===================== routine_inventory_operation (Rutinas) =====================
-- Mismo criterio exacto, copia byte a byte de la version vigente salvo
-- las dos inserciones puntuales en la rama de materiales.
create or replace function public.routine_inventory_operation(
 p_routine_id uuid, p_operation_id uuid, p_action text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare uid uuid:=auth.uid(); staff public.user_role; r public.routines;
 receipt public.routine_inventory_operations; m public.inventory_movements; p public.inventory_products;
 qty numeric; result_id uuid; reversal_id uuid; v_result jsonb;
 v_tracked_technician uuid;
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
     -- Fase 165 etapa 2: repone custodia SOLO si el consumo original
     -- quedo rastreado (punto 5: nunca custodia ficticia sobre historico).
     select technician_id into v_tracked_technician from public.technician_material_custody_events
       where source_movement_id = m.id and event_type = 'consumption' limit 1;
     if v_tracked_technician is not null then
       insert into public.technician_material_custody_events(technician_id,product_id,event_type,quantity,reason,created_by,source_movement_id)
       values(v_tracked_technician, p.id, 'consumption_reversal', m.quantity, 'Correccion de consumo en rutina', uid, m.id);
     end if;
   end if;
   if qty>0 then
     insert into public.inventory_movements(product_id,movement_type,quantity,reason,routine_id,operation_id)
     values(p.id,'egreso',qty,nullif(btrim(p_payload->>'reason'),''),r.id,p_operation_id) returning id into result_id;
     -- Fase 165 etapa 2: descuenta la custodia de quien REALMENTE
     -- consumio -- en 'correct' es el tecnico del movimiento original,
     -- nunca quien ejecuta la correccion (puede ser otro de la cuadrilla).
     -- La firma del Kardex identifica al editor; el evento conserva al responsable.
     -- Las cadenas historicas permanecen sin efecto sobre custodia.
     if p_action <> 'correct' or v_tracked_technician is not null then
     insert into public.technician_material_custody_events(technician_id,product_id,event_type,quantity,reason,created_by,source_movement_id)
     values(case when p_action='correct' then v_tracked_technician else uid end, p.id, 'consumption', qty,
       nullif(btrim(p_payload->>'reason'),''), uid, result_id);
     end if;
   end if;
 else
   insert into public.inventory_unit_events(unit_id,to_status,reason,routine_id,operation_id)
   values((p_payload->>'unit_id')::uuid,'pending_approval',coalesce(nullif(btrim(p_payload->>'reason'),''),p_action),r.id,p_operation_id)
   returning id into result_id;
 end if;
 v_result:=jsonb_build_object('movement_or_event_id',result_id,'reversal_id',reversal_id,'operation_id',p_operation_id);
 update public.routine_inventory_operations set result=v_result where id=p_operation_id;
 return v_result;
end
$$;

commit;
