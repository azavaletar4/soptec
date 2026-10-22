-- CANDIDATE ONLY. Expand first; no retirement/data reconciliation in this migration.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.assign_contract_nap_sync_ont_zone(uuid,uuid,uuid)')) is distinct from '61dc572f18d1101144b49d8bef3af38a'
 or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric)')) is distinct from '41fd2a9b59106c76898dfac0bebc7501' then
  raise exception 'SQL reader definitions differ from verified baseline; do not overwrite';
 end if;
end $$;
alter table public.olt_onts add column retired_at timestamptz;
comment on column public.olt_onts.retired_at is 'Historical ONT, not an active position. Coordinates and client/contract references retain historical identity; never operate on this position through a retired identity.';

create function public.guard_olt_ont_retirement() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if tg_op='DELETE' then
  if old.retired_at is not null then raise exception 'Retired ONT history cannot be deleted' using errcode='55000'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and (old.retired_at is not null or new.retired_at is not null) then
  if (to_jsonb(new)-'retired_at'-'updated_at') is distinct from (to_jsonb(old)-'retired_at'-'updated_at') then
   raise exception 'Retirement cannot rewrite historical identity, metadata or telemetry' using errcode='55000';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_olt_ont_retirement() from public;
create trigger trg_olt_onts_retirement before insert or update or delete on public.olt_onts
for each row execute function public.guard_olt_ont_retirement();
-- Old unconditional UNIQUE stays intact until all readers/writers support retirement.
create or replace function public.crear_descuento_compensacion_masivo(
  p_criterio text,
  p_criterio_id uuid,
  p_motivo text,
  p_monto numeric default null,
  p_porcentaje numeric default null
)
returns table (lote_id uuid, clientes_afectados int)
language plpgsql
security definer set search_path = public
as $$
declare
  v_lote_id uuid;
  v_client_id uuid;
  v_contract_id uuid;
  v_ont_count int;
  v_monthly numeric(10, 2);
  v_monto_cliente numeric(10, 2);
  v_count int := 0;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo ADMIN/SUPERADMIN pueden aplicar descuentos por averia masiva';
  end if;
  if p_criterio not in ('zona', 'olt', 'nap') then
    raise exception 'Criterio invalido: %', p_criterio;
  end if;
  if (p_monto is null) = (p_porcentaje is null) then
    raise exception 'Indica exactamente uno: monto fijo o porcentaje';
  end if;

  insert into public.descuentos_compensacion_lotes (criterio, criterio_id, motivo, monto, porcentaje)
  values (p_criterio, p_criterio_id, p_motivo, p_monto, p_porcentaje)
  returning id into v_lote_id;

  for v_client_id in
    select distinct c.id
      from public.clients c
     where (p_criterio = 'zona' and c.zone_id = p_criterio_id)
        or (p_criterio = 'olt' and exists (
              select 1 from public.olt_onts o where o.retired_at is null and o.client_id = c.id and o.olt_device_id = p_criterio_id
            ))
        or (p_criterio = 'nap' and exists (
              select 1 from public.fo_nap_puertos n where n.client_id = c.id and n.infra_elemento_id = p_criterio_id
            ))
  loop
    v_contract_id := null;

    if p_criterio = 'olt' then
      -- Solo se resuelve el contrato si hay exactamente UN ont de este
      -- cliente en esta OLT (y ese ont ya tiene contract_id, Fase 37).
      select count(*) into v_ont_count
        from public.olt_onts o
       where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;

      if v_ont_count = 1 then
        select o.contract_id into v_contract_id
          from public.olt_onts o
         where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;
      end if;
    end if;

    if p_porcentaje is not null then
      if v_contract_id is not null then
        select monthly_fee into v_monthly from public.service_contracts where id = v_contract_id;
      end if;
      if v_monthly is null then
        select monthly_fee into v_monthly
          from public.service_contracts
         where client_id = v_client_id and status = 'active'
         order by created_at desc
         limit 1;
      end if;
      if v_monthly is null then
        continue; -- sin contrato activo, no hay mensualidad de la que sacar el %
      end if;
      v_monto_cliente := round(v_monthly * p_porcentaje / 100, 2);
    else
      v_monto_cliente := p_monto;
    end if;

    if v_monto_cliente > 0 then
      insert into public.descuentos_compensacion (client_id, contract_id, monto, motivo, lote_id)
      values (v_client_id, v_contract_id, v_monto_cliente, p_motivo, v_lote_id);
      v_count := v_count + 1;
    end if;

    v_monthly := null;
  end loop;

  update public.descuentos_compensacion_lotes set clientes_afectados = v_count where id = v_lote_id;

  return query select v_lote_id, v_count;
end;
$$;

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
    from public.olt_onts where retired_at is null and contract_id = p_contract_id;

  if v_ont_count = 0 then
    v_skip_reason := 'sin_ont_vinculada';
  elsif v_ont_count > 1 then
    v_skip_reason := 'ambiguo:' || v_ont_count::text;
  else
    select zone_id into v_ont_zone_id from public.olt_onts where retired_at is null and id = v_ont_id;
    if v_ont_zone_id is distinct from v_zone_id then
      update public.olt_onts set zone_id = v_zone_id where retired_at is null and id = v_ont_id;
    end if;
    v_synced := true;
  end if;

  return query select v_nap_result, v_synced, v_skip_reason;
end;
$$;
commit;
