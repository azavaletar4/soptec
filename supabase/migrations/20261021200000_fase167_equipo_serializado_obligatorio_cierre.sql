-- CANDIDATO LOCAL, SIN APLICAR. Fase 167: completa la seguridad del cierre
-- de Altas que empezo Fase 166 (20261021190000) -- esa fase dejo de
-- bloquear el cierre por materiales NO serializados pendientes de
-- regularizar; esta fase hace exactamente lo contrario para los EQUIPOS
-- SERIALIZADOS obligatorios: los valida con mas rigor, nunca los relaja.
--
-- RUTA REAL revisada (sin asumir nombres de columna, confirmado contra
-- Supabase de produccion antes de escribir esto):
-- - El cierre real de una Alta desde App de Campo (`performClosureSubmit`,
--   `src/stores/campo.ts`) termina en `installationsStore.updateStatus(id,
--   'completed')` -- un UPDATE directo de `installations.status`. NO pasa
--   por ningun RPC de "cierre" dedicado para equipos.
-- - `installations` ya tiene un trigger BEFORE UPDATE
--   (`trg_installations_validate_completion` ->
--   `validate_installation_completion()`, Fase 45/49/73, VIGENTE en
--   produccion) que corre en CUALQUIER UPDATE a status='completed' --
--   App de Campo, el selector de Estado de ADMIN/SUPERADMIN, o una llamada
--   directa a la API/PostgREST. Es el unico punto que ninguna via puede
--   saltarse -- por eso se extiende AQUI, no en un RPC nuevo.
-- - Hoy esa funcion solo exige "al menos 1 fila en inventory_units con
--   installation_id = esta instalacion" para `internet_combo` -- sin
--   verificar que sea un ONT (categoria real `onu`, confirmado en
--   inventory_categories), que su estado sea `assigned` (no
--   `pending_approval`/`with_technician`/etc.), ni que su `client_id`/
--   `contract_id` coincidan con los de ESTA instalacion. Un equipo
--   vinculado por error a otro contrato (o uno sin aprobar) ya contaba
--   como "equipo asignado".
--
-- CONFIGURACION REAL DEL SERVICIO (no inventada): el schema no tiene una
-- columna "requiere_tv_box" ni tabla de addons -- la unica señal real de
-- que un contrato `internet_combo` incluye IPTV (y por tanto necesita un
-- TV Box, ademas del ONT) es `service_contracts.xui_line_id` (Fase 23,
-- vinculo con la linea IPTV real en XUI). Verificado en produccion: 636
-- contratos `internet_combo` SIN linea IPTV (solo necesitan ONT) contra 76
-- CON linea IPTV vinculada. `solo_iptv` sigue sin exigir equipo (el
-- cliente puede tener ya un Smart TV, sin ONT/TV Box -- Fase 45, sin
-- cambios).
--
-- Impacto real verificado (solo lectura, ANTES de aplicar nada): de las 3
-- Altas internet_combo actualmente abiertas en produccion, 2 estan
-- `scheduled` (el tecnico aun no asigno equipo -- normal, no se ven
-- afectadas hasta que lo intenten completar sin equipo, que es
-- justamente la regla) y 1 es `in_progress` (Diego Villanueva Bernabe,
-- CTR-2026-00727) con su ONT ya asignado correctamente -- pasa la
-- validacion nueva sin cambios.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.validate_installation_completion()')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='4427ab7a21ba1c2a39f46310e4d8086e') then
  raise exception 'validate_installation_completion difiere de la version revisada; detener y comparar';
 end if;
end $$;

create or replace function public.validate_installation_completion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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

    -- El contrato vinculado debe ser del MISMO cliente que la instalacion
    -- -- nunca se asume, se compara contra el dato real (regla 8 de la
    -- migracion OLT: discrepancia entre fuentes -> detener, no adivinar).
    if contract_client_id is null or contract_client_id is distinct from new.client_id then
      raise exception 'El contrato vinculado no corresponde al cliente de esta instalación; pide revisión administrativa antes de completarla' using errcode = 'P1662';
    end if;

    if coalesce(svc_type, 'internet_combo') = 'internet_combo' then
      -- ONT/Módem obligatorio: un equipo de categoria 'onu', vigente
      -- (assigned, nunca pending_approval/with_technician/retired/etc.),
      -- del MISMO cliente y contrato que esta instalacion -- un equipo
      -- vinculado a otro contrato, pendiente de aprobacion, o que ya no
      -- esta asignado NUNCA cuenta como equipo valido.
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

      -- TV Box obligatorio SOLO cuando el servicio incluye una linea IPTV
      -- real vinculada (xui_line_id) -- un combo de solo internet no lo
      -- exige, igual que hoy; "solo_iptv" sigue completamente exento
      -- (puede ya tener Smart TV, sin equipo fisico -- Fase 45).
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
$$;
commit;
