-- Rollback especifico de 20261101130000_registrar_fallos_material_no_custodia.sql.
-- Restaura execute_tracked_material_inventory EXACTAMENTE al cuerpo de
-- 20261020134011 (MD5 489ac54e4a248fb191605274d683d452, version real
-- confirmada en produccion antes de esta candidata) y, opcionalmente,
-- elimina la columna aditiva sqlstate_code -- nullable, eliminarla no
-- pierde ninguna fila ni afecta ninguna otra tabla/trigger/politica.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.execute_tracked_material_inventory(uuid,text,uuid,text,jsonb)')) then
  raise exception 'execute_tracked_material_inventory no existe; nada que revertir';
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

-- Columna aditiva, nullable. Descomentar solo si se desea eliminarla del todo
-- (no es necesario para revertir el comportamiento -- con el DROP o sin el,
-- el cuerpo restaurado arriba ya no la referencia):
-- alter table public.material_inventory_rejections drop column if exists sqlstate_code;
commit;
