-- PROPUESTA LOCAL. No ejecutar en producción sin autorización.
-- Independiente de la propuesta de baja global; no cambia red/equipos/puertos.
begin;
create function public.contract_cancel_administrative(p_contract_id uuid,p_updated_at timestamptz,p_confirm boolean)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp set lock_timeout='3s' as $$
declare parent uuid; c public.service_contracts%rowtype; next_status public.client_status;
 previous_context text;
begin
 perform 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN') for share;
 if not found then raise exception 'Requiere ADMIN/SUPERADMIN activo' using errcode='42501'; end if;
 if p_confirm is distinct from true then raise exception 'Confirme la baja administrativa' using errcode='PBA01'; end if;
 select client_id into parent from public.service_contracts where id=p_contract_id;
 if parent is null then raise exception 'Contrato no encontrado' using errcode='PBA04'; end if;
 perform 1 from public.clients where id=parent for update;
 perform 1 from public.service_contracts where client_id=parent order by id for update;
 select * into c from public.service_contracts where id=p_contract_id;
 if not found or c.client_id<>parent then raise exception 'Contrato cambiado; recargue' using errcode='PBA03'; end if;
 -- Repetir una confirmación cuya respuesta se perdió no repite la escritura.
 if c.status='cancelled' then
  return jsonb_build_object('contract',to_jsonb(c),'clientId',parent,'alreadyCancelled',true);
 end if;
 if p_updated_at is null or c.updated_at is distinct from p_updated_at then
  raise exception 'Contrato cambiado; recargue antes de confirmar' using errcode='PBA03';
 end if;
 perform 1 from public.installations where client_id=parent order by id for update;
 if exists(select 1 from public.installations where contract_id=c.id and status::text in ('pending','scheduled','in_progress')) then
  raise exception 'Hay una Alta abierta de esta línea; resuélvala antes de cancelar' using errcode='PBA02';
 end if;
 previous_context:=current_setting('app.client_retirement_id',true);
 -- Compatible con la guarda preparada en 38cec66 si se instalara también.
 perform set_config('app.client_retirement_id',parent::text,true);
 update public.service_contracts set status='cancelled' where id=c.id returning * into c;
 if exists(select 1 from public.service_contracts where client_id=parent and status='active') then next_status:='active';
 elsif exists(select 1 from public.service_contracts where client_id=parent and status='suspended') then next_status:='suspended';
 elsif exists(select 1 from public.installations where client_id=parent and status::text in ('pending','scheduled','in_progress')) then next_status:='prospect';
 else next_status:='retired'; end if;
 update public.clients set status=next_status where id=parent and status is distinct from next_status;
 perform set_config('app.client_retirement_id',coalesce(previous_context,''),true);
 return jsonb_build_object('contract',to_jsonb(c),'clientId',parent,'clientStatus',next_status,'alreadyCancelled',false);
end $$;
revoke all on function public.contract_cancel_administrative(uuid,timestamptz,boolean) from public,anon,service_role;
grant execute on function public.contract_cancel_administrative(uuid,timestamptz,boolean) to authenticated;

create function public.contract_administrative_guard() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare previous_parent uuid; owner_name text; parent_status public.client_status;
begin
 if tg_op='UPDATE' then previous_parent:=old.client_id; end if;
 perform 1 from public.clients where id in (new.client_id,previous_parent) order by id for update;
 select status into parent_status from public.clients where id=new.client_id;
 if parent_status is null then raise exception 'No se puede validar la ficha' using errcode='42501'; end if;
 if new.status<>'cancelled' and parent_status='retired' then raise exception 'Ficha retirada: requiere revisión autorizada' using errcode='PBA02'; end if;
 if new.status='cancelled' and (tg_op='INSERT' or old.status is distinct from new.status) then
  select pg_get_userbyid(proowner) into owner_name from pg_proc where oid='public.contract_cancel_administrative(uuid,timestamptz,boolean)'::regprocedure;
  if current_user<>owner_name or current_setting('app.client_retirement_id',true) is distinct from new.client_id::text then
   raise exception 'Utilice la baja administrativa confirmada' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.contract_administrative_guard() from public,anon,authenticated,service_role;
create trigger contract_administrative_guard before insert or update of status,client_id on public.service_contracts
for each row execute function public.contract_administrative_guard();

create function public.contract_administrative_installation_guard() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare previous_parent uuid; parent_status public.client_status; contract_parent uuid; contract_status public.contract_status;
begin
 if tg_op='UPDATE' then previous_parent:=old.client_id; end if;
 perform 1 from public.clients where id in (new.client_id,previous_parent) order by id for update;
 select status into parent_status from public.clients where id=new.client_id;
 if parent_status is null then raise exception 'No se puede validar la ficha' using errcode='42501'; end if;
 if new.status::text in ('pending','scheduled','in_progress') then
  if parent_status='retired' then raise exception 'Ficha retirada; Alta inconsistente' using errcode='PBA02'; end if;
  if new.contract_id is not null then
   select client_id,status into contract_parent,contract_status from public.service_contracts where id=new.contract_id;
   if contract_parent is distinct from new.client_id or contract_status='cancelled' then raise exception 'Alta incompatible con el contrato' using errcode='PBA02'; end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function public.contract_administrative_installation_guard() from public,anon,authenticated,service_role;
create trigger contract_administrative_installation_guard before insert or update of status,client_id,contract_id on public.installations
for each row execute function public.contract_administrative_installation_guard();
commit;
