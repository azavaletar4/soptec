-- SmartRayco — Fase 33b: monto neto pendiente visible en el listado de
-- Facturacion.
--
-- La Fase 33 aplicaba bien los descuentos de referido/saldo a favor
-- (quedan en invoice_adjustments), pero eso era invisible en la tabla de
-- Facturacion.vue: solo se veia el monto bruto de la factura, y habia que
-- abrir "Marcar pagada" para ver el desglose. amount_due es el monto bruto
-- menos la suma de sus invoice_adjustments — se mantiene solo via trigger,
-- mismo criterio que kilometraje_actual en vehiculos (Fase 31).

alter table public.invoices add column if not exists amount_due numeric(10, 2);

-- Backfill: facturas de antes de esta fase no tienen ajustes, asi que su
-- saldo pendiente es 0 si ya estan pagadas/canceladas, o el monto completo
-- si siguen pendientes.
update public.invoices
   set amount_due = case when status = 'paid' then 0 else amount end
 where amount_due is null;

alter table public.invoices alter column amount_due set not null;

-- BEFORE INSERT (no default en la columna a proposito): asi el trigger
-- puede distinguir "no se especifico" (null) de "se especifico 0" y
-- calcularlo el mismo si hace falta, sin pisar un valor explicito.
create or replace function public.set_invoice_amount_due()
returns trigger
language plpgsql
as $$
begin
  if new.amount_due is null then
    new.amount_due := case when new.status = 'paid' then 0 else new.amount end;
  end if;
  return new;
end;
$$;

create trigger trg_invoices_amount_due
  before insert on public.invoices
  for each row execute procedure public.set_invoice_amount_due();

-- Reemplaza apply_invoice_credits (Fase 33) para que SIEMPRE actualice
-- amount_due al final (antes solo tocaba la factura si los ajustes la
-- cubrian al 100%) — el trigger/nombre no cambian, asi que no hace falta
-- recrear trg_invoices_auto_credit.
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
  if new.status <> 'pending' then
    return new;
  end if;

  v_remaining := new.amount;

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

  -- Siempre deja amount_due al dia (antes solo se tocaba la factura si
  -- quedaba cubierta al 100%, dejando amount_due desactualizado en el caso
  -- de un descuento parcial como el reportado).
  update public.invoices
     set amount_due = greatest(v_remaining, 0),
         status = case when v_remaining <= 0 then 'paid' else status end,
         paid_at = case when v_remaining <= 0 then now() else paid_at end,
         payment_method = case when v_remaining <= 0 then 'credito' else payment_method end
   where id = new.id;

  return new;
end;
$$;

-- Corrige el saldo pendiente de las facturas ya creadas con ajustes de la
-- Fase 33 (como la del reporte que motivo esta migracion), que quedaron con
-- amount_due = amount por el bug de arriba.
update public.invoices i
   set amount_due = greatest(i.amount - coalesce((select sum(a.monto) from public.invoice_adjustments a where a.invoice_id = i.id), 0), 0)
 where exists (select 1 from public.invoice_adjustments a where a.invoice_id = i.id);
