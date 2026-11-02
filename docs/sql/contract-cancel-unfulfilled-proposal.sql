-- PROPUESTA LOCAL. No ejecutar en producción sin autorización.
-- Complementa, no reemplaza, a contract_cancel_administrative (baja comercial
-- normal). Esta RPC es solo para una contratación que NUNCA llegó a
-- instalarse (prospecto aceptó, el técnico fue y no se pudo instalar / el
-- cliente rechazó la instalación). Reutiliza el mismo patrón de seguridad
-- de docs/sql/contract-administrative-cancellation-proposal.sql: perfil
-- vigente en PostgreSQL (acá exige SUPERADMIN, más estricto que la baja
-- normal), bloqueo del titular y sus contratos, timestamp de revisión,
-- transacción única. No depende de instalar ninguna otra propuesta.
--
-- Diferencia de fondo con la baja normal: contract_cancel_administrative,
-- cuando no queda ningún servicio vigente ni Alta abierta, SIEMPRE deja al
-- titular 'retired' — correcto para quien fue cliente real y se da de baja,
-- pero incorrecto para quien nunca llegó a recibir el servicio (debería
-- poder volver a ser 'prospect' y resultar elegible para una nueva venta).
-- Esta RPC hace esa distinción mirando si ALGUNA instalación de ese titular
-- (de cualquier contrato) llegó alguna vez a 'completed'.
begin;

create table public.contract_unfulfilled_cancellations (
  id                        uuid primary key default gen_random_uuid(),
  contract_id               uuid not null references public.service_contracts (id),
  client_id                 uuid not null references public.clients (id),
  installation_id           uuid references public.installations (id),
  previous_contract_status  public.contract_status not null,
  previous_client_status    public.client_status not null,
  new_client_status         public.client_status not null,
  reason                    text not null,
  cancelled_by              uuid references public.profiles (id) default auth.uid(),
  created_at                timestamptz not null default now()
);
-- Kardex insert-only (mismo criterio que inventory_movements/olt_alert_log):
-- nunca se edita ni se borra una fila; solo se inserta vía la RPC de abajo.
alter table public.contract_unfulfilled_cancellations enable row level security;
create policy "contract_unfulfilled_cancellations_select_staff"
  on public.contract_unfulfilled_cancellations for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));
revoke insert, update, delete on public.contract_unfulfilled_cancellations from authenticated, anon, service_role;

create function public.contract_cancel_unfulfilled(
  p_contract_id uuid, p_updated_at timestamptz, p_reason text, p_confirm boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp set lock_timeout = '3s' as $$
declare
  parent uuid; c public.service_contracts%rowtype; next_status public.client_status;
  v_reason text; v_installation_id uuid; previous_context text;
  v_previous_contract_status public.contract_status;
begin
  perform 1 from public.profiles where id = auth.uid() and active and role::text = 'SUPERADMIN' for share;
  if not found then raise exception 'Requiere SUPERADMIN activo' using errcode = '42501'; end if;
  if p_confirm is distinct from true then raise exception 'Confirme la cancelación' using errcode = 'PNI00'; end if;
  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 5 then raise exception 'Ingrese un motivo (mínimo 5 caracteres)' using errcode = 'PNI01'; end if;

  select client_id into parent from public.service_contracts where id = p_contract_id;
  if parent is null then raise exception 'Contrato no encontrado' using errcode = 'PNI02'; end if;
  perform 1 from public.clients where id = parent for update;
  perform 1 from public.service_contracts where client_id = parent order by id for update;
  select * into c from public.service_contracts where id = p_contract_id;
  if not found or c.client_id <> parent then raise exception 'Contrato cambiado; recargue' using errcode = 'PNI03'; end if;

  -- Repetir una confirmación cuya respuesta se perdió no repite la escritura.
  if c.status = 'cancelled' then
    return jsonb_build_object('contract', to_jsonb(c), 'clientId', parent, 'alreadyCancelled', true);
  end if;
  if p_updated_at is null or c.updated_at is distinct from p_updated_at then
    raise exception 'Contrato cambiado; recargue antes de confirmar' using errcode = 'PNI03';
  end if;

  perform 1 from public.installations where client_id = parent order by id for update;

  -- ---- Elegibilidad: nunca llegó a recibir servicio por ESTE contrato ----
  if exists (select 1 from public.installations where contract_id = c.id and status::text in ('pending','scheduled','in_progress')) then
    raise exception 'Hay una Alta abierta de esta línea; resuélvala antes de cancelar' using errcode = 'PNI10';
  end if;
  if exists (select 1 from public.installations where contract_id = c.id and status = 'completed') then
    raise exception 'Esta línea ya tuvo una instalación completada; use la baja administrativa existente' using errcode = 'PNI11';
  end if;
  if exists (select 1 from public.invoices where contract_id = c.id) then
    raise exception 'Esta línea ya tiene facturación asociada; use la baja administrativa existente' using errcode = 'PNI12';
  end if;
  if exists (select 1 from public.olt_onts where contract_id = c.id) then
    raise exception 'Esta línea ya tiene un equipo de red (ONT) vinculado; use la baja administrativa existente' using errcode = 'PNI13';
  end if;
  if exists (select 1 from public.inventory_units where contract_id = c.id and status = 'assigned') then
    raise exception 'Hay equipo/material asignado sin devolver a bodega; resuelva el inventario antes de cancelar' using errcode = 'PNI14';
  end if;
  if exists (select 1 from public.tickets where contract_id = c.id and status::text in ('open','in_progress','rescheduled')) then
    raise exception 'Hay un ticket de soporte abierto para esta línea; resuélvalo antes de cancelar' using errcode = 'PNI15';
  end if;
  if exists (select 1 from public.routines where contract_id = c.id and status::text in ('pending','scheduled','in_progress')) then
    raise exception 'Hay una rutina abierta para esta línea; resuélvala antes de cancelar' using errcode = 'PNI16';
  end if;

  select id into v_installation_id from public.installations where contract_id = c.id order by created_at desc limit 1;
  v_previous_contract_status := c.status;

  previous_context := current_setting('app.client_retirement_id', true);
  perform set_config('app.client_retirement_id', parent::text, true);
  update public.service_contracts set status = 'cancelled' where id = c.id returning * into c;

  -- ---- Transición del titular: distinta de la baja normal ----
  -- Un titular con otra línea vigente la conserva; uno que NUNCA tuvo una
  -- instalación completada (en ningún contrato) vuelve a 'prospect' en vez
  -- de 'retired' — es elegible para una nueva venta, no un ex-cliente.
  if exists (select 1 from public.service_contracts where client_id = parent and status = 'active') then next_status := 'active';
  elsif exists (select 1 from public.service_contracts where client_id = parent and status = 'suspended') then next_status := 'suspended';
  elsif exists (select 1 from public.installations where client_id = parent and status = 'completed') then next_status := 'retired';
  else next_status := 'prospect';
  end if;

  insert into public.contract_unfulfilled_cancellations
    (contract_id, client_id, installation_id, previous_contract_status, previous_client_status, new_client_status, reason)
  values (c.id, parent, v_installation_id, v_previous_contract_status, (select status from public.clients where id = parent), next_status, v_reason);

  update public.clients set status = next_status where id = parent and status is distinct from next_status;
  perform set_config('app.client_retirement_id', coalesce(previous_context, ''), true);

  return jsonb_build_object('contract', to_jsonb(c), 'clientId', parent, 'clientStatus', next_status, 'alreadyCancelled', false);
end $$;
revoke all on function public.contract_cancel_unfulfilled(uuid, timestamptz, text, boolean) from public, anon, service_role;
grant execute on function public.contract_cancel_unfulfilled(uuid, timestamptz, text, boolean) to authenticated;
commit;
