-- Fase: control SUPERADMIN del mapa de red (21/11/2026).
-- Candidata local. Aplicacion productiva sujeta a autorizacion independiente.
--
-- Contexto real: el cable "RAMAL DE 6H" tenia su destino vinculado a una
-- caja NAP de prueba ("borrirar"/"boirrar") nunca eliminada. El propietario
-- confirmo que es basura de prueba y pidio poder (a) desvincular un extremo
-- conectado desde el formulario del cable, con confirmacion y exclusivo de
-- SUPERADMIN, con auditoria de quien lo hizo; y (b) que al eliminar una
-- NAP/MUFA del mapa, los cables que aun la referencian no queden con un
-- enlace colgante.
--
-- No reemplaza ni duplica la baja logica de pasivos ya desplegada
-- (preview_map_removal / remove_from_network_map, SUPERADMIN-only,
-- map_removed_at, con resumen de conexiones/clientes/ordenes antes de
-- confirmar) -- esta migracion SOLO: (1) agrega un guardia nuevo para la
-- desvinculacion manual de un extremo de cable, con su propio historial;
-- (2) corrige remove_from_network_map para que, al retirar un elemento
-- pasivo (kind='infra'), tambien limpie el origen/destino de los cables
-- que todavia apuntaban a el -- sin tocar clientes, contratos, ONT,
-- ordenes, inventario ni equipos OLT/MikroTik/PPPoE.

-- ---------------------------------------------------------------------
-- 1) Historial de desvinculaciones manuales de un extremo de cable.
-- ---------------------------------------------------------------------
create table if not exists public.fo_cable_endpoint_unlink_log (
  id uuid primary key default gen_random_uuid(),
  cable_id uuid not null references public.fo_cables(id),
  extremo text not null check (extremo in ('origen', 'destino')),
  previous_olt_id uuid,
  previous_infra_id uuid,
  unlinked_by uuid not null references auth.users(id),
  unlinked_at timestamptz not null default now()
);
alter table public.fo_cable_endpoint_unlink_log enable row level security;

-- Solo lectura para el mismo personal que ya ve el mapa; nadie inserta
-- directo (solo el trigger, via SECURITY DEFINER).
drop policy if exists fo_cable_endpoint_unlink_log_staff_read on public.fo_cable_endpoint_unlink_log;
create policy fo_cable_endpoint_unlink_log_staff_read on public.fo_cable_endpoint_unlink_log
  for select to authenticated
  using (public.current_user_role() = any (array['SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION']::public.user_role[]));

-- ---------------------------------------------------------------------
-- 2) Guardia: solo SUPERADMIN puede desvincular un extremo YA conectado
--    (pasar de tener olt_id/infra_id a NULL). Cualquier otro cambio de
--    fo_cables (codigo, capacidad, notas, trazado, o asignar una conexion
--    donde antes no habia ninguna) sigue exactamente igual que hoy --
--    gobernado solo por la politica existente fo_cables_staff_only, sin
--    pasar por SUPERADMIN. Reasignar de un elemento real a OTRO elemento
--    real (ninguno de los dos es NULL) tampoco pasa por aqui: no es una
--    desvinculacion, es un cambio de conexion, fuera de este alcance.
-- ---------------------------------------------------------------------
create or replace function public.guard_cable_endpoint_unlink() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  unlinking_origen boolean;
  unlinking_destino boolean;
begin
  unlinking_origen := (old.origen_olt_id is not null or old.origen_infra_id is not null)
    and new.origen_olt_id is null and new.origen_infra_id is null;
  unlinking_destino := (old.destino_olt_id is not null or old.destino_infra_id is not null)
    and new.destino_olt_id is null and new.destino_infra_id is null;

  if not (unlinking_origen or unlinking_destino) then
    return new;
  end if;

  if public.current_user_role() is distinct from 'SUPERADMIN' then
    raise exception using errcode = '42501',
      message = 'Solo SUPERADMIN puede desvincular un extremo ya conectado.';
  end if;

  if unlinking_origen then
    insert into public.fo_cable_endpoint_unlink_log(cable_id, extremo, previous_olt_id, previous_infra_id, unlinked_by)
      values (new.id, 'origen', old.origen_olt_id, old.origen_infra_id, auth.uid());
  end if;
  if unlinking_destino then
    insert into public.fo_cable_endpoint_unlink_log(cable_id, extremo, previous_olt_id, previous_infra_id, unlinked_by)
      values (new.id, 'destino', old.destino_olt_id, old.destino_infra_id, auth.uid());
  end if;
  return new;
end $$;
revoke all on function public.guard_cable_endpoint_unlink() from public, anon, authenticated, service_role;

drop trigger if exists trg_cable_endpoint_unlink_guard on public.fo_cables;
create trigger trg_cable_endpoint_unlink_guard
  before update on public.fo_cables
  for each row execute function public.guard_cable_endpoint_unlink();

-- ---------------------------------------------------------------------
-- 3) Corrige remove_from_network_map: al retirar un elemento pasivo
--    (kind='infra'), limpia origen/destino de los cables que todavia lo
--    referenciaban -- el disparador de (2) NO bloquea esto: esta funcion
--    sigue siendo SECURITY DEFINER y ya exige SUPERADMIN por su cuenta;
--    la limpieza ocurre en la MISMA transaccion que la baja logica, bajo
--    los mismos locks ya tomados (fo_cables incluida). Cuerpo identico al
--    desplegado salvo este agregado -- no cambia ninguna firma ni el
--    comportamiento para kind='cable'/kind='hilo'.
-- ---------------------------------------------------------------------
create or replace function public.remove_from_network_map(p_kind text, p_id uuid, p_token text, p_hilo integer default null::integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s jsonb; at_time timestamptz = clock_timestamp(); fusion_ids uuid[];
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception using errcode='42501',message='Solo SUPERADMIN puede eliminar elementos del mapa.'; end if;
  perform set_config('lock_timeout','2s',true);
  lock table public.infra_elementos,public.fo_cables,public.fo_hilo_estados,public.fo_fusiones,public.fo_nap_puertos,public.routines in share row exclusive mode;
  s=public.map_removal_snapshot(p_kind,p_id,p_hilo);
  if p_token is distinct from md5(s::text) then raise exception using errcode='40001',message='Las relaciones cambiaron. Revisa de nuevo el resumen antes de confirmar.'; end if;
  select coalesce(array_agg((f->>'id')::uuid),'{}') into fusion_ids from jsonb_array_elements(s->'fusiones') f;
  update public.fo_fusiones set map_removed_at=at_time where id=any(fusion_ids) and map_removed_at is null;
  if p_kind='infra' then
    update public.infra_elementos set map_removed_at=at_time where id=p_id;
    -- Nuevo: nunca dejar un cable apuntando a un elemento ya retirado del
    -- mapa. El trigger de (2) (trg_cable_endpoint_unlink_guard) se dispara
    -- solo con este UPDATE y registra el historial el solo -- no se repite
    -- el insert aqui a mano para no duplicar filas de auditoria. El
    -- SUPERADMIN ya quedo verificado arriba, asi que la revalidacion del
    -- trigger siempre pasa; es la misma transaccion/locks ya tomados.
    update public.fo_cables set origen_olt_id=null, origen_infra_id=null where origen_infra_id=p_id;
    update public.fo_cables set destino_olt_id=null, destino_infra_id=null where destino_infra_id=p_id;
  elsif p_kind='cable' then
    update public.fo_cables set map_removed_at=at_time where id=p_id;
  else
    insert into public.fo_hilo_estados(cable_id,hilo_index,map_removed_at) values(p_id,p_hilo,at_time)
      on conflict(cable_id,hilo_index) do update set map_removed_at=excluded.map_removed_at;
  end if;
  return jsonb_build_object('id',p_id,'kind',p_kind,'hilo',p_hilo,'removedAt',at_time,'fusionIds',to_jsonb(fusion_ids),
    'thread',case when p_kind='hilo' then (select to_jsonb(h) from public.fo_hilo_estados h where cable_id=p_id and hilo_index=p_hilo) end);
end $$;
