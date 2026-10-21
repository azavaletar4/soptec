-- Revierte 20261021200000_fase167_equipo_serializado_obligatorio_cierre.sql.
-- Rollback de comportamiento, no de datos: restaura
-- validate_installation_completion() a su version anterior exacta (Fase
-- 73, 20261002070000, vigente en produccion antes de este candidato) --
-- un equipo vuelve a exigirse solo como "al menos 1 fila en
-- inventory_units", sin chequear categoria, estado, ni cliente/contrato.
-- No se tocan equipos ni instalaciones reales.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.validate_installation_completion()')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='e452ec213962f70d8db289ac17ed361f') then
  raise exception 'validate_installation_completion difiere de la aplicada por el candidato Fase 167; detener y comparar antes de revertir';
 end if;
end $$;

create or replace function public.validate_installation_completion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  svc_type public.contract_service_type := 'internet_combo';
  unit_count integer;
  contract_zone_id uuid;
  nap_count integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.contract_id is null then
      raise exception 'Esta instalación no tiene un contrato vinculado; vincula uno antes de completarla (se necesita para mapear la Zona y la Caja NAP)';
    end if;

    select service_type, zone_id into svc_type, contract_zone_id
    from public.service_contracts where id = new.contract_id;

    if coalesce(svc_type, 'internet_combo') = 'internet_combo' then
      select count(*) into unit_count from public.inventory_units where installation_id = new.id;
      if unit_count = 0 then
        raise exception 'Para instalaciones de internet/combo debes asignar al menos un equipo por Serie/MAC';
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
$$;
commit;
