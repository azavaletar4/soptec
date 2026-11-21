-- Rollback candidato para 20261121190726_fo_cable_endpoint_unlink_guard.sql.
-- Solo revierte objetos de esquema (trigger/funcion/tabla nueva) y restaura
-- el cuerpo EXACTO de remove_from_network_map previo a esta migracion --
-- texto verificado byte a byte contra pg_get_functiondef() de produccion el
-- 21/11/2026 antes de preparar esta publicacion. No borra ni modifica
-- ninguna fila de fo_cables/infra_elementos: las desvinculaciones que ya se
-- hayan hecho con la nueva funcion quedan como estan (son operaciones reales
-- y auditadas, no un efecto secundario a deshacer). Candidato local; no
-- ejecutar sin autorizacion expresa.

drop trigger if exists trg_cable_endpoint_unlink_guard on public.fo_cables;
drop function if exists public.guard_cable_endpoint_unlink();
drop table if exists public.fo_cable_endpoint_unlink_log;

create or replace function public.remove_from_network_map(p_kind text, p_id uuid, p_token text, p_hilo integer default null::integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $function$
declare s jsonb; at_time timestamptz=clock_timestamp(); fusion_ids uuid[];
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception using errcode='42501',message='Solo SUPERADMIN puede eliminar elementos del mapa.'; end if;
  perform set_config('lock_timeout','2s',true);
  -- Orden fijo. También estabiliza asignaciones y órdenes entre resumen y baja.
  -- Estas dos tablas se bloquean brevemente; nunca se escriben.
  lock table public.infra_elementos,public.fo_cables,public.fo_hilo_estados,public.fo_fusiones,public.fo_nap_puertos,public.routines in share row exclusive mode;
  s=public.map_removal_snapshot(p_kind,p_id,p_hilo);
  if p_token is distinct from md5(s::text) then raise exception using errcode='40001',message='Las relaciones cambiaron. Revisa de nuevo el resumen antes de confirmar.'; end if;
  select coalesce(array_agg((f->>'id')::uuid),'{}') into fusion_ids from jsonb_array_elements(s->'fusiones') f;
  update public.fo_fusiones set map_removed_at=at_time where id=any(fusion_ids) and map_removed_at is null;
  if p_kind='infra' then
    update public.infra_elementos set map_removed_at=at_time where id=p_id;
  elsif p_kind='cable' then
    update public.fo_cables set map_removed_at=at_time where id=p_id;
  else
    insert into public.fo_hilo_estados(cable_id,hilo_index,map_removed_at) values(p_id,p_hilo,at_time)
      on conflict(cable_id,hilo_index) do update set map_removed_at=excluded.map_removed_at;
  end if;
  return jsonb_build_object('id',p_id,'kind',p_kind,'hilo',p_hilo,'removedAt',at_time,'fusionIds',to_jsonb(fusion_ids),
    'thread',case when p_kind='hilo' then (select to_jsonb(h) from public.fo_hilo_estados h where cable_id=p_id and hilo_index=p_hilo) end);
end $function$;
