-- CANDIDATO LOCAL. No aplicar sin autorización. Sin DML/backfill histórico.
begin;
set local lock_timeout='5s';
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.validate_installation_completion()')
 and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='e452ec213962f70d8db289ac17ed361f') then
 raise exception 'El trigger de cierre difiere del revisado; detener y comparar';
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.installations'::regclass
  and tgname='trg_installations_validate_completion' and tgfoid=to_regprocedure('public.validate_installation_completion()')
  and tgtype=19 and tgqual is null and tgenabled in ('O','A'))
 or to_regprocedure('public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)') is null then
  raise exception 'Faltan las guardas de cierre o lectura contextual revisadas; detener';
 end if;
end $$;
alter table public.installations add column if not exists iptv_policy_version smallint;
alter table public.installations add column if not exists iptv_installation_mode text;
alter table public.installations add column if not exists closure_operation_id uuid;
alter table public.installations add column if not exists closure_payload_hash text;
-- DEFAULT posterior al ADD: las filas existentes conservan NULL.
alter table public.installations alter column iptv_policy_version set default 1;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.installations'::regclass and conname='installations_iptv_policy_check') then
  alter table public.installations add constraint installations_iptv_policy_check check(iptv_policy_version is null or iptv_policy_version=1);
  alter table public.installations add constraint installations_iptv_mode_check check(iptv_installation_mode is null or iptv_installation_mode in ('smart_tv_app','customer_device','rayco_tv_box'));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.installations'::regclass and conname='installations_closure_receipt_check') then
  alter table public.installations add constraint installations_closure_receipt_check check(
   (closure_operation_id is null and closure_payload_hash is null) or
   (closure_operation_id is not null and closure_payload_hash is not null and closure_payload_hash ~ '^[a-f0-9]{64}$'));
 end if;
end $$;

create or replace function public.guard_installation_iptv_policy()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_op='INSERT' then
  new.iptv_policy_version:=1;
  if new.status::text in ('completed','cancelled') then
   raise exception 'Crea la nueva Alta abierta y completa sus validaciones antes de cerrarla' using errcode='PIP00';
  end if;
 elsif new.iptv_policy_version is distinct from old.iptv_policy_version then
  raise exception 'La regla IPTV de la orden no se puede cambiar' using errcode='PIP01';
 elsif old.iptv_policy_version is null and (new.iptv_installation_mode,new.closure_operation_id,new.closure_payload_hash) is distinct from (old.iptv_installation_mode,old.closure_operation_id,old.closure_payload_hash) then
  raise exception 'No se modifica la modalidad IPTV de órdenes anteriores' using errcode='PIP02';
 elsif old.status::text in ('completed','cancelled') and (new.iptv_installation_mode,new.closure_operation_id,new.closure_payload_hash) is distinct from (old.iptv_installation_mode,old.closure_operation_id,old.closure_payload_hash) then
  raise exception 'La modalidad IPTV de una orden cerrada no se puede cambiar' using errcode='PIP03';
 elsif (new.client_id,new.contract_id) is distinct from (old.client_id,old.contract_id) and new.iptv_installation_mode is not null then
  raise exception 'El cliente o contrato cambió; revisa la modalidad IPTV antes del cierre' using errcode='PIP04';
 end if;
 return new;
end $$;
revoke all on function public.guard_installation_iptv_policy() from public,anon,authenticated,service_role;
drop trigger if exists b_installation_iptv_insert on public.installations;
drop trigger if exists b_installation_iptv_update on public.installations;
create trigger b_installation_iptv_insert before insert on public.installations for each row execute function public.guard_installation_iptv_policy();
create trigger b_installation_iptv_update before update on public.installations for each row execute function public.guard_installation_iptv_policy();

-- Validador interno compartido por preflight y trigger; no concede escrituras.
create or replace function public.assert_installation_iptv_mode(p_installation_id uuid,p_client_id uuid,p_contract_id uuid,p_mode text)
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare c public.service_contracts%rowtype;
begin
 select * into c from public.service_contracts where id=p_contract_id for share;
 if not found or c.client_id is distinct from p_client_id then
  raise exception 'El contrato vinculado no corresponde al cliente de esta instalación' using errcode='P1662';
 end if;
 if c.service_type::text<>'internet_combo' or c.xui_line_id is null then
  if p_mode is not null then raise exception 'Esta orden no corresponde a una instalación Dúo con IPTV vinculada' using errcode='PIP05'; end if;
  return;
 end if;
 if p_mode is null or p_mode not in ('smart_tv_app','customer_device','rayco_tv_box') then
  raise exception 'Selecciona cómo se instaló IPTV: Smart TV, dispositivo propio o TV Box Rayco' using errcode='PIP06';
 end if;
 -- Mismo orden de bloqueo que campo_inventory_operation: orden, contrato,
 -- unidades. La RPC de inventario ya bloquea la orden antes de asignar/quitar.
 perform u.id from public.inventory_units u where u.installation_id=p_installation_id order by u.id for share;
 if p_mode='rayco_tv_box' then
  if not exists(select 1 from public.inventory_units u
   join public.inventory_products p on p.id=u.product_id
   join public.inventory_categories k on k.id=p.category_id
   where u.installation_id=p_installation_id and u.client_id=p_client_id and u.contract_id=p_contract_id
    and u.status::text='assigned' and k.slug='tvbox'
    and (nullif(btrim(u.serial_number),'') is not null or nullif(btrim(u.mac_address),'') is not null)
    and exists(select 1 from public.inventory_unit_events e where e.unit_id=u.id
     and e.installation_id=p_installation_id and e.client_id=p_client_id and e.contract_id=p_contract_id
     and e.from_status::text='with_technician' and e.to_status::text='assigned')) then
   raise exception 'Asigna un TV Box Rayco con serie/MAC desde custodia al mismo cliente, contrato y orden' using errcode='PIP07';
  end if;
 elsif exists(select 1 from public.inventory_units u
   join public.inventory_products p on p.id=u.product_id join public.inventory_categories k on k.id=p.category_id
   where u.installation_id=p_installation_id and k.slug='tvbox' and u.status::text in ('assigned','pending_approval')) then
  raise exception 'Hay un TV Box Rayco vinculado a esta Alta; revisa la modalidad y el equipo antes de cerrar' using errcode='PIP08';
 end if;
end $$;
revoke all on function public.assert_installation_iptv_mode(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.assert_material_closure_ready(text,uuid)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^'||chr(10)||']*','','g'),'[[:space:]]','','g'))='729872fe0cba0b2b84315a8146a08528')
  or to_regprocedure('public.assert_material_closure_ready_iptv_legacy(text,uuid)') is not null then
  raise exception 'La prevalidacion de cierre difiere de la revisada; detener';
 end if;
end $$;
alter function public.assert_material_closure_ready(text,uuid) rename to assert_material_closure_ready_iptv_legacy;
revoke all on function public.assert_material_closure_ready_iptv_legacy(text,uuid) from public,anon,authenticated,service_role;
create function public.assert_material_closure_ready(p_job_type text,p_job_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 perform public.assert_material_closure_ready_iptv_legacy(p_job_type,p_job_id);
 if p_job_type='installation' and exists(select 1 from public.installations where id=p_job_id and iptv_policy_version=1) then
  raise exception 'Actualiza Campo para confirmar este cierre y su modalidad IPTV. Los pendientes guardados se conservan' using errcode='PIP09';
 end if;
end $$;
revoke all on function public.assert_material_closure_ready(text,uuid) from public,anon;
grant execute on function public.assert_material_closure_ready(text,uuid) to authenticated,service_role;

create or replace function public.installation_iptv_preflight(p_installation_id uuid,p_contract_id uuid,p_mode text,p_operation_id uuid,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare i public.installations%rowtype;
begin
 -- Reutiliza exactamente permisos, perfil activo y cuadrilla vigentes de
 -- la consulta contextual. No concede acceso global al inventario.
 -- Conserva la prevalidación original completa (perfil, estado, cuadrilla,
 -- materiales) y toma su lock de orden ANTES de los locks de lectura.
 perform public.assert_material_closure_ready_iptv_legacy('installation',p_installation_id);
 perform public.inventory_order_read('installation',p_installation_id,'assigned',0);
 select * into strict i from public.installations where id=p_installation_id for update;
 if i.status::text in ('completed','cancelled') then raise exception 'La orden ya está cerrada' using errcode='PIP03'; end if;
 if i.contract_id is distinct from p_contract_id then raise exception 'El contrato de la orden cambió; recarga antes de cerrar' using errcode='PIP04'; end if;
 if i.iptv_policy_version is distinct from 1 then raise exception 'Esta orden conserva la regla anterior de instalación' using errcode='PIP02'; end if;
 perform public.assert_installation_iptv_mode(i.id,i.client_id,i.contract_id,p_mode);
 if p_operation_id is null or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$' then
  raise exception 'Actualiza Campo para identificar el envío de cierre; conserva sus datos' using errcode='PIP10';
 end if;
 return jsonb_build_object('valid',true,'installationId',i.id,'clientId',i.client_id,'contractId',i.contract_id,'mode',p_mode,
  'operationId',p_operation_id,'payloadHash',p_payload_hash,'materialChecked',true);
end $$;
revoke all on function public.installation_iptv_preflight(uuid,uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.installation_iptv_preflight(uuid,uuid,text,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.validate_installation_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  svc_type public.contract_service_type := 'internet_combo';
  contract_zone_id uuid;
  contract_client_id uuid;
  contract_xui_line_id integer;
  nap_count integer;
  ont_count integer;
  tvbox_count integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.contract_id is null then
      raise exception 'Esta instalación no tiene un contrato vinculado; vincula uno antes de completarla (se necesita para mapear la Zona y la Caja NAP)';
    end if;

    select service_type, zone_id, client_id, xui_line_id
      into svc_type, contract_zone_id, contract_client_id, contract_xui_line_id
    from public.service_contracts where id = new.contract_id;

    if contract_client_id is null or contract_client_id is distinct from new.client_id then
      raise exception 'El contrato vinculado no corresponde al cliente de esta instalación; pide revisión administrativa antes de completarla' using errcode = 'P1662';
    end if;

    if new.iptv_policy_version=1 then
      perform public.assert_installation_iptv_mode(new.id,new.client_id,new.contract_id,new.iptv_installation_mode);
      if new.closure_operation_id is null or new.closure_payload_hash is null or new.closure_payload_hash !~ '^[a-f0-9]{64}$' then
       raise exception 'Actualiza Campo para identificar el envío de cierre; conserva sus datos' using errcode='PIP10';
      end if;
    end if;

    if coalesce(svc_type, 'internet_combo') = 'internet_combo' then
      select count(*) into ont_count
      from public.inventory_units u
      join public.inventory_products p on p.id = u.product_id
      join public.inventory_categories c on c.id = p.category_id
      where u.installation_id = new.id
        and u.status = 'assigned'
        and u.client_id = new.client_id
        and u.contract_id = new.contract_id
        and c.slug = 'onu';
      if ont_count = 0 then
        raise exception 'Para instalaciones de internet/combo debes asignar un ONT/Módem por Serie/MAC válido (del mismo cliente y contrato) antes de completarla' using errcode = 'P1660';
      end if;

      if contract_xui_line_id is not null and (new.iptv_policy_version is distinct from 1 or new.iptv_installation_mode='rayco_tv_box') then
        select count(*) into tvbox_count
        from public.inventory_units u
        join public.inventory_products p on p.id = u.product_id
        join public.inventory_categories c on c.id = p.category_id
        where u.installation_id = new.id
          and u.status = 'assigned'
          and u.client_id = new.client_id
          and u.contract_id = new.contract_id
          and c.slug = 'tvbox';
        if tvbox_count = 0 then
          raise exception 'Este servicio incluye IPTV -- debes asignar un TV Box por Serie/MAC válido (del mismo cliente y contrato) antes de completarla' using errcode = 'P1661';
        end if;
      end if;
    end if;

    if contract_zone_id is null then
      raise exception 'Debes asignar la Zona del servicio antes de completar la instalación';
    end if;

    select count(*) into nap_count
    from public.fo_nap_puertos
    where contract_id = new.contract_id and estado = 'ocupado';
    if nap_count = 0 then
      raise exception 'Debes asignar la Caja NAP del servicio antes de completar la instalación';
    end if;
  end if;

  return new;
end;
$function$
;
notify pgrst,'reload schema';
commit;
