-- PROPUESTA LOCAL. No aplicada en producción. Sin backfill ni tablas nuevas.
-- Aplicación futura: respaldar definición/esquema/permisos y aprobar por separado.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Falla si estos nombres ya existen: no sobrescribe otra implementación.
alter table public.clients
  add column prospect_discarded_at timestamptz,
  add column prospect_discarded_by uuid references public.profiles(id),
  add column prospect_discard_reason text,
  add constraint clients_prospect_discard_trace_check check (
    (prospect_discarded_at is null and prospect_discarded_by is null and prospect_discard_reason is null)
    or (prospect_discarded_at is not null and prospect_discarded_by is not null
      and prospect_discard_reason is not null and length(btrim(prospect_discard_reason)) between 5 and 1000
      and status = 'retired')
  );

create function public.discard_unfulfilled_client_prospect(
  p_client_id uuid, p_expected_updated_at timestamptz, p_reason text, p_confirm boolean
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
set lock_timeout = '3s' as $$
declare
  v_client public.clients%rowtype;
  v_actor uuid := auth.uid();
begin
  perform 1 from public.profiles where id = v_actor and active and role::text in ('ADMIN','SUPERADMIN') for share;
  if not found then raise exception 'El descarte requiere ADMIN/SUPERADMIN activo.' using errcode = '42501'; end if;
  if p_confirm is distinct from true or p_expected_updated_at is null
    or p_reason is null or length(btrim(p_reason)) not between 5 and 1000 then
    raise exception 'Confirme el descarte e indique un motivo de 5 a 1000 caracteres.';
  end if;
  select * into v_client from public.clients where id = p_client_id for update;
  if not found then raise exception 'Ficha no disponible.'; end if;
  -- Reintento idempotente: conserva exactamente autor, motivo y fecha originales.
  if v_client.prospect_discarded_at is not null then
    if v_client.prospect_discard_reason <> btrim(p_reason) then raise exception 'La ficha ya fue descartada con otro motivo. Actualice el listado.'; end if;
    return jsonb_build_object('id',v_client.id,'discardedAt',v_client.prospect_discarded_at,'alreadyDiscarded',true);
  end if;
  if v_client.updated_at is distinct from p_expected_updated_at then
    raise exception 'La ficha cambió. Actualice el listado antes de confirmar.';
  end if;
  -- Solo lectura/bloqueo de relaciones; nunca cancela, convierte o crea órdenes.
  perform 1 from public.service_contracts where client_id = p_client_id order by id for update;
  perform 1 from public.installations where client_id = p_client_id order by id for update;
  if not exists (select 1 from public.service_contracts where client_id = p_client_id)
    or exists (select 1 from public.service_contracts where client_id = p_client_id and status <> 'cancelled')
    or exists (select 1 from public.installations where client_id = p_client_id and status <> 'cancelled')
    or (not exists (select 1 from public.installations where client_id = p_client_id) and v_client.status <> 'prospect') then
    raise exception 'Solo contrataciones no concretadas: sin servicios vigentes ni Altas abiertas o completadas.';
  end if;
  perform set_config('app.unfulfilled_prospect_discard_id',p_client_id::text,true);
  update public.clients set status = 'retired', prospect_discarded_at = clock_timestamp(),
    prospect_discarded_by = v_actor, prospect_discard_reason = btrim(p_reason)
    where id = p_client_id returning * into v_client;
  return jsonb_build_object('id',v_client.id,'discardedAt',v_client.prospect_discarded_at,'alreadyDiscarded',false);
end $$;
revoke all on function public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean) from public,anon,service_role;
grant execute on function public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean) to authenticated;

-- INVOKER: un GUC fabricado por el cliente no concede autoridad de definer.
create function public.guard_unfulfilled_prospect_discard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_owner name;
begin
  if TG_OP = 'DELETE' then
    if old.prospect_discarded_at is not null then raise exception 'La ficha descartada se conserva para consulta histórica.'; end if;
    return old;
  end if;
  if TG_OP = 'UPDATE' and old.prospect_discarded_at is not null then
    if new.status is distinct from old.status or new.prospect_discarded_at is distinct from old.prospect_discarded_at
      or new.prospect_discarded_by is distinct from old.prospect_discarded_by
      or new.prospect_discard_reason is distinct from old.prospect_discard_reason then
      raise exception 'El descarte y su trazabilidad no se pueden alterar.';
    end if;
    return new; -- Permite corregir datos de contacto como antes.
  end if;
  if new.prospect_discarded_at is null and new.prospect_discarded_by is null and new.prospect_discard_reason is null then return new; end if;
  select pg_get_userbyid(proowner) into v_owner from pg_proc
    where oid = 'public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean)'::regprocedure;
  if TG_OP <> 'UPDATE' or current_user <> v_owner
    or current_setting('app.unfulfilled_prospect_discard_id',true) is distinct from new.id::text
    or public.current_user_role()::text not in ('ADMIN','SUPERADMIN')
    or new.prospect_discarded_by is distinct from auth.uid() or new.status <> 'retired' then
    raise exception 'Utilice la operación administrativa de descarte.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_unfulfilled_prospect_discard() from public,anon,authenticated,service_role;
create trigger trg_clients_unfulfilled_prospect_discard
  before insert or update or delete on public.clients for each row execute function public.guard_unfulfilled_prospect_discard();

-- Serializa únicamente altas/activaciones de relaciones con el descarte.
-- Evita que una conversión o una petición simultánea deje una ficha descartada
-- con un servicio vigente. No actualiza ninguna relación ni sus estados.
create function public.guard_discarded_prospect_child() returns trigger
language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare v_discarded timestamptz;
begin
  if new.status::text = 'cancelled' then return new; end if;
  select prospect_discarded_at into v_discarded from public.clients where id = new.client_id for update;
  if v_discarded is not null then raise exception 'La ficha está descartada; no se permite activar contratos ni instalaciones.'; end if;
  return new;
end $$;
revoke all on function public.guard_discarded_prospect_child() from public,anon,authenticated,service_role;
create trigger trg_contracts_discarded_prospect_guard before insert or update of client_id,status on public.service_contracts
  for each row execute function public.guard_discarded_prospect_child();
create trigger trg_installations_discarded_prospect_guard before insert or update of client_id,status on public.installations
  for each row execute function public.guard_discarded_prospect_child();
commit;
