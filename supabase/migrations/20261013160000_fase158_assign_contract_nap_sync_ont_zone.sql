-- SmartRayco — Fase 158: NAP (fo_nap_puertos) y la zona de la ONT en la OLT
-- (olt_onts.zone_id) vivian en 2 pasos sin ninguna transaccion en comun —
-- uno via RPC de Supabase (assign_contract_nap), el otro via el backend
-- Hono propio (PUT /:id/onts/:ontDbId/meta). Si el segundo fallaba, el
-- primero ya habia quedado aplicado — inconsistencia confirmada en
-- ESTADO_DESARROLLO.md (13ac/13ad).
--
-- Esta funcion hace AMBAS cosas en UNA sola transaccion de Postgres
-- (reusa assign_provisioning_nap, ya probado en Fase 2, para la parte
-- NAP) — si la actualizacion de olt_onts.zone_id fallara por cualquier
-- motivo, TODA la operacion se revierte, incluida la reserva NAP.
--
-- Solo para los 3 roles operativos reales de SmartRayco: SUPERADMIN,
-- ADMIN, TECNICO_RED. NO amplia permisos — SOPORTE y FACTURACION, que ya
-- podian llamar `assign_contract_nap` (sin tocar), NO pueden llamar esta
-- funcion nueva; siguen exactamente como estaban, sin sincronizar la zona
-- de la ONT. `assign_contract_nap` no se modifica en absoluto.
--
-- La zona destino se LEE de service_contracts.zone_id (ya guardado por
-- el frontend antes de llamar esto, ClientServiceDetailView.vue) — no es
-- un parametro nuevo, evita que alguien mande una zona distinta a la del
-- contrato por error.
--
-- La ONT a actualizar se identifica SOLO por contract_id, nunca por
-- client_id (un cliente puede tener varios servicios/ONTs):
--  - 0 ONTs con ese contract_id: normal (contrato aun sin instalar) — no
--    se toca nada, se informa en el resultado (ont_zone_skip_reason).
--  - 2+ ONTs con ese contract_id: dato ambiguo — no se toca ninguna, se
--    informa el conteo para revision manual.
--  - exactamente 1: se actualiza su zone_id si difiere.

create or replace function public.assign_contract_nap_sync_ont_zone(
  p_nap_id uuid, p_contract_id uuid, p_client_id uuid
) returns table (nap_port_id uuid, ont_zone_synced boolean, ont_zone_skip_reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_nap_result uuid;
  v_zone_id uuid;
  v_ont_count int;
  v_ont_id uuid;
  v_ont_zone_id uuid;
  v_synced boolean := false;
  v_skip_reason text := null;
begin
  v_role := public.current_user_role()::text;
  if v_role is null or v_role not in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED') then
    raise exception 'No tienes permisos para esta accion' using errcode = '42501';
  end if;

  v_nap_result := public.assign_provisioning_nap(p_nap_id, p_contract_id, p_client_id);

  select zone_id into v_zone_id from public.service_contracts where id = p_contract_id;

  select count(*), (array_agg(id))[1] into v_ont_count, v_ont_id
    from public.olt_onts where contract_id = p_contract_id;

  if v_ont_count = 0 then
    v_skip_reason := 'sin_ont_vinculada';
  elsif v_ont_count > 1 then
    v_skip_reason := 'ambiguo:' || v_ont_count::text;
  else
    select zone_id into v_ont_zone_id from public.olt_onts where id = v_ont_id;
    if v_ont_zone_id is distinct from v_zone_id then
      update public.olt_onts set zone_id = v_zone_id where id = v_ont_id;
    end if;
    v_synced := true;
  end if;

  return query select v_nap_result, v_synced, v_skip_reason;
end;
$$;
revoke all on function public.assign_contract_nap_sync_ont_zone(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_contract_nap_sync_ont_zone(uuid, uuid, uuid) to authenticated;
