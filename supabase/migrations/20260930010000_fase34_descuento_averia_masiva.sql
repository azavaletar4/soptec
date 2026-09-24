-- SmartRayco — Fase 34: descuentos manuales por averias masivas/fallas de
-- servicio, individuales o por lote (zona/OLT/caja NAP).
--
-- Extiende el sistema de creditos de la Fase 33 (mismo patron: trigger en
-- la base de datos, invoice_adjustments para el desglose). Orden de
-- prelacion pedido explicitamente: Averia -> Referido -> Saldo a favor.
-- Restringido a ADMIN/SUPERADMIN (no FACTURACION) via RLS.
--
-- "Nodo" del pedido original se resuelve como OLT (el punto de distribucion
-- GPON mas cercano ya modelado en el esquema) — no existe un concepto de
-- "nodo" separado en infra_elementos; si se referia a splitter/armario en
-- vez de OLT hay que avisar para agregar ese criterio.

-- =========================================================
-- descuentos_compensacion_lotes — metadata de una aplicacion masiva
-- =========================================================

create table public.descuentos_compensacion_lotes (
  id                  uuid primary key default gen_random_uuid(),
  criterio            text not null check (criterio in ('zona', 'olt', 'nap')),
  criterio_id         uuid not null,
  motivo              text not null,
  monto               numeric(10, 2),
  porcentaje          numeric(5, 2),
  clientes_afectados  int not null default 0,
  created_by          uuid references public.profiles (id) default auth.uid(),
  created_at          timestamptz not null default now(),
  constraint monto_o_porcentaje check ((monto is not null) <> (porcentaje is not null))
);

-- =========================================================
-- descuentos_compensacion — el descuento pendiente por cliente
-- =========================================================

create table public.descuentos_compensacion (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  monto       numeric(10, 2) not null check (monto > 0),
  motivo      text not null,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'aplicado', 'cancelado')),
  invoice_id  uuid references public.invoices (id) on delete set null,
  lote_id     uuid references public.descuentos_compensacion_lotes (id) on delete set null,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  applied_at  timestamptz
);

create index idx_descuentos_compensacion_client on public.descuentos_compensacion (client_id, estado);

alter table public.descuentos_compensacion_lotes enable row level security;
alter table public.descuentos_compensacion enable row level security;

-- Solo ADMIN/SUPERADMIN (pedido explicito) — FACTURACION ya ve el motivo
-- igual, reflejado como texto en invoice_adjustments de la factura.
create policy "descuentos_compensacion_lotes_admin_only"
  on public.descuentos_compensacion_lotes for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

create policy "descuentos_compensacion_admin_only"
  on public.descuentos_compensacion for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- =========================================================
-- Nuevos tipos permitidos en las tablas de la Fase 33 (busca el constraint
-- de check por columna en vez de asumir el nombre autogenerado, para no
-- fallar en silencio si Postgres lo nombro distinto a lo esperado).
-- =========================================================

do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
     where rel.relname = 'invoice_adjustments' and con.contype = 'c' and att.attname = 'tipo'
  loop
    execute format('alter table public.invoice_adjustments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.invoice_adjustments
  add constraint invoice_adjustments_tipo_check check (tipo in ('averia', 'referido', 'saldo_a_favor', 'promo_4to_gratis'));

do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
     where rel.relname = 'client_credit_movements' and con.contype = 'c' and att.attname = 'tipo'
  loop
    execute format('alter table public.client_credit_movements drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.client_credit_movements
  add constraint client_credit_movements_tipo_check
  check (tipo in ('pago_excedente', 'consumo_saldo_favor', 'referido_sobrante', 'averia_sobrante', 'ajuste_manual'));

-- =========================================================
-- apply_invoice_credits() — agrega el paso de averia PRIMERO en la cascada
-- (Averia -> Referido -> Saldo a favor). Reemplaza la funcion de la Fase
-- 33/33b; el trigger trg_invoices_auto_credit ya apunta a este nombre.
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

  -- 1) Descuentos por averia/compensacion pendientes — TODOS los que tenga
  -- el cliente se resuelven en esta factura (no se van acumulando de mes en
  -- mes), en el orden en que se crearon.
  for v_averia in
    select * from public.descuentos_compensacion
     where client_id = new.client_id and estado = 'pendiente'
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

  -- Siempre deja amount_due al dia (nunca negativo: el "sobrante" de
  -- cualquier credito se desvia a saldo_a_favor en su propio paso, arriba,
  -- en vez de dejar que la factura termine con saldo negativo).
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
-- crear_descuento_compensacion_masivo — resuelve los clientes afectados
-- por zona/OLT/caja NAP y crea un descuentos_compensacion 'pendiente' por
-- cada uno (monto fijo o % de su mensualidad activa).
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
    if p_porcentaje is not null then
      select monthly_fee into v_monthly
        from public.service_contracts
       where client_id = v_client_id and status = 'active'
       order by created_at desc
       limit 1;
      if v_monthly is null then
        continue; -- sin contrato activo, no hay mensualidad de la que sacar el %
      end if;
      v_monto_cliente := round(v_monthly * p_porcentaje / 100, 2);
    else
      v_monto_cliente := p_monto;
    end if;

    if v_monto_cliente > 0 then
      insert into public.descuentos_compensacion (client_id, monto, motivo, lote_id)
      values (v_client_id, v_monto_cliente, p_motivo, v_lote_id);
      v_count := v_count + 1;
    end if;
  end loop;

  update public.descuentos_compensacion_lotes set clientes_afectados = v_count where id = v_lote_id;

  return query select v_lote_id, v_count;
end;
$$;
