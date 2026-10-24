-- PROPUESTA LOCAL PARA REVISIÓN. NO ES UNA MIGRACIÓN NI SE HA APLICADO EN PRODUCCIÓN.
-- Instalar sólo tras revisar propietario, triggers/RLS y respaldo del entorno destino.
begin;

create function public.client_retirement_actor_admin() returns boolean
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN'));
$$;
revoke all on function public.client_retirement_actor_admin() from public,anon,authenticated,service_role;

create function public.client_retirement_write_allowed(p_id uuid,p_status public.client_status) returns boolean
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
 select case when coalesce(public.current_user_role()::text,'') not in ('ADMIN','SUPERADMIN','SOPORTE','FACTURACION','TECNICO_RED') then false
 else p_status<>'retired' or public.client_retirement_actor_admin()
   or exists(select 1 from public.clients where id=p_id and status='retired') end;
$$;
revoke all on function public.client_retirement_write_allowed(uuid,public.client_status) from public,anon,service_role;
grant execute on function public.client_retirement_write_allowed(uuid,public.client_status) to authenticated;

create function public.client_retirement_preview(p_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare c public.clients%rowtype; contracts jsonb; opened jsonb; token text;
begin
 if not public.client_retirement_actor_admin() then raise exception 'La baja definitiva requiere ADMIN/SUPERADMIN activo' using errcode='42501'; end if;
 select * into c from public.clients where id=p_client_id;
 if not found then raise exception 'Cliente no encontrado' using errcode='PBR04'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'number',s.contract_number,'code',s.client_code,
  'status',s.status,'updatedAt',s.updated_at,'serviceType',s.service_type,
  'pppoeLinked',s.mikrotik_device_id is not null or s.pppoe_username is not null,
  'iptvLinked',s.xui_line_id is not null,
  'ontLinked',exists(select 1 from public.olt_onts o where o.contract_id=s.id or (o.client_id=c.id and o.contract_id is null))) order by s.id),'[]')
 into contracts from public.service_contracts s where s.client_id=c.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'status',i.status,'contractId',i.contract_id) order by i.id),'[]')
 into opened from public.installations i where i.status::text in ('pending','scheduled','in_progress')
 and (i.client_id=c.id or i.contract_id in (select id from public.service_contracts where client_id=c.id));
 token:=md5(jsonb_build_object('clientId',c.id,'status',c.status,'updatedAt',c.updated_at,'contracts',contracts)::text);
 return jsonb_build_object('clientId',c.id,'name',concat_ws(' ',c.first_name,c.last_name),'status',c.status,
  'token',token,'contracts',contracts,'openInstallations',opened,'networkReviewRequired',true,
  'linkedEquipmentCount',(select count(*) from public.inventory_units u where u.client_id=c.id
    or u.contract_id in (select id from public.service_contracts where client_id=c.id)));
end $$;
revoke all on function public.client_retirement_preview(uuid) from public,anon,service_role;
grant execute on function public.client_retirement_preview(uuid) to authenticated;

create function public.client_retire_atomic(p_client_id uuid,p_preview_token text,p_contract_ids uuid[],p_confirm_all boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp set lock_timeout='3s' as $$
declare preview jsonb; affected uuid[]; confirmed uuid[]; previous_context text; changed integer;
begin
 -- Bloquea la cuenta/rol hasta el commit; no confía en la caché del middleware.
 perform 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN') for share;
 if not found then raise exception 'La baja definitiva requiere ADMIN/SUPERADMIN activo' using errcode='42501'; end if;
 if p_confirm_all is distinct from true then raise exception 'Confirme explícitamente todos los contratos afectados' using errcode='PBR01'; end if;
 perform 1 from public.clients where id=p_client_id for update;
 if not found then raise exception 'Cliente no encontrado' using errcode='PBR04'; end if;
 perform 1 from public.service_contracts where client_id=p_client_id order by id for update;
 perform 1 from public.installations where client_id=p_client_id
  or contract_id in (select id from public.service_contracts where client_id=p_client_id) order by id for update;
 preview:=public.client_retirement_preview(p_client_id);
 if jsonb_array_length(preview->'openInstallations')>0 then
  raise exception 'Hay Altas abiertas; resuélvalas por su flujo autorizado antes de dar la baja' using errcode='PBR02';
 end if;
 if p_preview_token is null or p_preview_token is distinct from preview->>'token' then
  raise exception 'La ficha o sus contratos cambiaron; vuelva a revisar y confirmar' using errcode='PBR03';
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into affected from public.service_contracts where client_id=p_client_id and status<>'cancelled';
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into confirmed from unnest(p_contract_ids) id;
 if p_contract_ids is null or confirmed is distinct from affected then
  raise exception 'La lista confirmada no coincide con todos los contratos vigentes' using errcode='PBR03';
 end if;
 previous_context:=current_setting('app.client_retirement_id',true);
 perform set_config('app.client_retirement_id',p_client_id::text,true);
 update public.service_contracts set status='cancelled' where client_id=p_client_id and status<>'cancelled';
 get diagnostics changed=row_count;
 update public.clients set status='retired' where id=p_client_id;
 perform set_config('app.client_retirement_id',coalesce(previous_context,''),true);
 return jsonb_build_object('clientId',p_client_id,'status','retired','cancelledContractIds',to_jsonb(affected),
  'cancelledCount',changed,'networkReviewRequired',true,'operationalNetworkActionsExecuted',false);
 -- Sin manejador que absorba errores: cualquier fallo revierte ambas tablas.
end $$;
revoke all on function public.client_retire_atomic(uuid,text,uuid[],boolean) from public,anon,service_role;
grant execute on function public.client_retire_atomic(uuid,text,uuid[],boolean) to authenticated;

create function public.client_retirement_guard_client() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare owner_name text;
begin
 if tg_op='INSERT' then
  if new.status='retired' then raise exception 'Cree la ficha sin Baja y utilice la operación de baja definitiva' using errcode='PBR01'; end if;
 elsif new.status='retired' and old.status is distinct from new.status then
  select pg_get_userbyid(proowner) into owner_name from pg_catalog.pg_proc where oid='public.client_retire_atomic(uuid,text,uuid[],boolean)'::regprocedure;
  -- Un GUC enviado por un cliente no basta: se exige ejecución con el propietario del RPC.
  if current_user<>owner_name or current_setting('app.client_retirement_id',true) is distinct from new.id::text then
   raise exception 'Utilice la baja definitiva transaccional, no una actualización directa' using errcode='42501';
  end if;
  if not public.client_retirement_actor_admin() then raise exception 'Sin permisos para dar de baja' using errcode='42501'; end if;
  if exists(select 1 from public.service_contracts where client_id=new.id and status<>'cancelled')
   or exists(select 1 from public.installations i where i.status::text in ('pending','scheduled','in_progress')
    and (i.client_id=new.id or i.contract_id in (select id from public.service_contracts where client_id=new.id))) then
   raise exception 'No se permite una baja con servicios vigentes o Altas abiertas' using errcode='PBR02';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.client_retirement_guard_client() from public,anon,authenticated,service_role;

create function public.client_retirement_guard_child() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare parent_status public.client_status; parent_id uuid; old_parent uuid; ct_client uuid;
begin
 if tg_op='UPDATE' then
  old_parent:=old.client_id;
  if tg_table_name='service_contracts' then
   if new.client_id=old.client_id and new.status=old.status then return new; end if;
  elsif tg_table_name='installations' then
   if new.client_id=old.client_id and new.contract_id is not distinct from old.contract_id and new.status=old.status then return new; end if;
  end if;
 end if;
 -- Serializa nuevos contratos/Altas y cambios de estado con la baja del titular.
 for parent_id in select id from public.clients where id in (new.client_id,old_parent) order by id for update loop null; end loop;
 select status into parent_status from public.clients where id=new.client_id;
 if parent_status is null then raise exception 'No se puede validar el cliente bajo los permisos actuales' using errcode='42501'; end if;
 if tg_table_name='service_contracts' then
  if new.status<>'cancelled' and parent_status='retired' then raise exception 'Cliente retirado: requiere un flujo de reincorporación autorizado' using errcode='PBR02'; end if;
 elsif new.status::text in ('pending','scheduled','in_progress') then
  if parent_status='retired' then raise exception 'No se permite un Alta abierta para un cliente retirado' using errcode='PBR02'; end if;
  if new.contract_id is not null then
   select client_id into ct_client from public.service_contracts where id=new.contract_id;
   if ct_client is distinct from new.client_id then raise exception 'El contrato del Alta no pertenece al cliente' using errcode='PBR02'; end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.client_retirement_guard_child() from public,anon,authenticated,service_role;

-- Políticas RESTRICTIVE adicionales: conservan las policies existentes y el acceso
-- a datos de contacto de fichas ya retiradas. La transición nueva sigue protegida por trigger.
create policy client_retirement_update_guard on public.clients as restrictive for update to authenticated
 using (true) with check (public.client_retirement_write_allowed(id,status));
create policy client_retirement_insert_guard on public.clients as restrictive for insert to authenticated
 with check (status<>'retired');
create trigger client_retirement_guard_client before insert or update of status on public.clients
 for each row execute function public.client_retirement_guard_client();
create trigger client_retirement_guard_contract before insert or update of client_id,status on public.service_contracts
 for each row execute function public.client_retirement_guard_child();
create trigger client_retirement_guard_installation before insert or update of client_id,contract_id,status on public.installations
 for each row execute function public.client_retirement_guard_child();
commit;
