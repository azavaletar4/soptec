-- Fase 8 LOCAL. Requiere fase 7C. No aplicada en producción.
-- Hallazgo real (diagnóstico de solo lectura, 25/11/2026): service_contracts.billing_day
-- (fase 2/119, "día de emisión") YA tiene un valor real y especifico para
-- 667/769 contratos activos (87%) - es la misma informacion que el
-- propietario actualizo "a principios de noviembre" via ClientServiceDetailView.vue
-- (campo "Fecha de emisión (día del mes)"), confirmado cruzando los 11
-- contratos de AR contra el Excel real: 10/11 coinciden exactos, 1/11 con
-- una diferencia de un dia que se deja para revision humana, nunca
-- resuelta sola. NUNCA se asume identica semantica a finance_billing_day
-- (dia de emision operativa vs dia de ciclo comercial/prorroga) - esta
-- fase solo SUGIERE el valor existente para que el administrador no tenga
-- que volver a escribirlo, nunca lo copia ni lo confirma por su cuenta.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Extiende finance_pon_matrix TAL COMO QUEDO tras fase 7C (billing_modality/
-- billing_day/grace_days + collection de cobranza) - la ultima version real
-- antes de esta fase, NUNCA una version anterior. Unico cambio: agrega
-- "legacy_billing_day" (solo lectura, nunca escrito por ninguna RPC) al
-- jsonb de cada fila, con el dia de emision ya existente en la columna
-- preexistente "billing_day" - el resto del cuerpo se preserva sin tocar.
create or replace function public.finance_pon_matrix(p_zone uuid,p_year integer,p_page integer default 1,p_search text default '',p_state text default '') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); start_at date; end_at date; today date; answer jsonb;
begin
 if p_zone is null or p_year is null or p_year not between 2020 and 2100 or p_page is null or p_page not between 1 and 100000 or length(coalesce(p_search,''))>100 or coalesce(p_state,'') not in ('','pagado','parcial','vencido','pendiente','adelantado','exonerado','sin_facturacion') then raise exception 'Seleccione una PON/zona, año y filtros válidos'; end if;
 start_at:=make_date(p_year,1,1);end_at:=make_date(p_year+1,1,1);
 today:=(now() at time zone 'America/Lima')::date;
 with base as materialized(
  select c.id,c.client_id,c.contract_number,c.client_code,c.service_type,c.monthly_fee,c.status,pl.name plan,
   c.finance_billing_modality,c.finance_billing_day,c.finance_grace_days,c.billing_day legacy_billing_day,c.debt_hold_status::text debt_hold_status,
   cl.first_name||' '||cl.last_name customer
  from public.service_contracts c join public.clients cl on cl.id=c.client_id left join public.plans pl on pl.id=c.plan_id
  where c.zone_id=p_zone and (coalesce(p_search,'')='' or position(lower(p_search) in lower(coalesce(c.contract_number,'')||' '||coalesce(c.client_code,'')||' '||cl.first_name||' '||cl.last_name||' '||coalesce(cl.document_number,'')))>0)
 ), last_payment as materialized(
  select p.contract_id,max((p.received_at at time zone 'America/Lima')::date) last_date
  from public.invoice_payments p join base b on b.id=p.contract_id where p.reversed_at is null group by p.contract_id
 ), inv as materialized(
  select i.* from public.invoices i join base b on b.id=i.contract_id where i.finance_reconciled and i.period_start>=start_at and i.period_start<end_at and i.status<>'cancelled'
 ), payment_info as(
  select a.invoice_id,sum(a.amount) allocated,bool_and((p.received_at at time zone 'America/Lima')::date<i.period_start) advance
  from public.invoice_payment_allocations a join inv i on i.id=a.invoice_id join public.invoice_payments p on p.id=a.payment_id and p.reversed_at is null group by a.invoice_id
 ), reductions as(
  select a.invoice_id,sum(a.monto) filter(where a.tipo<>'saldo_a_favor') amount,sum(a.monto) filter(where a.source_credit_movement_id is not null) credit,bool_or(a.tipo='promo_4to_gratis') promotion
  from public.invoice_adjustments a join inv i on i.id=a.invoice_id where a.reversed_at is null group by a.invoice_id
 ), monthly as(
  select i.contract_id,extract(month from i.period_start)::integer as month,count(*) count,
   sum(i.amount) amount,sum(case when i.finance_origin='operational' then i.amount else 0 end) issued,bool_or(i.finance_origin='opening_balance') opening,sum(coalesce(i.amount_paid,0)) paid,sum(i.amount_due) due,sum(coalesce(r.credit,0)) credit,
   bool_or(i.amount_due>0 and i.due_date<(now() at time zone 'America/Lima')::date) overdue,
   bool_or(not i.finance_reconciled) unreconciled,
   bool_and(i.status::text='exonerada' or coalesce(r.amount,0)>=i.amount) exempt,
   bool_or(coalesce(r.promotion,false)) promotion,
   bool_and(coalesce(pi.advance,false) and coalesce(pi.allocated,0)=coalesce(i.amount_paid,0)) advance
  from inv i left join payment_info pi on pi.invoice_id=i.id left join reductions r on r.invoice_id=i.id group by i.contract_id,extract(month from i.period_start)
 ), cells as materialized(
  select b.id,g.month,coalesce(m.issued,0) issued,coalesce(m.amount,0) amount,coalesce(m.paid,0) paid,coalesce(m.due,0) due,
   jsonb_build_object('openingCreditApplied',coalesce(m.credit,0)::text,'opening',coalesce(m.opening,false),'month',g.month,'amount',coalesce(m.amount,0)::text,'paid',coalesce(m.paid,0)::text,'due',coalesce(m.due,0)::text,'invoiceCount',coalesce(m.count,0),
    'overdue',coalesce(m.overdue,false),'unreconciled',coalesce(m.unreconciled,false),'promotion',coalesce(m.promotion,false),
    'state',case when m.count is null then 'sin_facturacion' when m.due=0 and m.exempt then 'exonerado' when m.due=0 and m.paid>0 and m.advance then 'adelantado' when m.due=0 then 'pagado' when m.paid>0 or m.credit>0 then 'parcial' when m.overdue then 'vencido' else 'pendiente' end) cell
  from base b cross join generate_series(1,12)g(month) left join monthly m on m.contract_id=b.id and m.month=g.month
 ), grouped as materialized(
  select b.id,b.client_id,b.customer,b.contract_number,b.client_code,b.service_type,b.plan,b.monthly_fee,b.status,
   'sin_verificar'::text technical_state,jsonb_agg(c.cell order by c.month) months,sum(c.issued) billed,sum(c.paid) paid,sum(c.due) due,
   -- Alias de vuelta al nombre esperado por el contrato externo (frontend,
   -- pruebas): el renombre a finance_billing_* es solo interno, por la
   -- colision real con la columna preexistente "billing_day" (fase 2/119).
   -- legacy_billing_day: sugerencia de solo lectura, nunca confirmada ni
   -- escrita por esta funcion - el admin decide si la usa via
   -- finance_set_billing_terms (que sigue exigiendo modalidad explicita).
   b.finance_billing_modality as billing_modality,b.finance_billing_day as billing_day,b.finance_grace_days as grace_days,b.legacy_billing_day,b.debt_hold_status,lp.last_date last_payment_date,
   public.finance_contract_collection_status(b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,lp.last_date,today,false) collection
  from base b join cells c on c.id=b.id left join last_payment lp on lp.contract_id=b.id
  group by b.id,b.client_id,b.customer,b.contract_number,b.client_code,b.service_type,b.plan,b.monthly_fee,b.status,b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,b.legacy_billing_day,b.debt_hold_status,lp.last_date
  having coalesce(p_state,'')='' or bool_or(case when p_state='vencido' then (c.cell->>'overdue')::boolean else c.cell->>'state'=p_state end)
 ), cash_events as materialized(
  select p.id,p.amount,p.received_at at time zone 'America/Lima' occurred from public.invoice_payments p join grouped g on g.id=p.contract_id where p.zone_id=p_zone
  union all select p.id,-p.amount,p.reversed_at at time zone 'America/Lima' from public.invoice_payments p join grouped g on g.id=p.contract_id where p.zone_id=p_zone and p.reversed_at is not null
 )
 select jsonb_build_object('year',p_year,'zoneId',p_zone,'page',p_page,'pageSize',25,'total',(select count(*) from grouped),
  'rows',coalesce((select jsonb_agg(to_jsonb(x)-'billed'-'paid'-'due') from(select * from grouped order by customer,id limit 25 offset(p_page-1)*25)x),'[]'::jsonb),
  'totals',jsonb_build_object('billed',coalesce((select sum(billed) from grouped),0),'paid',coalesce((select sum(paid) from grouped),0),'due',coalesce((select sum(due) from grouped),0),
   'received',coalesce((select sum(amount) from cash_events where occurred>=start_at and occurred<end_at),0)),
  'monthlyTotals',coalesce((select jsonb_agg(x order by month) from(select c.month,sum(c.amount) amount,sum(c.paid) paid,sum(c.due) due from cells c join grouped g on g.id=c.id group by c.month)x),'[]'::jsonb),
  'basis','Mensualidad por inicio de período; saldos actuales. Dinero por fecha de recepción/reverso; zona congelada en pago. collection=indicador informativo de modalidad/vencimiento (fase 7C), nunca ejecuta cortes. legacy_billing_day=dia de emision ya existente (fase 2/119), solo sugerido, nunca confirmado (fase 8).') into answer;
 return answer;
end $$;
revoke all on function public.finance_pon_matrix(uuid,integer,integer,text,text) from public,anon,service_role;
grant execute on function public.finance_pon_matrix(uuid,integer,integer,text,text) to authenticated;

commit;
