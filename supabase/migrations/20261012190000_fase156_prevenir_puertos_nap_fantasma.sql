-- SmartRayco — Fase 156: prevenir puertos NAP "fantasma" a futuro.
--
-- CAUSA RAIZ (confirmada en Fase 155, no se repite la investigacion aqui):
-- fo_nap_puertos.client_id y .contract_id tienen FK "ON DELETE SET NULL"
-- hacia clients/service_contracts. Al eliminar un cliente o un contrato, la
-- fila del puerto NAP queda con client_id/contract_id = null, pero NADA
-- reseteaba "estado" de vuelta a 'libre' — no existia ningun trigger de
-- DELETE en clients ni en service_contracts (confirmado contra
-- information_schema.triggers en la sesion de Fase 155). El puerto quedaba
-- "ocupado" para siempre, sin dueño, inflando el contador de ocupacion.
--
-- Esta migracion es puramente PREVENTIVA — NO toca los puertos fantasma 2-6
-- de NAP - 01 (ni ningun otro ya existente) identificados en Fase 155. No
-- hace ningun backfill ni UPDATE sobre datos existentes. Solo evita que se
-- vuelvan a crear puertos fantasma nuevos a partir de ahora.
--
-- DISEÑO (minimo, dos triggers BEFORE DELETE, uno por tabla):
--
-- 1) trg_service_contracts_free_nap_puerto (BEFORE DELETE en
--    service_contracts): libera (estado='libre', client_id/contract_id=null)
--    el puerto NAP cuyo contract_id = el contrato que se esta borrando.
--    Cubre tanto el borrado directo de UN contrato (un cliente con varios
--    servicios conserva el puerto de sus OTROS contratos — requisito
--    explicito: no liberar asignaciones todavia validas) como el borrado en
--    cascada de TODOS los contratos cuando se elimina el cliente
--    (service_contracts.client_id es "ON DELETE CASCADE": Postgres ejecuta
--    un DELETE real por cada contrato cascadeado, asi que este mismo
--    trigger se dispara una vez por cada uno).
--
-- 2) trg_clients_free_nap_puerto (BEFORE DELETE en clients): libera el
--    puerto NAP cuyo client_id = el cliente que se esta borrando Y QUE NO
--    TIENE contract_id (caso ambiguo de cliente multi-servicio, ver
--    FoNapPuerto.contract_id en src/types/domain.ts — un puerto puede
--    quedar ligado solo al cliente, sin contrato especifico, pendiente de
--    reasignar a mano). Ese puerto no lo alcanza el trigger de
--    service_contracts (no tiene contract_id que coincida), por eso hace
--    falta este segundo trigger. Se dispara ANTES de que el cliente se
--    borre y ANTES de la cascada hacia sus contratos (los BEFORE DELETE del
--    padre corren antes que la cascada hacia los hijos), asi que nunca
--    compite ni se superpone con el trigger de contratos.
--
-- Por que BEFORE DELETE y no AFTER: la propia FK "ON DELETE SET NULL" de
-- Postgres se implementa como un trigger de sistema AFTER DELETE. Si
-- nuestro trigger tambien fuera AFTER, el orden de ejecucion frente al
-- trigger de sistema no esta garantizado — si el de sistema corre primero,
-- client_id/contract_id ya estarian en null y nuestro WHERE ya no
-- encontraria la fila. Con BEFORE DELETE, nuestro codigo corre siempre
-- antes de que exista ninguna ambiguedad: el id que se esta borrando (old.id)
-- todavia coincide exactamente con lo que hay en fo_nap_puertos.
--
-- Solo se tocan puertos con estado='ocupado' — un puerto 'reservado' o
-- 'dañado' que por alguna razon conserve una referencia a este cliente/
-- contrato no se toca (no es una ocupacion real segun Fase 155, pero
-- tampoco es parte de lo que esta fase debe liberar).
--
-- Deja un rastro en "notes" (se agrega, nunca se borra lo que un tecnico ya
-- haya escrito ahi) para que quede visible EN el puerto por que paso a
-- libre, evitando la confusion que motivo la Fase 155.

create or replace function public.free_nap_puerto_on_contract_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.fo_nap_puertos
  set
    estado = 'libre',
    client_id = null,
    contract_id = null,
    notes = trim(both ' | ' from coalesce(notes || ' | ', '')
      || 'Fase 156: liberado automaticamente al eliminar el contrato '
      || old.id::text || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')')
  where contract_id = old.id
    and estado = 'ocupado';
  return old;
end;
$$;

create or replace function public.free_nap_puerto_on_client_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.fo_nap_puertos
  set
    estado = 'libre',
    client_id = null,
    notes = trim(both ' | ' from coalesce(notes || ' | ', '')
      || 'Fase 156: liberado automaticamente al eliminar el cliente '
      || old.id::text || ' (' || to_char(now(), 'YYYY-MM-DD HH24:MI') || ')')
  where client_id = old.id
    and contract_id is null
    and estado = 'ocupado';
  return old;
end;
$$;

drop trigger if exists trg_service_contracts_free_nap_puerto on public.service_contracts;
create trigger trg_service_contracts_free_nap_puerto
  before delete on public.service_contracts
  for each row execute function public.free_nap_puerto_on_contract_delete();

drop trigger if exists trg_clients_free_nap_puerto on public.clients;
create trigger trg_clients_free_nap_puerto
  before delete on public.clients
  for each row execute function public.free_nap_puerto_on_client_delete();
