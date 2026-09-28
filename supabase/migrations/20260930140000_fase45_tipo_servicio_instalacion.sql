-- SmartRayco — Fase 45: tipo de servicio (Internet/Combo vs Solo IPTV) y
-- validacion de cierre de instalaciones.
--
-- No todas las instalaciones requieren equipo fisico: "Solo IPTV" es un
-- cliente que ya tiene internet de otro proveedor y solo activa su cuenta
-- IPTV en su propio Smart TV (sin ONT/TV Box ni materiales de ferreteria).
-- El tipo se guarda en service_contracts (no en installations): es un
-- atributo del servicio contratado (Fase 37: servicios independientes), no
-- de una visita puntual — si el mismo servicio se revisita, el tipo no se
-- pierde.
--
-- Todos los service_contracts existentes se quedan en 'internet_combo' por
-- default (comportamiento actual, verificado: hoy ningun contrato es
-- Solo-IPTV, todos tienen plan_id).
--
-- Idempotente: permite re-ejecutar el archivo completo sin error si una
-- corrida anterior ya creo parte de estos objetos.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_service_type') then
    create type public.contract_service_type as enum ('internet_combo', 'solo_iptv');
  end if;
end
$$;

alter table public.service_contracts
  add column if not exists service_type public.contract_service_type not null default 'internet_combo';

-- Nota del tecnico para "Solo IPTV" (usuario/cuenta IPTV en el Smart TV del
-- cliente) — anotacion libre de la visita, no la credencial real (esa vive
-- en service_contracts.xui_username/xui_line_id, gestionada aparte via XUI).
alter table public.installations
  add column if not exists iptv_account_note text;

-- Bloquea el cierre ('completed') de una instalacion Internet/Combo sin al
-- menos un equipo (ONT/TV Box) actualmente asignado por serie/MAC
-- (inventory_units.installation_id = esta instalacion). "Solo IPTV" queda
-- exenta. Sin contrato vinculado se asume 'internet_combo' (conservador,
-- igual al comportamiento actual). Mismo patron que apply_inventory_movement
-- / apply_inventory_unit_event (Fase 11/11c): la regla vive en el trigger,
-- no solo en el frontend, para que ningun camino (ni el selector de estado
-- directo de SUPERADMIN/ADMIN, que no pasa por el modal "Completar") la
-- pueda saltar.
create or replace function public.validate_installation_completion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  svc_type public.contract_service_type := 'internet_combo';
  unit_count integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.contract_id is not null then
      select service_type into svc_type from public.service_contracts where id = new.contract_id;
    end if;

    if coalesce(svc_type, 'internet_combo') = 'internet_combo' then
      select count(*) into unit_count from public.inventory_units where installation_id = new.id;
      if unit_count = 0 then
        raise exception 'Para instalaciones de internet/combo debes asignar al menos un equipo por Serie/MAC';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_installations_validate_completion on public.installations;
create trigger trg_installations_validate_completion
  before update on public.installations
  for each row execute procedure public.validate_installation_completion();
