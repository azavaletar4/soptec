-- Fase 7C LOCAL. Requiere fases 2-7B. No aplicada en producción.
-- Reglas comerciales reales: pago adelantado (dispone de prórroga de
-- graceDays tras el vencimiento) vs pago cumplido (elegible para suspensión
-- el mismo día del vencimiento, sin prórroga). Día de facturación por
-- contrato, nunca asumido igual para todos ni a fin de mes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- NUNCA 'billing_day' a secas: esa columna ya existe desde fase 2
-- (20260910120000_fase2_esquema_inicial.sql, default 1, ampliada a 1-31 en
-- fase 119) y la usa activamente invoiceGenerationService.ts para la
-- facturacion mensual real de TODOS los contratos - agregarla de nuevo aqui
-- habria fallado en producción con "column already exists" y, de haberse
-- forzado con IF NOT EXISTS, habria mezclado dos conceptos distintos bajo
-- el mismo nombre. Prefijo 'finance_' (mismo patron ya usado en esta tabla
-- por finance_reconciled_at/finance_start_date) para las 3 columnas nuevas
-- de esta fase, sin tocar la columna 'billing_day' preexistente.
alter table public.service_contracts
  add column finance_billing_modality text check (finance_billing_modality in ('adelantado','cumplido')),
  add column finance_billing_day integer check (finance_billing_day between 1 and 31),
  add column finance_grace_days integer check (finance_grace_days >= 0);

comment on column public.service_contracts.finance_billing_modality is 'Fase 7C: pago adelantado (con prorroga) o pago cumplido (sin prorroga, exigible el mismo dia). NULL hasta que el administrador lo configure.';
comment on column public.service_contracts.finance_billing_day is 'Fase 7C: dia mensual de facturacion del contrato (1-31) para el ciclo comercial de cobranza, recortado al ultimo dia real del mes cuando corresponda. Nunca asumido igual para todos los contratos. Distinta de la columna "billing_day" preexistente (facturacion operativa, fase 2/119) - conceptos separados, nunca se fusionan.';
comment on column public.service_contracts.finance_grace_days is 'Fase 7C: dias calendario de prorroga tras el vencimiento. Solo tiene efecto si finance_billing_modality=adelantado; en cumplido el sistema ignora este valor (sin prorroga por regla de negocio).';

-- Mismo helper puro que src/lib/billingCycle.ts (nextCycleDate): recorta el
-- dia de facturacion al ultimo dia real del mes siguiente, sin arrastrar el
-- recorte de un mes corto al calculo del mes siguiente.
create function public.finance_next_cycle_date(p_from date, p_billing_day integer) returns date
language sql immutable as $$
 select least(
   (date_trunc('month', p_from) + interval '1 month' * 1)::date + (p_billing_day - 1),
   (date_trunc('month', p_from) + interval '2 month')::date - interval '1 day'
 )::date
$$;

-- Estado real de un ciclo de facturacion a una fecha de corte explicita.
-- Replica exactamente la logica de classifyBillingState (src/lib/billingCycle.ts),
-- unica fuente de verdad junto con esa funcion pura en TypeScript.
create function public.finance_billing_state(
  p_modality text, p_billing_day integer, p_grace_days integer,
  p_last_payment date, p_today date, p_already_paid boolean
) returns jsonb
language plpgsql immutable as $$
declare next_due date; grace_end date; grace integer; state text; eligible boolean;
begin
 if p_modality not in ('adelantado','cumplido') or p_billing_day not between 1 and 31 then
  raise exception 'Modalidad o día de facturación inválidos';
 end if;
 grace := case when p_modality='adelantado' then coalesce(p_grace_days,7) else 0 end;
 next_due := public.finance_next_cycle_date(p_last_payment, p_billing_day);
 grace_end := case when p_modality='adelantado' then next_due + grace else null end;
 if p_already_paid then
  state:='pagado'; eligible:=false;
 elsif p_modality='cumplido' then
  if p_today < next_due then state:='pendiente_no_vencido'; eligible:=false;
  else state:='vencido_sin_prorroga'; eligible:=true; end if;
 else
  if p_today <= next_due then state:='pendiente_no_vencido'; eligible:=false;
  elsif p_today <= grace_end then state:='en_prorroga'; eligible:=false;
  else state:='vencido_sin_prorroga'; eligible:=true; end if;
 end if;
 return jsonb_build_object('nextDueDate',next_due,'graceEndDate',grace_end,'state',state,
  'daysPastDue',p_today-next_due,'eligibleForSuspension',eligible);
end $$;

-- Configuracion comercial por contrato: solo ADMIN/SUPERADMIN, auditada,
-- idempotente por operation_id. No requiere finance_reconciled_at (es
-- configuracion inicial, no una correccion de un ciclo ya facturado) y
-- nunca toca pagos/recibos/periodos historicos ya confirmados.
create function public.finance_set_billing_terms(
  p_operation_id uuid, p_contract_id uuid, p_modality text,
  p_billing_day integer, p_grace_days integer, p_reason text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); c public.service_contracts%rowtype; payload jsonb; previous record;
begin
 if p_operation_id is null or p_modality not in ('adelantado','cumplido') or p_billing_day not between 1 and 31
  or (p_grace_days is not null and p_grace_days<0) or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
  raise exception 'Condiciones comerciales o motivo inválidos';
 end if;
 payload:=jsonb_build_object('contract',p_contract_id,'modality',p_modality,'billingDay',p_billing_day,'graceDays',p_grace_days,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,4));
 select actor_id,nuevo into previous from public.admin_audit_log where tabla='service_contracts' and accion='billing_terms' and entidad_id=p_operation_id::text;
 if found then
  if previous.actor_id<>actor or previous.nuevo->'payload'<>payload then raise exception 'Clave usada por otro cambio'; end if;
  return previous.nuevo->'result';
 end if;
 select * into strict c from public.service_contracts where id=p_contract_id for update;
 update public.service_contracts set finance_billing_modality=p_modality, finance_billing_day=p_billing_day, finance_grace_days=p_grace_days where id=c.id;
 perform public.log_admin_audit('service_contracts','billing_terms',p_operation_id::text,
  jsonb_build_object('billingModality',c.finance_billing_modality,'billingDay',c.finance_billing_day,'graceDays',c.finance_grace_days),
  jsonb_build_object('payload',payload,'result',jsonb_build_object('billingModality',p_modality,'billingDay',p_billing_day,'graceDays',p_grace_days)),
  p_reason);
 return jsonb_build_object('billingModality',p_modality,'billingDay',p_billing_day,'graceDays',p_grace_days);
end $$;
revoke all on function public.finance_set_billing_terms(uuid,uuid,text,integer,integer,text) from public,anon,service_role;
grant execute on function public.finance_set_billing_terms(uuid,uuid,text,integer,integer,text) to authenticated;

-- Estado de cobranza de UN contrato para presentacion (badge de modalidad +
-- bucket de cobranza). 'sin_configurar' si el administrador todavia no fijo
-- billing_modality/billing_day (nunca se adivina una modalidad por defecto).
-- Separa "vence_hoy" de "pendiente_futuro" dentro de pendiente_no_vencido,
-- mismo criterio que presentationBucket() en src/lib/billingCycle.ts.
create function public.finance_contract_collection_status(
  p_billing_modality text, p_billing_day integer, p_grace_days integer,
  p_last_payment date, p_today date, p_already_paid boolean
) returns jsonb
language plpgsql immutable as $$
declare base jsonb; bucket text;
begin
 if p_billing_modality is null or p_billing_day is null or p_last_payment is null then
  return jsonb_build_object('bucket','sin_configurar','nextDueDate',null,'graceEndDate',null,
   'eligibleForSuspension',false,'lastPaymentDate',p_last_payment);
 end if;
 base:=public.finance_billing_state(p_billing_modality,p_billing_day,p_grace_days,p_last_payment,p_today,p_already_paid);
 -- Mismo vocabulario que PresentationBucket (src/lib/billingCycle.ts): dentro
 -- de 'pendiente_no_vencido' se separa 'vence_hoy' (daysPastDue=0) de
 -- 'pendiente_futuro' (el resto) - nunca se deja el nombre de estado crudo.
 bucket:=case when base->>'state'<>'pendiente_no_vencido' then base->>'state'
  when (base->>'daysPastDue')::integer=0 then 'vence_hoy' else 'pendiente_futuro' end;
 return base||jsonb_build_object('bucket',bucket,'lastPaymentDate',p_last_payment);
end $$;
revoke all on function public.finance_contract_collection_status(text,integer,integer,date,date,boolean) from public,anon,service_role;
grant execute on function public.finance_contract_collection_status(text,integer,integer,date,date,boolean) to authenticated;

-- Extiende finance_pon_matrix TAL COMO QUEDÓ tras fase 7b (búsqueda por DNI,
-- la ultima version real antes de esta fase - NUNCA la version original de
-- fase 3, que ya no refleja fase 5/6/7b) con las condiciones comerciales y
-- el bucket de cobranza de fase 7C. Solo agrega claves nuevas al jsonb de
-- cada fila; el resto del cuerpo (saldo inicial, credito, estados por
-- factura, busqueda por DNI) se preserva sin tocar.
-- "last_payment" usa la fecha real del ultimo pago no reversado del
-- contrato (sin importar el periodo) como ancla del ciclo, igual que en el
-- Excel ("pago DD/MM"): nunca asume el dia de hoy ni el periodo facturado.
create or replace function public.finance_pon_matrix(p_zone uuid,p_year integer,p_page integer default 1,p_search text default '',p_state text default '') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); start_at date; end_at date; today date; answer jsonb;
begin
 if p_zone is null or p_year is null or p_year not between 2020 and 2100 or p_page is null or p_page not between 1 and 100000 or length(coalesce(p_search,''))>100 or coalesce(p_state,'') not in ('','pagado','parcial','vencido','pendiente','adelantado','exonerado','sin_facturacion') then raise exception 'Seleccione una PON/zona, año y filtros válidos'; end if;
 start_at:=make_date(p_year,1,1);end_at:=make_date(p_year+1,1,1);
 today:=(now() at time zone 'America/Lima')::date;
 with base as materialized(
  select c.id,c.client_id,c.contract_number,c.client_code,c.service_type,c.monthly_fee,c.status,pl.name plan,
   c.finance_billing_modality,c.finance_billing_day,c.finance_grace_days,c.debt_hold_status::text debt_hold_status,
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
   b.finance_billing_modality as billing_modality,b.finance_billing_day as billing_day,b.finance_grace_days as grace_days,b.debt_hold_status,lp.last_date last_payment_date,
   public.finance_contract_collection_status(b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,lp.last_date,today,false) collection
  from base b join cells c on c.id=b.id left join last_payment lp on lp.contract_id=b.id
  group by b.id,b.client_id,b.customer,b.contract_number,b.client_code,b.service_type,b.plan,b.monthly_fee,b.status,b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,b.debt_hold_status,lp.last_date
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
  'basis','Mensualidad por inicio de período; saldos actuales. Dinero por fecha de recepción/reverso; zona congelada en pago. collection=indicador informativo de modalidad/vencimiento (fase 7C), nunca ejecuta cortes.') into answer;
 return answer;
end $$;
revoke all on function public.finance_pon_matrix(uuid,integer,integer,text,text) from public,anon,service_role;
grant execute on function public.finance_pon_matrix(uuid,integer,integer,text,text) to authenticated;

-- Extiende finance_history TAL COMO QUEDÓ tras fase 6 (saldo inicial a favor:
-- openingCredits/openingApplications/openingBalances, received_date_only -
-- la ultima version real antes de esta fase, NUNCA la original de fase 3)
-- para incluir tambien el historial de condiciones comerciales
-- (billing_terms) junto al de mensualidad personalizada (monthly_fee) que ya
-- incluia - reutiliza admin_audit_log, cero tablas nuevas.
create or replace function public.finance_history(p_contract_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor();
begin
 return(with pay as materialized(select * from public.invoice_payments where contract_id=p_contract_id),invs as materialized(select id from public.invoices where contract_id=p_contract_id)
 select jsonb_build_object(
 'payments',coalesce((select jsonb_agg(x) from(select p.id,p.amount,p.method,p.reference,p.reason,p.created_by,p.received_at,coalesce((p.receipt_document->>'receivedDateOnly')::boolean,false) received_date_only,p.result,p.reversed_at,p.reversed_by,p.reversal_reason,coalesce(p.receipt_snapshot->>'collector',p.created_by::text) collector,
  case when p.reversed_at is null then p.amount-coalesce((select sum(a.amount) from public.invoice_payment_allocations a where a.payment_id=p.id),0) else 0 end credit_remaining
  from pay p order by received_at desc,id limit 100)x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(x) from(select a.* from public.invoice_adjustments a join invs i on i.id=a.invoice_id order by a.created_at desc,a.id limit 100)x),'[]'::jsonb),
 'openingCredits',coalesce((select jsonb_agg(x) from(select m.id,i.contract_id,m.monto original,m.monto-coalesce((select sum(a.monto) from public.invoice_adjustments a where a.source_credit_movement_id=m.id and a.reversed_at is null),0) available,b.started_on from public.finance_import_items i join public.finance_import_batches b on b.id=i.batch_id join public.client_credit_movements m on m.id=(i.result->>'creditMovementId')::uuid where i.contract_id=p_contract_id and i.kind='opening_credit')x),'[]'::jsonb),
 'openingApplications',coalesce((select jsonb_agg(x) from(select l.entidad_id id,l.created_at,l.actor_id,l.motivo,l.nuevo->'result' result,exists(select 1 from public.admin_audit_log r where r.tabla='client_credit_movements' and r.accion='reverse_opening_credit' and r.nuevo->'payload'->>'application'=l.entidad_id) reversed from public.admin_audit_log l where l.tabla='client_credit_movements' and l.accion='apply_opening_credit' and l.nuevo->'result'->>'contractId'=p_contract_id::text order by l.created_at desc limit 100)x),'[]'::jsonb),
 'openingBalances',coalesce((select jsonb_agg(x) from(select i.kind,i.result,b.started_on,b.reason,b.actor_id,b.created_at from public.finance_import_items i join public.finance_import_batches b on b.id=i.batch_id where i.contract_id=p_contract_id and i.kind in ('opening_credit','opening_debt') order by b.created_at desc limit 100)x),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(x) from(select l.* from public.admin_audit_log l where
  (l.tabla='invoices' and l.entidad_id in(select id::text from invs)) or
  (l.tabla='invoice_payments' and (l.entidad_id in(select id::text from pay) or l.nuevo->'payload'->>'payment' in(select id::text from pay))) or
  (l.tabla='service_contracts' and l.accion='monthly_fee' and l.nuevo->'payload'->>'contract'=p_contract_id::text) or
  (l.tabla='service_contracts' and l.accion='billing_terms' and l.nuevo->'payload'->>'contract'=p_contract_id::text)
  order by l.created_at desc,l.id desc limit 100)x),'[]'::jsonb)));
end $$;

commit;
