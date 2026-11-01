-- Respaldo verificable: definicion EXACTA y en vivo de
-- public.execute_tracked_material_inventory en Supabase Cloud
-- (mzupdnjegfwmpajywckd), capturada por solo lectura (pg_get_functiondef)
-- el 2026-11-01, segundos antes de aplicar
-- 20261101130000_registrar_fallos_material_no_custodia.sql.
--
-- MD5 normalizado confirmado: 489ac54e4a248fb191605274d683d452
-- (coincide exacto con el esperado y con el cuerpo de la migracion local
-- 20261020130000_fase165_correccion_rechazo_definitivo.sql, y con
-- scripts/rollback-registrar-fallos-material-no-custodia.sql, ya probado
-- en Postgres real aislado en esta misma sesion).
--
-- Para revertir manualmente si el script de rollback no estuviera
-- disponible, ejecutar tal cual (no requiere ningun ajuste):

CREATE OR REPLACE FUNCTION public.execute_tracked_material_inventory(p_operation_id uuid, p_job_type text, p_job_id uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$;

-- Linea base de tablas afectadas (solo lectura, 2026-11-01, previo a la migracion):
-- sqlstate_code_already_exists=0, tickets_count=60, installations_count=69,
-- routines_count=107, inventory_movements_count=584, custody_count=43,
-- custody_total_quantity=604.00, custody_events_count=409, rejections_count=5,
-- rejections_pending_count=0, rejections_agg_hash=303925637c7ce6dd0f22103cd60ce918,
-- custody_agg_hash=d5cd25311af0ee53e58a076e4df50905.
