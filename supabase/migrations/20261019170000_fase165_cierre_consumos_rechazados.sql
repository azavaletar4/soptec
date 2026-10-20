-- CANDIDATO LOCAL, SIN APLICAR. Requiere Fase 165 etapa 2.
-- Un RAISE revierte tambien el recibo: capturar SOLO falta de custodia en
-- subtransaccion y persistir el rechazo fuera de ella. Nunca conservar un
-- movimiento parcial. El estado de la orden y el rechazo comparten lock.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='technician_material_custody_events' and column_name='source_movement_id')
 or position('P1650' in pg_get_functiondef('public.apply_technician_material_custody_event()'::regprocedure))=0 then
   raise exception 'Fase 165 de custodia rastreada requerida antes del control de cierre';
 end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.campo_inventory_operation(uuid,text,uuid,text,jsonb)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='b87dae64878a5070ff0c92eb045a9cad')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='bcbea3a41c2635756b6780bdcbf4ce3f')
 or not exists(select 1 from pg_proc where oid=to_regprocedure('public.apply_technician_material_custody_event()')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='9aa95eb9dd3c7ed3bfc3b6b2f6c738b0') then
  raise exception 'Las funciones de custodia difieren del candidato revisado; detener y comparar';
 end if;
end $$;

create table public.material_inventory_rejections (
 operation_id uuid primary key,
 job_type text not null check(job_type in ('installation','ticket','routine')),
 job_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('consume','kit','correct')),
 payload jsonb not null,
 message text not null,
 status text not null default 'pending' check(status in ('pending','resolved','cancelled')),
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id),
 resolution_note text
);
create index material_inventory_rejections_pending on public.material_inventory_rejections(job_type,job_id) where status='pending';
alter table public.material_inventory_rejections enable row level security;
revoke all on public.material_inventory_rejections from public,anon,authenticated;
grant select on public.material_inventory_rejections to authenticated;
create policy material_inventory_rejections_read on public.material_inventory_rejections for select to authenticated
 using (public.current_user_role() in ('ADMIN','SUPERADMIN') or (public.current_user_role()='TECNICO_RED' and actor_id=auth.uid()));

-- Implementaciones existentes: mismos recibos, movimientos y equipos. Solo los
-- wrappers publicos pueden ejecutarlas; tampoco acceso directo por PostgREST.
alter function public.campo_inventory_operation(uuid,text,uuid,text,jsonb) rename to campo_inventory_operation_f165_impl;
alter function public.routine_inventory_operation(uuid,uuid,text,jsonb) rename to routine_inventory_operation_f165_impl;
revoke all on function public.campo_inventory_operation_f165_impl(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.routine_inventory_operation_f165_impl(uuid,uuid,text,jsonb) from public,anon,authenticated;

create function public.lock_material_inventory_job(p_job_type text,p_job_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_job_type='installation' then perform 1 from public.installations where id=p_job_id for update;
 elsif p_job_type='ticket' then perform 1 from public.tickets where id=p_job_id for update;
 elsif p_job_type='routine' then perform 1 from public.routines where id=p_job_id for update;
 else raise exception 'Tipo de orden invalido'; end if;
 if not found then raise exception 'Orden no disponible'; end if;
end $$;
revoke all on function public.lock_material_inventory_job(text,uuid) from public,anon,authenticated;

create function public.execute_tracked_material_inventory(p_operation_id uuid,p_job_type text,p_job_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.material_inventory_rejections; result jsonb; failure text;
begin
 -- Rutinas ya serializa por UUID antes de bloquear la orden: conservar ese orden.
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
 exception when sqlstate 'P1650' then
   -- La subtransaccion descarta recibo, Kardex y cambios provisionales de saldo.
   get stacked diagnostics failure=message_text;
   insert into public.material_inventory_rejections(operation_id,job_type,job_id,actor_id,action,payload,message)
    values(p_operation_id,p_job_type,p_job_id,auth.uid(),p_action,p_payload,failure)
    on conflict(operation_id) do update set message=excluded.message;
   return jsonb_build_object('materialRejected',true,'operationId',p_operation_id,
    'message',failure || ' El material no se registro y el cierre sigue pendiente. Solicita la entrega y reintenta la misma operacion; si fue un error, pide a administracion revisar y anular el intento.');
 end;
 update public.material_inventory_rejections set status='resolved',resolved_at=clock_timestamp(),resolved_by=auth.uid()
  where operation_id=p_operation_id and status='pending';
 return result;
end $$;
revoke all on function public.execute_tracked_material_inventory(uuid,text,uuid,text,jsonb) from public,anon,authenticated;

create function public.campo_inventory_operation(p_operation_id uuid,p_job_type text,p_job_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_action in ('consume','kit','correct') then
   return public.execute_tracked_material_inventory(p_operation_id,p_job_type,p_job_id,p_action,p_payload);
 end if;
 return public.campo_inventory_operation_f165_impl(p_operation_id,p_job_type,p_job_id,p_action,p_payload);
end $$;
revoke all on function public.campo_inventory_operation(uuid,text,uuid,text,jsonb) from public,anon;
grant execute on function public.campo_inventory_operation(uuid,text,uuid,text,jsonb) to authenticated;

create function public.routine_inventory_operation(p_routine_id uuid,p_operation_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_action in ('consume','correct') then
   return public.execute_tracked_material_inventory(p_operation_id,'routine',p_routine_id,p_action,p_payload);
 end if;
 return public.routine_inventory_operation_f165_impl(p_routine_id,p_operation_id,p_action,p_payload);
end $$;
revoke all on function public.routine_inventory_operation(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.routine_inventory_operation(uuid,uuid,text,jsonb) to authenticated;

create function public.assert_no_rejected_materials(p_job_type text,p_job_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.material_inventory_rejections where job_type=p_job_type and job_id=p_job_id and status='pending') then
   raise exception 'No se puede cerrar la orden: hay material que no se registro por falta de custodia. Solicita la entrega y reintenta la operacion pendiente, o pide a administracion revisar un intento equivocado.' using errcode='P1651';
 end if;
end $$;
revoke all on function public.assert_no_rejected_materials(text,uuid) from public,anon,authenticated;

create function public.assert_material_closure_ready(p_job_type text,p_job_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text;
begin
 select role::text into actor_role from public.profiles where id=auth.uid() and active;
 if actor_role is null or actor_role not in ('ADMIN','SUPERADMIN','TECNICO_RED') then raise exception 'Acceso denegado' using errcode='42501'; end if;
 perform public.lock_material_inventory_job(p_job_type,p_job_id);
 if actor_role='TECNICO_RED' and not exists(select 1 from public.job_assignees where job_type=p_job_type and job_id=p_job_id and technician_id=auth.uid() and role in ('leader','support')) then
   raise exception 'Asignacion no vigente' using errcode='42501';
 end if;
 perform public.assert_no_rejected_materials(p_job_type,p_job_id);
end $$;
revoke all on function public.assert_material_closure_ready(text,uuid) from public,anon;
grant execute on function public.assert_material_closure_ready(text,uuid) to authenticated;

create function public.guard_rejected_material_closure()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_table_name='work_order_closures' then
   perform public.lock_material_inventory_job(new.job_type::text,new.job_id);
   perform public.assert_no_rejected_materials(new.job_type::text,new.job_id);
 elsif tg_table_name='installations' then
   if new.status::text='completed' and new.status is distinct from old.status then perform public.assert_no_rejected_materials('installation',new.id); end if;
 elsif tg_table_name='tickets' then
   if new.status::text in ('resolved','closed') and new.status is distinct from old.status then perform public.assert_no_rejected_materials('ticket',new.id); end if;
 elsif tg_table_name='routines' then
   if new.status::text='completed' and new.status is distinct from old.status then perform public.assert_no_rejected_materials('routine',new.id); end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_rejected_material_closure() from public,anon,authenticated;
create trigger guard_material_closure before insert or update on public.work_order_closures for each row execute function public.guard_rejected_material_closure();
create trigger guard_material_installation before update of status on public.installations for each row execute function public.guard_rejected_material_closure();
create trigger guard_material_ticket before update of status on public.tickets for each row execute function public.guard_rejected_material_closure();
create trigger guard_material_routine before update of status on public.routines for each row execute function public.guard_rejected_material_closure();

create function public.cancel_rejected_material_operation(p_operation_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare rejection public.material_inventory_rejections; actor_role text;
begin
 select role::text into actor_role from public.profiles where id=auth.uid() and active;
 if actor_role is null or actor_role not in ('ADMIN','SUPERADMIN') then raise exception 'Solo administracion puede anular un intento equivocado' using errcode='42501'; end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'Escribe el motivo de la anulacion (hasta 500 caracteres)'; end if;
 select * into rejection from public.material_inventory_rejections where operation_id=p_operation_id;
 if not found then raise exception 'Intento no encontrado'; end if;
 perform public.lock_material_inventory_job(rejection.job_type,rejection.job_id);
 select * into rejection from public.material_inventory_rejections where operation_id=p_operation_id for update;
 if rejection.status<>'pending' then raise exception 'El intento ya fue resuelto'; end if;
 update public.material_inventory_rejections set status='cancelled',resolved_at=clock_timestamp(),resolved_by=auth.uid(),resolution_note=btrim(p_reason) where operation_id=p_operation_id;
end $$;
revoke all on function public.cancel_rejected_material_operation(uuid,text) from public,anon;
grant execute on function public.cancel_rejected_material_operation(uuid,text) to authenticated;
commit;
