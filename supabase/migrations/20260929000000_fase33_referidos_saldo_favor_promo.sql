-- SmartRayco — Fase 33: Referidos (S/25), Promocion 3+1 gratis y Saldo a favor.
--
-- Toda la logica de negocio de dinero vive aqui (triggers), no en Node —
-- mismo criterio que apply_inventory_movement/apply_mantenimiento_historial:
-- asi da igual si la factura la crea el formulario manual de Facturacion,
-- el generador automatico (Fase 33b) o la promo 3+1 — el descuento de
-- referido y el saldo a favor se aplican siempre, sin duplicar logica.
--
-- Orden de prelacion en una factura nueva: primero el descuento de referido
-- (bonificacion puntual ligada a un evento especifico), despues el saldo a
-- favor (billetera persistente) sobre lo que quede. Si el descuento de
-- referido sobra (factura menor a S/25), el sobrante se SUMA al saldo a
-- favor del referente en vez de perderse.

-- =========================================================
-- Columnas nuevas
-- =========================================================

alter table public.clients add column if not exists saldo_a_favor numeric(10, 2) not null default 0;

-- Monto realmente cobrado en mark-paid (para detectar sobrepago); nulo en
-- facturas ya pagadas antes de esta fase.
alter table public.invoices add column if not exists amount_paid numeric(10, 2);

-- =========================================================
-- referidos
-- =========================================================

create table public.referidos (
  id                   uuid primary key default gen_random_uuid(),
  referente_client_id  uuid not null references public.clients (id) on delete cascade,
  referido_client_id   uuid not null unique references public.clients (id) on delete cascade,
  monto_descuento      numeric(10, 2) not null default 25.00,
  estado               text not null default 'pendiente' check (estado in ('pendiente', 'aplicado', 'cancelado')),
  invoice_id           uuid references public.invoices (id) on delete set null,
  created_by           uuid references public.profiles (id) default auth.uid(),
  created_at           timestamptz not null default now(),
  applied_at           timestamptz
);

create index idx_referidos_referente on public.referidos (referente_client_id, estado);

-- =========================================================
-- invoice_adjustments — desglose de descuentos/creditos por factura
-- =========================================================

create table public.invoice_adjustments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  tipo         text not null check (tipo in ('referido', 'saldo_a_favor', 'promo_4to_gratis')),
  descripcion  text not null,
  monto        numeric(10, 2) not null check (monto > 0),
  referido_id  uuid references public.referidos (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index idx_invoice_adjustments_invoice on public.invoice_adjustments (invoice_id);

-- =========================================================
-- client_credit_movements — auditoria del saldo a favor (insert-only)
-- =========================================================

create table public.client_credit_movements (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  tipo             text not null check (tipo in ('pago_excedente', 'consumo_saldo_favor', 'referido_sobrante', 'ajuste_manual')),
  monto            numeric(10, 2) not null, -- positivo = credito ganado, negativo = credito consumido
  saldo_resultante numeric(10, 2) not null,
  invoice_id       uuid references public.invoices (id) on delete set null,
  created_by       uuid references public.profiles (id) default auth.uid(),
  created_at       timestamptz not null default now()
);

create index idx_client_credit_movements_client on public.client_credit_movements (client_id, created_at desc);

-- =========================================================
-- pagos_adelantados — promocion 3+1 (pago de 3 meses, 4to gratis)
-- =========================================================

create table public.pagos_adelantados (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references public.service_contracts (id) on delete cascade,
  client_id      uuid not null references public.clients (id) on delete cascade,
  meses_pagados  int not null default 3 check (meses_pagados = 3),
  monto_total    numeric(10, 2) not null,
  payment_method text,
  invoice_ids    uuid[], -- lo llena el trigger tras crear las 4 facturas (no viaja en el INSERT ... RETURNING)
  created_by     uuid references public.profiles (id) default auth.uid(),
  created_at     timestamptz not null default now()
);

-- =========================================================
-- RLS — mismo criterio que invoices_billing_staff (Fase 7)
-- =========================================================

alter table public.referidos enable row level security;
alter table public.invoice_adjustments enable row level security;
alter table public.client_credit_movements enable row level security;
alter table public.pagos_adelantados enable row level security;

create policy "referidos_billing_staff"
  on public.referidos for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

create policy "invoice_adjustments_billing_staff"
  on public.invoice_adjustments for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

create policy "client_credit_movements_billing_staff"
  on public.client_credit_movements for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

create policy "pagos_adelantados_billing_staff"
  on public.pagos_adelantados for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'FACTURACION'));

-- =========================================================
-- apply_invoice_credits() — aplica referido + saldo a favor a facturas nuevas
-- =========================================================

create or replace function public.apply_invoice_credits()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_referido        record;
  v_referido_amt    numeric(10, 2) := 0;
  v_leftover        numeric(10, 2) := 0;
  v_saldo           numeric(10, 2) := 0;
  v_saldo_amt       numeric(10, 2) := 0;
  v_remaining       numeric(10, 2);
  v_nuevo_saldo     numeric(10, 2);
begin
  -- Solo facturas nuevas en 'pending' — las que ya nacen 'paid' (promo 3+1)
  -- no deben volver a consumir credito.
  if new.status <> 'pending' then
    return new;
  end if;

  v_remaining := new.amount;

  -- 1) Descuento por referido (el mas antiguo pendiente de este referente).
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

    -- Si la factura era menor a los S/25, el sobrante pasa a saldo a favor
    -- del referente (requerimiento explicito) en vez de perderse.
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

  -- 2) Saldo a favor previo del cliente, sobre lo que quede de la factura.
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

  -- 3) Si los ajustes cubren el 100%, la factura queda pagada sola.
  if v_remaining <= 0 then
    update public.invoices
       set status = 'paid', paid_at = now(), payment_method = 'credito'
     where id = new.id;
  end if;

  return new;
end;
$$;

create trigger trg_invoices_auto_credit
  after insert on public.invoices
  for each row execute procedure public.apply_invoice_credits();

-- =========================================================
-- apply_pago_adelantado() — promocion 3+1: crea las 4 facturas
-- =========================================================

create or replace function public.apply_pago_adelantado()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_contract      record;
  v_last_period   date;
  v_period_start  date;
  v_period_end    date;
  v_invoice_id    uuid;
  v_invoice_ids   uuid[] := '{}';
  i               int;
begin
  select id, client_id, monthly_fee, start_date
    into v_contract
    from public.service_contracts
   where id = new.contract_id;

  if not found then
    raise exception 'Contrato % no encontrado', new.contract_id;
  end if;

  -- Mismo calculo "arranque seguro" que el generador automatico (Fase 33b):
  -- si ya hay facturas, se retoma justo despues de la ultima; si no hay
  -- ninguna, se arranca en el periodo ACTUAL (nunca desde start_date, para
  -- no generar un historial retroactivo).
  select max(period_end) into v_last_period
    from public.invoices
   where contract_id = new.contract_id
     and status <> 'cancelled';

  v_period_start := coalesce(v_last_period + 1, date_trunc('month', current_date)::date);

  for i in 1..4 loop
    v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

    insert into public.invoices (contract_id, client_id, period_start, period_end, amount, due_date, status, paid_at, payment_method, notes)
    values (
      new.contract_id,
      new.client_id,
      v_period_start,
      v_period_end,
      v_contract.monthly_fee,
      v_period_start,
      'paid',
      now(),
      case when i <= 3 then new.payment_method else null end,
      case when i = 4 then 'Promoción 4to Mes Gratis por Pago Adelantado' else 'Pago adelantado (promoción 3+1)' end
    )
    returning id into v_invoice_id;

    if i = 4 then
      insert into public.invoice_adjustments (invoice_id, tipo, descripcion, monto)
      values (v_invoice_id, 'promo_4to_gratis', 'Promoción 4to Mes Gratis por Pago Adelantado', v_contract.monthly_fee);
    end if;

    v_invoice_ids := array_append(v_invoice_ids, v_invoice_id);
    v_period_start := (v_period_end + 1);
  end loop;

  update public.pagos_adelantados set invoice_ids = v_invoice_ids where id = new.id;

  return new;
end;
$$;

create trigger trg_pagos_adelantados_apply
  after insert on public.pagos_adelantados
  for each row execute procedure public.apply_pago_adelantado();
