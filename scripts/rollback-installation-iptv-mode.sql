-- CANDIDATO LOCAL. Rollback sin borrar modalidades ni tocar filas.
-- Revertir primero el frontend a la versión previa y pausar cierres.
begin;
set local lock_timeout='5s';
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.validate_installation_completion()')
 and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='aefea82d144a6c6f3218d0f81b43816f') then
 raise exception 'El trigger de cierre difiere del revisado; detener y comparar';
 end if;
end $$;
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

      if contract_xui_line_id is not null then
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
drop trigger b_installation_iptv_insert on public.installations;
alter table public.installations alter column iptv_policy_version drop default;
drop function public.installation_iptv_preflight(uuid,uuid,text,uuid,text);
drop function public.assert_installation_iptv_mode(uuid,uuid,uuid,text);
drop function public.assert_material_closure_ready(text,uuid);
alter function public.assert_material_closure_ready_iptv_legacy(text,uuid) rename to assert_material_closure_ready;
grant execute on function public.assert_material_closure_ready(text,uuid) to authenticated,service_role;
-- Conservar columnas, restricciones y guarda UPDATE: historial inmutable.
notify pgrst,'reload schema';
commit;
