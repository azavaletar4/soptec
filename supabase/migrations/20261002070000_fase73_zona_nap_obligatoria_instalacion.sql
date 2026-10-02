-- SmartRayco — Fase 73: Zona y Caja NAP obligatorias para completar una
-- instalacion.
--
-- Hasta ahora la Zona/Caja NAP de un servicio (service_contracts.zone_id,
-- fo_nap_puertos — Fase 38) solo se asignaban desde la ficha de cliente
-- (ClientServiceDetailView.vue), bloqueada para TECNICO_RED. El modal
-- "Completar instalación" (InstalacionesView.vue, Fase 64b) es la UNICA via
-- que tiene un tecnico para cerrar una instalacion — si la administracion
-- dejaba la Zona/NAP en blanco al crear el contrato, el cliente quedaba sin
-- su NAP mapeada en la red real, sin ningun aviso.
--
-- Ahora el modal exige elegir Zona y Caja NAP (precargadas si ya las trae el
-- contrato, editables por si el tecnico tuvo que mover al cliente a otra
-- NAP) y las guarda en service_contracts/fo_nap_puertos ANTES de marcar la
-- instalacion como 'completed'. Este trigger es la fuente de verdad real
-- (mismo patron que el chequeo de equipo de la Fase 45): protege tambien el
-- selector de estado directo de SUPERADMIN/ADMIN, que no pasa por el modal.

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
