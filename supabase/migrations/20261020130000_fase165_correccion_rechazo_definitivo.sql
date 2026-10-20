-- CANDIDATO LOCAL, SIN APLICAR. Fase 165, etapa 2 (cierre, parte 2):
-- completa la recuperacion de un rechazo por custodia insuficiente --
-- hasta ahora, corregir la cantidad exigia un operation_id NUEVO (fix
-- anterior en el cliente), lo que dejaba la fila original en
-- material_inventory_rejections como 'pending' PARA SIEMPRE: el guard de
-- cierre (assert_no_rejected_materials/guard_material_closure) solo mira
-- status='pending', asi que esa orden quedaba bloqueada sin intervencion
-- administrativa por un simple error de cantidad -- justo lo que el
-- diseño original queria evitar solo para casos realmente ambiguos.
--
-- CAUSA RAIZ puntual: execute_tracked_material_inventory exige que, al
-- reusar un operation_id ya visto, el payload sea IDENTICO al guardado
-- ('previous.payload is distinct from p_payload' -> rechaza siempre),
-- sin distinguir si ese operation_id quedo en un RECHAZO CONFIRMADO
-- (status='pending', sin ningun movimiento aplicado -- certeza total,
-- nunca incierto) o en uno realmente dudoso/ya resuelto/ya anulado.
--
-- CORRECCION (una sola funcion, sin tocar las implementaciones ni el
-- guard de cierre -- ambos siguen intactos, reusados tal cual):
-- el payload solo debe coincidir EXACTO si el operation_id ya esta
-- 'resolved' o 'cancelled' (esos SI tienen un resultado definitivo que
-- no se puede reinterpretar). Si esta 'pending' (rechazo confirmado,
-- jamas incierto: para llegar a 'pending' el servidor ya tuvo que
-- devolver esa respuesta), se admite un payload distinto -- es
-- literalmente la correccion de cantidad que se pidio poder hacer. La
-- implementacion subyacente (campo_inventory_operation_f165_impl /
-- routine_inventory_operation_f165_impl) no necesita cambios: su propio
-- recibo (campo_inventory_operations) nunca se llego a insertar en el
-- intento rechazado (la subtransaccion lo revirtio junto con el Kardex),
-- asi que el reintento corregido se procesa limpio, de cero, con el
-- MISMO operation_id. Si ahora SI alcanza la custodia, la fila existente
-- pasa de 'pending' a 'resolved' (mismo UPDATE que ya existia) -- deja de
-- bloquear el cierre sin que nadie la anule ni se repongan movimientos.
--
-- No inventa un estado nuevo (sigue siendo pending/resolved/cancelled) ni
-- una relacion nueva (sigue siendo UNA fila por operation_id) -- reusa
-- exactamente las reglas de idempotencia, custodia y cierre existentes.
--
-- Riesgo evaluado: ninguna otra via puede alcanzar 'pending' salvo un
-- P1650 real (confirmado, sin ambiguedad) -- un reintento de una
-- operacion REALMENTE incierta (la respuesta nunca llego) jamas crea una
-- fila en material_inventory_rejections (el cliente conserva el mismo
-- payload para ese caso, ver fieldInventoryOperation.ts), asi que esta
-- relajacion nunca se activa por una duda de red, solo por un rechazo ya
-- confirmado.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.execute_tracked_material_inventory(uuid,text,uuid,text,jsonb)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='d5d954f1c0ba7381e06f220668b31bff') then
  raise exception 'execute_tracked_material_inventory difiere de la version revisada; detener y comparar';
 end if;
end $$;

create or replace function public.execute_tracked_material_inventory(p_operation_id uuid,p_job_type text,p_job_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.material_inventory_rejections; result jsonb; failure text;
begin
 -- Rutinas ya serializa por UUID antes de bloquear la orden: conservar ese orden.
 if p_job_type='routine' then perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,162)); end if;
 perform public.lock_material_inventory_job(p_job_type,p_job_id);
 select * into previous from public.material_inventory_rejections where operation_id=p_operation_id for update;
 if found then
   if previous.actor_id is distinct from auth.uid() or previous.job_type is distinct from p_job_type
    or previous.job_id is distinct from p_job_id or previous.action is distinct from p_action then
    raise exception 'Identificador de operacion ya utilizado'; end if;
   -- Un rechazo CONFIRMADO (status='pending', ningun movimiento aplicado --
   -- certeza total) admite corregir la cantidad/items con el MISMO
   -- operation_id. Una vez 'resolved' o 'cancelled' el resultado ya es
   -- definitivo: ahi si el payload debe seguir siendo idéntico, igual que
   -- antes de esta migracion.
   if previous.status<>'pending' and previous.payload is distinct from p_payload then
    raise exception 'Identificador de operacion ya utilizado'; end if;
   if previous.status='cancelled' then
     return jsonb_build_object('materialCancelled',true,'operationId',p_operation_id,
       'message','Administracion anulo este intento con motivo registrado. Revisa los materiales antes de registrar otro consumo.');
   end if;
 end if;
 begin
   if p_job_type='routine' then
     result:=public.routine_inventory_operation_f165_impl(p_job_id,p_operation_id,p_action,p_payload);
   else
     result:=public.campo_inventory_operation_f165_impl(p_operation_id,p_job_type,p_job_id,p_action,p_payload);
   end if;
 exception when sqlstate 'P1650' then
   -- La subtransaccion descarta recibo, Kardex y cambios provisionales de saldo.
   get stacked diagnostics failure=message_text;
   insert into public.material_inventory_rejections(operation_id,job_type,job_id,actor_id,action,payload,message)
    values(p_operation_id,p_job_type,p_job_id,auth.uid(),p_action,p_payload,failure)
    on conflict(operation_id) do update set message=excluded.message,payload=excluded.payload
    where material_inventory_rejections.status='pending';
   return jsonb_build_object('materialRejected',true,'operationId',p_operation_id,
    'message',failure || ' El material no se registro y el cierre sigue pendiente. Solicita la entrega y reintenta la misma operacion; si fue un error, pide a administracion revisar y anular el intento.');
 end;
 update public.material_inventory_rejections set status='resolved',resolved_at=clock_timestamp(),resolved_by=auth.uid(),payload=p_payload
  where operation_id=p_operation_id and status='pending';
 return result;
end $$;
commit;
