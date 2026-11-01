-- CANDIDATA LOCAL, SIN APLICAR. Requiere autorizacion expresa.
--
-- CORREGIDA (2026-11-01, misma sesion): la version anterior de este archivo
-- se baso por error en el cuerpo de 20261019170000 -- EXISTE una version
-- posterior realmente desplegada (20261020134011_fase165_correccion_rechazo_definitivo,
-- confirmada aplicada y con hash verificado en ESTADO_DESARROLLO.md linea
-- 2181-2185: MD5 489ac54e4a248fb191605274d683d452) que relaja la
-- idempotencia para permitir "corregir la cantidad con el mismo
-- operation_id" cuando el rechazo previo sigue 'pending'. La version
-- anterior de esta candidata HABRIA REVERTIDO esa correccion ya aprobada y
-- en produccion (el payload volveria a exigirse identico siempre, rompiendo
-- la correccion de cantidad de un rechazo confirmado). Re-verificado por
-- auto-calculo del MD5 normalizado sobre el archivo fuente real
-- (coincide exacto, ver validacion de esta sesion) antes de reescribir.
--
-- OBJETIVO (sin cambios respecto de la version anterior): hoy, un intento
-- de 'consume'/'kit'/'correct' que falla por una razon DISTINTA a falta de
-- custodia (P1650) -- ej. "Producto no admite consumo de material"
-- (producto inactivo/serializado), "Cantidad invalida", "Kit invalido" --
-- no queda registrado en absoluto: ni Kardex, ni custodia, ni una fila en
-- material_inventory_rejections. Misma atomicidad correcta (nada parcial),
-- pero deja CERO rastro para administracion.
--
-- ALCANCE DELIBERADAMENTE ACOTADO: solo errcode '22023' (validacion de
-- entrada/negocio, siempre la misma causa determinista). NO se agrega
-- 'others' ni '42501' a proposito:
--  - '42501' (permisos/autorizacion) debe seguir siendo un fallo visible y
--    distinto -- convertirlo en un rechazo "silencioso" podria disfrazar
--    un intento de acceso indebido como un simple problema de inventario.
--  - cualquier otro codigo (ej. '55P03' bloqueo ocupado) debe seguir
--    propagandose tal cual -- el cliente YA tiene manejo especifico para
--    '55P03' (src/lib/fieldInventoryOperation.ts); capturarlo aqui lo
--    esconderia de ese manejo existente.
--
-- Un rechazo '22023' queda sujeto a LA MISMA maquina de correccion/cierre
-- que uno 'P1650' (misma idempotencia relajada mientras status='pending',
-- mismo no-bloqueo de cierre por Fase 166) -- es la unica forma consistente
-- con el cliente, que no distingue el motivo del rechazo al decidir si
-- permite corregir (fieldInventoryOperation.ts/routineInventoryRequest.ts,
-- isConfirmedRejection/onRejected no miran la causa). NO CAMBIA el bloqueo
-- de cierre (assert_no_rejected_materials sigue siendo no-op, Fase 166,
-- decision de negocio ya aprobada -- no se toca). NO cambia ningun mensaje
-- ni comportamiento del caso ya manejado (P1650).
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.execute_tracked_material_inventory(uuid,text,uuid,text,jsonb)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='489ac54e4a248fb191605274d683d452') then
  raise exception 'execute_tracked_material_inventory difiere de la version revisada (20261020134011); detener y comparar antes de migrar';
 end if;
end $$;

do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='material_inventory_rejections' and column_name='sqlstate_code') then
  alter table public.material_inventory_rejections add column sqlstate_code text;
 end if;
end $$;

-- Cuerpo de la funcion: copia EXACTA de la version vigente (20261020134011,
-- MD5 verificado arriba) salvo (a) agrega sqlstate_code en ambos INSERT,
-- (b) agrega la rama "when sqlstate '22023'" con el mismo patron exacto que
-- la rama P1650 existente (mismo ON CONFLICT con guarda de status, mismo
-- mensaje estructurado). Nada mas cambia en el cuerpo -- ni la relajacion
-- de idempotencia, ni el UPDATE final, ni ninguna otra linea. No se repite
-- ningun REVOKE/GRANT: CREATE OR REPLACE preserva el ACL existente
-- (el REVOKE de 20261019170000 sobre esta funcion sigue vigente sin tocarlo).
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
 exception
   when sqlstate 'P1650' then
     -- La subtransaccion descarta recibo, Kardex y cambios provisionales de saldo.
     get stacked diagnostics failure=message_text;
     insert into public.material_inventory_rejections(operation_id,job_type,job_id,actor_id,action,payload,message,sqlstate_code)
      values(p_operation_id,p_job_type,p_job_id,auth.uid(),p_action,p_payload,failure,'P1650')
      on conflict(operation_id) do update set message=excluded.message,payload=excluded.payload,sqlstate_code=excluded.sqlstate_code
      where material_inventory_rejections.status='pending';
     return jsonb_build_object('materialRejected',true,'operationId',p_operation_id,
      'message',failure || ' El material no se registro y el cierre sigue pendiente. Solicita la entrega y reintenta la misma operacion; si fue un error, pide a administracion revisar y anular el intento.');
   when sqlstate '22023' then
     -- Mismo patron exacto que P1650 (arriba) -- unica diferencia: el motivo
     -- es una validacion de entrada/negocio, nunca custodia insuficiente.
     get stacked diagnostics failure=message_text;
     insert into public.material_inventory_rejections(operation_id,job_type,job_id,actor_id,action,payload,message,sqlstate_code)
      values(p_operation_id,p_job_type,p_job_id,auth.uid(),p_action,p_payload,failure,'22023')
      on conflict(operation_id) do update set message=excluded.message,payload=excluded.payload,sqlstate_code=excluded.sqlstate_code
      where material_inventory_rejections.status='pending';
     return jsonb_build_object('materialRejected',true,'operationId',p_operation_id,
      'message',failure || ' El material no se registro. Revisa el dato marcado e intenta de nuevo; si el problema persiste, pide a administracion revisar el intento.');
 end;
 update public.material_inventory_rejections set status='resolved',resolved_at=clock_timestamp(),resolved_by=auth.uid(),payload=p_payload
  where operation_id=p_operation_id and status='pending';
 return result;
end $$;
commit;

-- Reversion: restaurar exactamente el cuerpo de 20261020130000 (quitar la
-- rama "when sqlstate '22023'" y las 2 referencias a sqlstate_code del
-- INSERT de P1650) y, si se desea, ALTER TABLE
-- public.material_inventory_rejections DROP COLUMN sqlstate_code (nullable
-- y aditiva; quitarla no pierde ninguna fila previa).
