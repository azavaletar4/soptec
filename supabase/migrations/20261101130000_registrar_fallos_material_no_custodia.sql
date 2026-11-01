-- CANDIDATA LOCAL, SIN APLICAR. Requiere autorizacion expresa y, antes de
-- aplicar, verificar por hash que execute_tracked_material_inventory en
-- produccion sigue siendo EXACTAMENTE la version de 20261019170000 (mismo
-- patron de guarda que el resto de migraciones de Fase 165-169) -- esta
-- candidata NO incluye esa verificacion todavia porque prepararla no
-- requirio leer produccion; aplicarla SI lo requiere.
--
-- OBJETIVO (estabilizacion 2026-11-01, punto 2 del pedido: garantizar la
-- condicion tambien en backend/DB, no solo en Vue):
--
-- Confirmado por lectura de codigo (campo_inventory_operation_f165_impl /
-- routine_inventory_operation_f165_impl, 20261019160000): HOY, un intento
-- de 'consume'/'kit'/'correct' que falla por una razon DISTINTA a falta de
-- custodia (P1650) -- por ejemplo "Producto no admite consumo de material"
-- (producto inactivo/serializado), "Cantidad invalida", "Kit invalido" --
-- NO queda registrado en absoluto: ni Kardex, ni custodia, ni una fila en
-- material_inventory_rejections. Es la misma atomicidad correcta (nada
-- parcial), pero deja CERO rastro para administracion -- justo el patron
-- que el caso Jadir/UTP (auditoria 2026-11-01) no pudo descartar por
-- falta de evidencia. Esta candidata NO intenta resolver ese caso puntual
-- (fuera de alcance, restriccion expresa) -- cierra el hueco estructural
-- para que un caso futuro similar SI deje evidencia.
--
-- ALCANCE DELIBERADAMENTE ACOTADO: solo errcode '22023' (validacion de
-- entrada/negocio, siempre la misma causa determinista sin importar
-- reintentos: cantidad invalida, producto no admite consumo, kit invalido,
-- campo no permitido, motivo demasiado largo, solicitud invalida). NO se
-- agrega 'others' ni '42501' a proposito:
--  - '42501' (permisos/autorizacion: "La orden no admite nuevas
--    operaciones", "Asignacion no vigente", acceso denegado) debe seguir
--    siendo un fallo visible y distinto -- convertirlo en una fila de
--    rechazo "silenciosa" podria disfrazar un intento de acceso indebido
--    como un simple problema de inventario.
--  - cualquier otro codigo (ej. '55P03' bloqueo ocupado, fallos de
--    serializacion/sistema) debe seguir propagandose tal cual -- el
--    cliente YA tiene manejo especifico para '55P03'
--    (src/lib/fieldInventoryOperation.ts); capturarlo aqui y devolver 200
--    con un JSON lo escondaria de ese manejo existente.
--
-- NO CAMBIA el bloqueo de cierre (assert_no_rejected_materials sigue
-- siendo no-op, Fase 166, decision de negocio ya aprobada -- no se toca).
-- NO cambia ningun mensaje para el caso YA manejado (P1650). Solo agrega
-- una categoria nueva, igual de no-bloqueante, para un tipo de fallo que
-- antes no dejaba ningun rastro.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='material_inventory_rejections' and column_name='sqlstate_code') then
  alter table public.material_inventory_rejections add column sqlstate_code text;
 end if;
end $$;

create or replace function public.execute_tracked_material_inventory(p_operation_id uuid,p_job_type text,p_job_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.material_inventory_rejections; result jsonb; failure text; v_code text;
begin
 if p_job_type='routine' then perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,162)); end if;
 perform public.lock_material_inventory_job(p_job_type,p_job_id);
 select * into previous from public.material_inventory_rejections where operation_id=p_operation_id for update;
 if found then
   if previous.actor_id is distinct from auth.uid() or previous.job_type is distinct from p_job_type
    or previous.job_id is distinct from p_job_id or previous.action is distinct from p_action
    or previous.payload is distinct from p_payload then raise exception 'Identificador de operacion ya utilizado'; end if;
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
     get stacked diagnostics failure=message_text;
     insert into public.material_inventory_rejections(operation_id,job_type,job_id,actor_id,action,payload,message,sqlstate_code)
      values(p_operation_id,p_job_type,p_job_id,auth.uid(),p_action,p_payload,failure,'P1650')
      on conflict(operation_id) do update set message=excluded.message,sqlstate_code=excluded.sqlstate_code;
     return jsonb_build_object('materialRejected',true,'operationId',p_operation_id,
      'message',failure || ' El material no se registro y el cierre sigue pendiente. Solicita la entrega y reintenta la misma operacion; si fue un error, pide a administracion revisar y anular el intento.');
   when sqlstate '22023' then
     -- Validacion deterministica (cantidad/producto/kit/campo/motivo invalidos):
     -- misma causa en cualquier reintento idéntico, igual de segura de registrar
     -- sin bloquear como el caso de custodia -- nunca un fallo de permisos o de
     -- sistema (esos siguen sin capturarse, ver comentario de alcance arriba).
     get stacked diagnostics failure=message_text, v_code=returned_sqlstate;
     insert into public.material_inventory_rejections(operation_id,job_type,job_id,actor_id,action,payload,message,sqlstate_code)
      values(p_operation_id,p_job_type,p_job_id,auth.uid(),p_action,p_payload,failure,v_code)
      on conflict(operation_id) do update set message=excluded.message,sqlstate_code=excluded.sqlstate_code;
     return jsonb_build_object('materialRejected',true,'operationId',p_operation_id,
      'message',failure || ' El material no se registro. Revisa el dato marcado e intenta de nuevo; si el problema persiste, pide a administracion revisar el intento.');
 end;
 update public.material_inventory_rejections set status='resolved',resolved_at=clock_timestamp(),resolved_by=auth.uid()
  where operation_id=p_operation_id and status='pending';
 return result;
end $$;
revoke all on function public.execute_tracked_material_inventory(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
commit;

-- Reversion: restaurar el cuerpo exacto de 20261019170000 (solo el bloque
-- "exception when sqlstate 'P1650'", sin la rama '22023') y
-- ALTER TABLE public.material_inventory_rejections DROP COLUMN sqlstate_code;
-- (la columna es nullable y aditiva; quitarla no pierde ninguna fila previa).
