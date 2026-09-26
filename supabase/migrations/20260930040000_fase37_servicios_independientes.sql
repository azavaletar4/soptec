-- SmartRayco — Fase 37: cada service_contract (linea/servicio) pasa a ser
-- una instalacion fisica independiente, no solo un registro de facturacion.
--
-- Problema que resuelve: mientras cada cliente tenia un unico servicio,
-- guardar ubicacion (clients.latitude/longitude/address, Fase 3/3c), el
-- equipo ONT (olt_onts.client_id, Fase 4) y el equipo de inventario
-- (inventory_units.client_id, Fase 11c) contra el TITULAR alcanzaba — de
-- hecho installations (Fase 9) documenta la decision explicita de no
-- duplicar lat/lng "ya que existen en clients". Con un cliente de 2+ lineas
-- esa decision ya no aplica: el segundo contrato comparte/pisa la ubicacion,
-- el ONT y los descuentos por averia del primero.
--
-- Este archivo SOLO agrega columnas nullable + backfill NO ambiguo (cliente
-- con un unico contrato). Los casos ambiguos (2+ contratos y 2+ equipos/ONTs
-- del mismo cliente) quedan sin asignar a proposito — no hay forma de
-- adivinar cual corresponde a cual sin que el staff lo confirme desde la UI
-- (Fase 37b, pendiente) — y se pueden listar con el SELECT de auditoria
-- documentado al final de este archivo (no se ejecuta solo).

-- =========================================================
-- 1) Ubicacion/instalacion propia de cada contrato
-- =========================================================

alter table public.service_contracts
  add column if not exists installation_address  text,
  add column if not exists installation_reference text,
  add column if not exists latitude               double precision,
  add column if not exists longitude              double precision;

comment on column public.service_contracts.installation_address is
  'Direccion de ESTA instalacion (puede diferir de la direccion del titular si tiene mas de un servicio).';
comment on column public.service_contracts.latitude is
  'GPS de ESTA instalacion. No confundir con clients.latitude (queda como dato de contacto/ubicacion general del titular).';

-- Backfill: punto de partida = la ubicacion actual del titular, copiada a
-- CADA uno de sus contratos. Es exactamente lo que la UI ya asumia hasta
-- ahora (un solo punto para todo el cliente), asi que no empeora nada;
-- donde haya 2+ contratos alguien del staff debe corregir la de las lineas
-- que no son la casa principal.
update public.service_contracts sc
set installation_address = c.address,
    latitude = c.latitude,
    longitude = c.longitude
from public.clients c
where sc.client_id = c.id
  and sc.latitude is null
  and sc.installation_address is null;

-- =========================================================
-- 2) Equipo ONT (registro OLT) por contrato
-- =========================================================

alter table public.olt_onts
  add column if not exists contract_id uuid references public.service_contracts (id) on delete set null;

create index if not exists idx_olt_onts_contract on public.olt_onts (contract_id) where contract_id is not null;

-- Backfill no ambiguo: cliente con EXACTAMENTE un contrato en todo su historial.
update public.olt_onts o
set contract_id = sc.id
from public.service_contracts sc
where o.client_id = sc.client_id
  and o.contract_id is null
  and o.client_id is not null
  and (select count(*) from public.service_contracts sc2 where sc2.client_id = o.client_id) = 1;

-- =========================================================
-- 3) Equipo fisico de inventario (router/ONU serializado) por contrato
-- =========================================================

alter table public.inventory_units
  add column if not exists contract_id uuid references public.service_contracts (id) on delete set null;

create index if not exists idx_inventory_units_contract on public.inventory_units (contract_id) where contract_id is not null;

update public.inventory_units u
set contract_id = sc.id
from public.service_contracts sc
where u.client_id = sc.client_id
  and u.contract_id is null
  and u.client_id is not null
  and (select count(*) from public.service_contracts sc2 where sc2.client_id = u.client_id) = 1;

-- =========================================================
-- 4) Descuentos por averia: contract_id NULL sigue siendo "todo el cliente"
--    (compensacion general); con contract_id, queda atado a esa linea.
-- =========================================================

alter table public.descuentos_compensacion
  add column if not exists contract_id uuid references public.service_contracts (id) on delete set null;

create index if not exists idx_descuentos_compensacion_contract on public.descuentos_compensacion (contract_id) where contract_id is not null;

comment on column public.descuentos_compensacion.contract_id is
  'NULL = compensacion para el cliente completo (cualquier factura). Con valor = solo aplica a facturas de ESE contrato (ej. se cayo la fibra de una sola casa).';

-- =========================================================
-- 5) apply_invoice_credits(): un descuento de averia con contract_id solo
--    se aplica a facturas de ESE contrato; los que tengan contract_id null
--    siguen aplicando a cualquier factura del cliente (igual que antes de
--    esta fase). Reemplaza la version de la Fase 34; el trigger ya apunta
--    a este nombre de funcion.
-- =========================================================

create or replace function public.apply_invoice_credits()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_averia          record;
  v_averia_amt      numeric(10, 2);
  v_referido        record;
  v_referido_amt    numeric(10, 2) := 0;
  v_leftover        numeric(10, 2) := 0;
  v_saldo           numeric(10, 2) := 0;
  v_saldo_amt       numeric(10, 2) := 0;
  v_remaining       numeric(10, 2);
  v_nuevo_saldo     numeric(10, 2);
begin
  if new.status <> 'pending' then
    return new;
  end if;

  v_remaining := new.amount;

  -- 1) Descuentos por averia/compensacion pendientes de ESTE contrato +
  -- los generales del cliente (contract_id null), en el orden en que se
  -- crearon. Antes de la Fase 37 se aplicaban TODOS los del cliente sin
  -- filtrar por contrato, mezclando compensaciones de una linea con las
  -- facturas de otra.
  for v_averia in
    select * from public.descuentos_compensacion
     where client_id = new.client_id
       and estado = 'pendiente'
       and (contract_id is null or contract_id = new.contract_id)
     order by created_at asc
  loop
    v_averia_amt := least(v_averia.monto, greatest(v_remaining, 0));

    if v_averia_amt > 0 then
      insert into public.invoice_adjustments (invoice_id, tipo, descripcion, monto)
      values (
        new.id,
        'averia',
        'Descuento por compensación de servicio: ' || v_averia.motivo || ' - S/ ' || to_char(v_averia_amt, 'FM999999990.00'),
        v_averia_amt
      );
      v_remaining := v_remaining - v_averia_amt;
    end if;

    update public.descuentos_compensacion
       set estado = 'aplicado', invoice_id = new.id, applied_at = now()
     where id = v_averia.id;

    -- Si el descuento era mayor a lo que quedaba de factura, el sobrante
    -- pasa a saldo a favor (mismo criterio que el sobrante de referido).
    v_leftover := v_averia.monto - v_averia_amt;
    if v_leftover > 0 then
      update public.clients
         set saldo_a_favor = saldo_a_favor + v_leftover
       where id = new.client_id
      returning saldo_a_favor into v_nuevo_saldo;

      insert into public.client_credit_movements (client_id, tipo, monto, saldo_resultante, invoice_id)
      values (new.client_id, 'averia_sobrante', v_leftover, v_nuevo_saldo, new.id);
    end if;
  end loop;

  -- 2) Descuento por referido (el mas antiguo pendiente de este referente).
  select r.id, r.monto_descuento, (c.first_name || ' ' || c.last_name) as referido_nombre
    into v_referido
    from public.referidos r
    join public.clients c on c.id = r.referido_client_id
   where r.referente_client_id = new.client_id
     and r.estado = 'pendiente'
   order by r.created_at asc
   limit 1;

  if found then
    v_referido_amt := least(v_referido.monto_descuento, v_remaining);

    insert into public.invoice_adjustments (invoice_id, tipo, descripcion, monto, referido_id)
    values (
      new.id,
      'referido',
      'Descuento por recomendación de cliente ' || v_referido.referido_nombre || ' - S/ ' || to_char(v_referido_amt, 'FM999999990.00'),
      v_referido_amt,
      v_referido.id
    );

    update public.referidos
       set estado = 'aplicado', invoice_id = new.id, applied_at = now()
     where id = v_referido.id;

    v_remaining := v_remaining - v_referido_amt;

    v_leftover := v_referido.monto_descuento - v_referido_amt;
    if v_leftover > 0 then
      update public.clients
         set saldo_a_favor = saldo_a_favor + v_leftover
       where id = new.client_id
      returning saldo_a_favor into v_nuevo_saldo;

      insert into public.client_credit_movements (client_id, tipo, monto, saldo_resultante, invoice_id)
      values (new.client_id, 'referido_sobrante', v_leftover, v_nuevo_saldo, new.id);
    end if;
  end if;

  -- 3) Saldo a favor previo del cliente, sobre lo que quede de la factura.
  if v_remaining > 0 then
    select saldo_a_favor into v_saldo from public.clients where id = new.client_id for update;

    if v_saldo > 0 then
      v_saldo_amt := least(v_saldo, v_remaining);

      insert into public.invoice_adjustments (invoice_id, tipo, descripcion, monto)
      values (new.id, 'saldo_a_favor', 'Aplicación de saldo a favor - S/ ' || to_char(v_saldo_amt, 'FM999999990.00'), v_saldo_amt);

      update public.clients set saldo_a_favor = saldo_a_favor - v_saldo_amt where id = new.client_id;

      insert into public.client_credit_movements (client_id, tipo, monto, saldo_resultante, invoice_id)
      values (new.client_id, 'consumo_saldo_favor', -v_saldo_amt, v_saldo - v_saldo_amt, new.id);

      v_remaining := v_remaining - v_saldo_amt;
    end if;
  end if;

  update public.invoices
     set amount_due = greatest(v_remaining, 0),
         status = case when v_remaining <= 0 then 'paid' else status end,
         paid_at = case when v_remaining <= 0 then now() else paid_at end,
         payment_method = case when v_remaining <= 0 then 'credito' else payment_method end
   where id = new.id;

  return new;
end;
$$;

-- =========================================================
-- 6) crear_descuento_compensacion_masivo: cuando el criterio es 'olt', ya se
--    puede saber que ONT (y por lo tanto que contrato) esta detras de esa
--    OLT — se usa ese contrato en vez de "el ultimo contrato activo del
--    cliente" para calcular el % y se guarda el contract_id en el
--    descuento, para que solo afecte la factura de ESA linea. Si el cliente
--    tiene mas de un ONT en la misma OLT (varios servicios en el mismo
--    equipo) o el ONT no tiene contract_id asignado (caso ambiguo de la
--    Fase 37), se deja contract_id null y se conserva el comportamiento
--    anterior (compensacion a nivel cliente) como fallback seguro.
--    'zona' y 'nap' no tienen forma de resolver un contrato especifico
--    todavia (fo_nap_puertos no guarda contract_id) y siguen siendo
--    compensaciones a nivel cliente, igual que antes.
-- =========================================================

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
              select 1 from public.olt_onts o where o.client_id = c.id and o.olt_device_id = p_criterio_id
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
       where o.client_id = v_client_id and o.olt_device_id = p_criterio_id;

      if v_ont_count = 1 then
        select o.contract_id into v_contract_id
          from public.olt_onts o
         where o.client_id = v_client_id and o.olt_device_id = p_criterio_id;
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

-- =========================================================
-- Auditoria (NO se ejecuta aca, es documentacion): clientes con 2+
-- contratos donde algun ONT/equipo/descuento quedo sin contract_id porque
-- el backfill de arriba no pudo decidir por cual linea era. Correrla desde
-- el SQL editor de Supabase cuando se arme la UI para resolverlos a mano.
--
-- select c.id, c.first_name, c.last_name, c.document_number,
--        (select count(*) from public.service_contracts sc where sc.client_id = c.id) as contratos,
--        (select count(*) from public.olt_onts o where o.client_id = c.id and o.contract_id is null) as onts_sin_contrato,
--        (select count(*) from public.inventory_units u where u.client_id = c.id and u.contract_id is null) as equipos_sin_contrato
-- from public.clients c
-- where (select count(*) from public.service_contracts sc where sc.client_id = c.id) > 1
--   and (
--     exists (select 1 from public.olt_onts o where o.client_id = c.id and o.contract_id is null)
--     or exists (select 1 from public.inventory_units u where u.client_id = c.id and u.contract_id is null)
--   )
-- order by contratos desc;
