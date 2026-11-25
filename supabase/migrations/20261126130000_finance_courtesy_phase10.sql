-- Fase 10 LOCAL. Requiere fases 2-9 (7C/8/9 incluidas). No aplicada en producción.
-- Pedido real del propietario: reutilizar la columna "is_courtesy"/"courtesy_reason"
-- YA existente (fase 47, 20260930160000_fase47_cortesia_servicio_gratuito.sql,
-- editable hoy solo vía el formulario general de ClientServiceDetailView.vue,
-- sin auditoría dedicada) para que el ciclo comercial de cobranza (fase 7C)
-- la reconozca: un contrato de cortesía NUNCA debe contarse como deuda
-- exigible, morosidad, ingreso proyectado ni elegible para corte — y debe
-- mostrarse como "CORTESÍA" en la matriz de cobranza por PON, nunca como
-- "sin configurar" (que implicaría que falta un dato, cuando en realidad el
-- contrato nunca va a tener/needs condiciones comerciales de cobro).
-- IMPORTANTE (pedido explícito): un monthly_fee=0 NUNCA se asume cortesía
-- por sí solo — el único criterio es la columna is_courtesy, confirmada por
-- un administrador; esta fase no infiere nada a partir del importe.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- finance_contract_collection_status cambia de firma (agrega p_is_courtesy
-- al final) - CREATE OR REPLACE no permite agregar un parametro sin default
-- de forma segura aqui porque queremos que TODOS los llamadores existentes
-- se actualicen explicitamente en esta misma migracion (no dejar un
-- comportamiento implicito). Se elimina la version de 6 argumentos (fase 7C)
-- y se crea la de 7, para no dejar una sobrecarga huerfana en el catalogo.
drop function if exists public.finance_contract_collection_status(text,integer,integer,date,date,boolean);

create function public.finance_contract_collection_status(
  p_billing_modality text, p_billing_day integer, p_grace_days integer,
  p_last_payment date, p_today date, p_already_paid boolean, p_is_courtesy boolean default false
) returns jsonb
language plpgsql immutable as $$
declare base jsonb; bucket text;
begin
 -- Cortesia manda SIEMPRE, antes de mirar modalidad/dia: nunca es "sin
 -- configurar" (no le falta un dato, nunca necesita condiciones de cobro) y
 -- nunca es elegible para corte/morosidad, tenga o no modalidad confirmada.
 if p_is_courtesy then
  return jsonb_build_object('bucket','cortesia','nextDueDate',null,'graceEndDate',null,
   'eligibleForSuspension',false,'lastPaymentDate',p_last_payment);
 end if;
 if p_billing_modality is null or p_billing_day is null or p_last_payment is null then
  return jsonb_build_object('bucket','sin_configurar','nextDueDate',null,'graceEndDate',null,
   'eligibleForSuspension',false,'lastPaymentDate',p_last_payment);
 end if;
 base:=public.finance_billing_state(p_billing_modality,p_billing_day,p_grace_days,p_last_payment,p_today,p_already_paid);
 bucket:=case when base->>'state'<>'pendiente_no_vencido' then base->>'state'
  when (base->>'daysPastDue')::integer=0 then 'vence_hoy' else 'pendiente_futuro' end;
 return base||jsonb_build_object('bucket',bucket,'lastPaymentDate',p_last_payment);
end $$;
revoke all on function public.finance_contract_collection_status(text,integer,integer,date,date,boolean,boolean) from public,anon,service_role;
grant execute on function public.finance_contract_collection_status(text,integer,integer,date,date,boolean,boolean) to authenticated;

-- Confirmar/corregir el estado de cortesia de un contrato, auditado igual
-- que finance_set_billing_terms (responsable, motivo, fecha, valor anterior
-- y nuevo vía log_admin_audit) - reutiliza is_courtesy/courtesy_reason, NO
-- crea columnas nuevas. Antes solo se podia cambiar sin auditoria desde el
-- formulario general del contrato; esta via queda como la forma confirmada
-- para uso financiero (la UI puede seguir usando el formulario general para
-- la marca inicial, pero cualquier cambio desde Facturacion queda auditado).
create function public.finance_set_courtesy(
  p_operation_id uuid, p_contract_id uuid, p_is_courtesy boolean, p_reason text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); c public.service_contracts%rowtype; payload jsonb; previous record;
begin
 if p_operation_id is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
  raise exception 'Motivo inválido (mínimo cinco caracteres)';
 end if;
 payload:=jsonb_build_object('contract',p_contract_id,'isCourtesy',p_is_courtesy,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,7));
 select actor_id,nuevo into previous from public.admin_audit_log where tabla='service_contracts' and accion='courtesy_status' and entidad_id=p_operation_id::text;
 if found then
  if previous.actor_id<>actor or previous.nuevo->'payload'<>payload then raise exception 'Clave usada por otro cambio'; end if;
  return previous.nuevo->'result';
 end if;
 select * into strict c from public.service_contracts where id=p_contract_id for update;
 update public.service_contracts set is_courtesy=p_is_courtesy,
  courtesy_reason=case when p_is_courtesy then nullif(btrim(p_reason),'') else null end
  where id=c.id;
 perform public.log_admin_audit('service_contracts','courtesy_status',p_operation_id::text,
  jsonb_build_object('isCourtesy',c.is_courtesy,'courtesyReason',c.courtesy_reason),
  jsonb_build_object('payload',payload,'result',jsonb_build_object('isCourtesy',p_is_courtesy)),
  p_reason);
 return jsonb_build_object('isCourtesy',p_is_courtesy);
end $$;
revoke all on function public.finance_set_courtesy(uuid,uuid,boolean,text) from public,anon,service_role;
grant execute on function public.finance_set_courtesy(uuid,uuid,boolean,text) to authenticated;

-- Extiende finance_pon_matrix TAL COMO QUEDO tras fase 8 (agrega
-- legacy_billing_day) - unico cambio: agrega is_courtesy/courtesy_reason al
-- jsonb de cada fila y pasa is_courtesy a finance_contract_collection_status
-- para que el bucket de cobranza sea 'cortesia' cuando corresponda. El
-- resto del cuerpo (incluida la busqueda, el saldo inicial, el credito y
-- legacy_billing_day) se preserva exactamente igual.
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
   c.is_courtesy,c.courtesy_reason,
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
   b.finance_billing_modality as billing_modality,b.finance_billing_day as billing_day,b.finance_grace_days as grace_days,b.legacy_billing_day,b.debt_hold_status,
   b.is_courtesy,b.courtesy_reason,lp.last_date last_payment_date,
   public.finance_contract_collection_status(b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,lp.last_date,today,false,b.is_courtesy) collection
  from base b join cells c on c.id=b.id left join last_payment lp on lp.contract_id=b.id
  group by b.id,b.client_id,b.customer,b.contract_number,b.client_code,b.service_type,b.plan,b.monthly_fee,b.status,b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,b.legacy_billing_day,b.debt_hold_status,b.is_courtesy,b.courtesy_reason,lp.last_date
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
  'basis','Mensualidad por inicio de período; saldos actuales. Dinero por fecha de recepción/reverso; zona congelada en pago. collection=indicador informativo de modalidad/vencimiento (fase 7C), nunca ejecuta cortes. legacy_billing_day=dia de emision ya existente (fase 2/119), solo sugerido, nunca confirmado (fase 8). is_courtesy=servicio gratuito confirmado (fase 47/10): bucket collection siempre "cortesia", nunca deuda/mora/corte.') into answer;
 return answer;
end $$;
revoke all on function public.finance_pon_matrix(uuid,integer,integer,text,text) from public,anon,service_role;
grant execute on function public.finance_pon_matrix(uuid,integer,integer,text,text) to authenticated;

-- Extiende finance_collection_summary TAL COMO QUEDO tras fase 9 - agrega
-- is_courtesy a la proyeccion y un bucket "courtesy" explicito (contratos y
-- mensualidad de LISTA, nunca contados en dueToday/inGrace/overdueNoGrace ni
-- en notConfigured). total_contracts sigue contando TODOS los contratos
-- activos/suspendidos de la zona, cortesia incluidos (informativo).
create or replace function public.finance_collection_summary(p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); today date; answer jsonb;
begin
 today:=(now() at time zone 'America/Lima')::date;
 with base as materialized(
  select c.id,c.monthly_fee,c.finance_billing_modality,c.finance_billing_day,c.finance_grace_days,c.is_courtesy
  from public.service_contracts c
  where c.status::text in ('active','suspended') and (p_zone is null or c.zone_id=p_zone)
 ), last_payment as materialized(
  select p.contract_id,max((p.received_at at time zone 'America/Lima')::date) last_date
  from public.invoice_payments p join base b on b.id=p.contract_id where p.reversed_at is null group by p.contract_id
 ), status as materialized(
  select b.id,b.monthly_fee,
   (public.finance_contract_collection_status(b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,lp.last_date,today,false,b.is_courtesy)->>'bucket') bucket
  from base b left join last_payment lp on lp.contract_id=b.id
 )
 select jsonb_build_object('zoneId',p_zone,'asOf',today,'totalContracts',(select count(*) from base),
  'buckets',coalesce((select jsonb_agg(x order by bucket) from(select bucket,count(*) contracts,coalesce(sum(monthly_fee),0) amount from status group by bucket)x),'[]'::jsonb),
  'dueToday',jsonb_build_object('contracts',coalesce((select count(*) from status where bucket='vence_hoy'),0),'amount',coalesce((select sum(monthly_fee) from status where bucket='vence_hoy'),0)),
  'inGrace',jsonb_build_object('contracts',coalesce((select count(*) from status where bucket='en_prorroga'),0),'amount',coalesce((select sum(monthly_fee) from status where bucket='en_prorroga'),0)),
  'overdueNoGrace',jsonb_build_object('contracts',coalesce((select count(*) from status where bucket='vencido_sin_prorroga'),0),'amount',coalesce((select sum(monthly_fee) from status where bucket='vencido_sin_prorroga'),0)),
  'courtesy',jsonb_build_object('contracts',coalesce((select count(*) from status where bucket='cortesia'),0),'amount',coalesce((select sum(monthly_fee) from status where bucket='cortesia'),0)),
  'notConfigured',coalesce((select count(*) from status where bucket='sin_configurar'),0),
  'basis','Proyección por modalidad/ciclo comercial confirmado (fase 7C) sobre la mensualidad vigente — no es saldo facturado real. "Sin configurar" nunca se cuenta como al día ni como vencido. "Cortesía" (fase 47/10, confirmado por un administrador, nunca inferido de mensualidad S/0) nunca cuenta como deuda, mora ni elegible para corte.') into answer;
 return answer;
end $$;
revoke all on function public.finance_collection_summary(uuid) from public,anon,service_role;
grant execute on function public.finance_collection_summary(uuid) to authenticated;

-- Extiende finance_history TAL COMO QUEDO tras fase 7C (agrega billing_terms
-- al lado de monthly_fee) - agrega courtesy_status al mismo filtro de
-- auditoria, cero tablas nuevas.
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
  (l.tabla='service_contracts' and l.accion='billing_terms' and l.nuevo->'payload'->>'contract'=p_contract_id::text) or
  (l.tabla='service_contracts' and l.accion='courtesy_status' and l.nuevo->'payload'->>'contract'=p_contract_id::text)
  order by l.created_at desc,l.id desc limit 100)x),'[]'::jsonb)));
end $$;

commit;
