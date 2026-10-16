-- LOCAL únicamente. Requiere Fase 162; no aplicar en Cloud sin revisión.
begin;
do $$
begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)')
   and md5(regexp_replace(regexp_replace(replace(prosrc,E'\r',''),'--[^\n]*','','g'),'[[:space:]]','','g'))='e453cb545001f13fb373d2a1569725c7') then
   raise exception 'RPC Fase 162 ausente o distinta de la revisada; detener sin modificarla';
 end if;
end $$;

create or replace function public.routine_inventory_operation(p_routine_id uuid,p_operation_id uuid,p_action text,p_payload jsonb)
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
 select * into r from public.routines where id=p_routine_id for update;
 if not found then raise exception 'Rutina inexistente'; end if;
 if p_action in ('approve','reject','receive') then
   if staff not in ('SUPERADMIN','ADMIN','SOPORTE') then raise exception 'Aprobacion/recepcion exclusiva de oficina'; end if;
 elsif p_action in ('consume','correct','remove','install','withdraw','unlink') then
   if staff<>'TECNICO_RED' then raise exception 'Tecnico activo requerido'; end if;
   perform 1 from public.job_assignees where job_type='routine' and job_id=r.id for update;
   if not exists(select 1 from public.job_assignees where job_type='routine' and job_id=r.id and technician_id=uid) then raise exception 'No pertenece a la cuadrilla'; end if;
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
end $$;

-- CREATE OR REPLACE conserva firma, propietario y ACL; no se amplían grants.
commit;
