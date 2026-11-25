-- Fase 9 LOCAL. Requiere fases 2-8. No aplicada en producción.
-- Pedido real del propietario: "Resumen financiero" solo mostraba cifras por
-- facturacion/saldo (periodo elegido), sin distinguir recaudacion de HOY vs
-- del MES, ni cuanto vence hoy/esta en prorroga/esta vencido sin prorroga
-- segun el ciclo comercial YA confirmado (fase 7C) - nunca segun la fecha de
-- vencimiento de la factura, que es un concepto distinto (regla explicita
-- del propietario: "no confundir dia programado de pago con pago
-- efectivamente recibido").
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Extiende finance_dashboard TAL COMO QUEDÓ tras fase 5 (unica version real,
-- nunca redefinida despues) agregando 3 claves de solo lectura ancladas al
-- dia de hoy en Lima, independientes del rango p_from/p_to que el
-- administrador haya elegido para el resto del resumen: recaudado hoy,
-- recaudado en lo que va del mes y la fecha de corte usada. El resto del
-- cuerpo (cohort/events/series y todas las claves existentes) se preserva
-- exactamente igual.
create or replace function public.finance_dashboard(p_from date,p_to date,p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); first_at timestamptz; end_at timestamptz; today date; month_start date; answer jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1096 then raise exception 'Rango inválido (máximo tres años)'; end if;
 first_at:=p_from::timestamp at time zone 'America/Lima';end_at:=(p_to+1)::timestamp at time zone 'America/Lima';
 today:=(now() at time zone 'America/Lima')::date; month_start:=date_trunc('month',today)::date;
 with cohort as materialized(select i.*,c.zone_id,c.service_type from public.invoices i join public.service_contracts c on c.id=i.contract_id where i.finance_reconciled and i.created_at>=first_at and i.created_at<end_at and (p_zone is null or c.zone_id=p_zone)),
 events as materialized(
  select p.id,p.contract_id,p.zone_id,p.service_type,p.method,p.created_by,p.receipt_snapshot->>'collector' collector,p.received_at occurred,p.amount amount,false reversal from public.invoice_payments p where p.received_at>=first_at and p.received_at<end_at and (p_zone is null or p.zone_id=p_zone)
  union all select p.id,p.contract_id,p.zone_id,p.service_type,p.method,p.created_by,p.receipt_snapshot->>'collector',p.reversed_at,-p.amount,true from public.invoice_payments p where p.reversed_at>=first_at and p.reversed_at<end_at and (p_zone is null or p.zone_id=p_zone)
 ), series as(
  select m.month::date as month,coalesce(b.amount,0) billed,coalesce(c.amount,0) received from generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month')m(month)
  left join(select date_trunc('month',created_at at time zone 'America/Lima') as month,sum(amount) amount from cohort where status<>'cancelled' and finance_origin='operational' group by 1)b on b.month=m.month
  left join(select date_trunc('month',occurred at time zone 'America/Lima') as month,sum(amount) amount from events group by 1)c on c.month=m.month
 ),
 -- Recaudado hoy/mes: siempre anclado a la fecha real de Perú, nunca al
 -- rango p_from/p_to elegido para el resto del resumen (el administrador
 -- puede estar viendo un mes anterior y aun asi necesita saber "hoy, cuanto
 -- entro"). Mismo patron recibido/reversado que "events", consultado aparte
 -- porque su ventana es independiente del filtro de periodo.
 today_events as materialized(
  select p.amount,false reversal from public.invoice_payments p where p.received_at>=today::timestamp at time zone 'America/Lima' and p.received_at<(today+1)::timestamp at time zone 'America/Lima' and (p_zone is null or p.zone_id=p_zone)
  union all select -p.amount,true from public.invoice_payments p where p.reversed_at>=today::timestamp at time zone 'America/Lima' and p.reversed_at<(today+1)::timestamp at time zone 'America/Lima' and (p_zone is null or p.zone_id=p_zone)
 ), month_events as materialized(
  select p.amount,false reversal from public.invoice_payments p where p.received_at>=month_start::timestamp at time zone 'America/Lima' and p.received_at<(today+1)::timestamp at time zone 'America/Lima' and (p_zone is null or p.zone_id=p_zone)
  union all select -p.amount,true from public.invoice_payments p where p.reversed_at>=month_start::timestamp at time zone 'America/Lima' and p.reversed_at<(today+1)::timestamp at time zone 'America/Lima' and (p_zone is null or p.zone_id=p_zone)
 )
 select jsonb_build_object('openingBalance',coalesce((select sum(amount_due) from cohort where finance_origin='opening_balance' and status='pending'),0),'billed',coalesce((select sum(amount) from cohort where status<>'cancelled' and finance_origin='operational'),0),
  'received',coalesce((select sum(amount) from events),0),'receivedGross',coalesce((select sum(amount) from events where not reversal),0),'reversed',-coalesce((select sum(amount) from events where reversal),0),
  'pending',coalesce((select sum(amount_due) from cohort where status='pending'),0),
  'overdue',coalesce((select sum(amount_due) from cohort where status='pending' and due_date<(now() at time zone 'America/Lima')::date),0),
  'discounts',coalesce((select sum(a.monto) from public.invoice_adjustments a join cohort i on i.id=a.invoice_id where a.tipo<>'saldo_a_favor' and a.reversed_at is null),0),
  'legacyReported',coalesce((select sum(i.amount_paid) from public.invoices i join public.service_contracts c on c.id=i.contract_id where i.paid_at>=first_at and i.paid_at<end_at and (p_zone is null or c.zone_id=p_zone) and not exists(select 1 from public.invoice_payment_allocations a where a.invoice_id=i.id)),0),
  'historicalRecovery',coalesce((select sum((a.amount-a.credit_applied)*case when e.reversal then -1 else 1 end) from events e join public.invoice_payment_allocations a on a.payment_id=e.id join public.invoices i on i.id=a.invoice_id where i.created_at<first_at),0),
  'unreconciled',(select count(*) from public.invoices i join public.service_contracts c on c.id=i.contract_id where not i.finance_reconciled and i.created_at>=first_at and i.created_at<end_at and (p_zone is null or c.zone_id=p_zone)),
  'methods',coalesce((select jsonb_agg(x) from(select method,sum(amount) amount from events group by method order by method)x),'[]'::jsonb),
  'administrators',coalesce((select jsonb_agg(x) from(select created_by,coalesce(collector,created_by::text) collector,sum(amount) amount from events group by created_by,collector order by created_by)x),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(x) from(select (occurred at time zone 'America/Lima')::date as day,created_by,coalesce(collector,created_by::text) collector,method,sum(case when not reversal then amount else 0 end) received,-sum(case when reversal then amount else 0 end) reversed,sum(amount) net from events group by 1,created_by,collector,method order by 1 desc,created_by,method limit 200)x),'[]'::jsonb),
  'series',coalesce((select jsonb_agg(x order by month) from series x),'[]'::jsonb),
  'zones',coalesce((select jsonb_agg(x) from(select e.zone_id,coalesce(z.name,'Sin PON congelada') name,sum(e.amount) amount from events e left join public.zones z on z.id=e.zone_id group by e.zone_id,z.name order by name)x),'[]'::jsonb),
  'services',coalesce((select jsonb_agg(x) from(select service_type,sum(amount) amount from cohort where status<>'cancelled' and finance_origin='operational' group by service_type)x),'[]'::jsonb),
  'aging',jsonb_build_array(coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 1 and 30),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 31 and 60),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 61 and 90),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date>90),0)),
  'asOf',today,'receivedToday',coalesce((select sum(amount) from today_events),0),'receivedMonth',coalesce((select sum(amount) from month_events),0)) into answer;
 return answer;
end $$;
revoke all on function public.finance_dashboard(date,date,uuid) from public,anon,service_role;
grant execute on function public.finance_dashboard(date,date,uuid) to authenticated;

-- Nueva funcion de solo lectura: agrega, por contrato activo/suspendido, el
-- "bucket" de cobranza YA calculado por finance_contract_collection_status
-- (fase 7C) - misma logica exacta, nunca una aproximacion nueva basada en
-- due_date de factura. Un contrato sin modalidad/dia confirmado NUNCA se
-- cuenta como "al dia" ni como "vencido": cae en 'sin_configurar', reportado
-- aparte para no confundir ausencia de dato con mora real o saldo en cero.
-- Costo acotado: una fila por contrato activo/suspendido de la zona (o de
-- todas si no se filtra), sin paginar facturas ni pagos individuales.
create function public.finance_collection_summary(p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); today date; answer jsonb;
begin
 today:=(now() at time zone 'America/Lima')::date;
 with base as materialized(
  select c.id,c.monthly_fee,c.finance_billing_modality,c.finance_billing_day,c.finance_grace_days
  from public.service_contracts c
  where c.status::text in ('active','suspended') and (p_zone is null or c.zone_id=p_zone)
 ), last_payment as materialized(
  select p.contract_id,max((p.received_at at time zone 'America/Lima')::date) last_date
  from public.invoice_payments p join base b on b.id=p.contract_id where p.reversed_at is null group by p.contract_id
 ), status as materialized(
  select b.id,b.monthly_fee,
   (public.finance_contract_collection_status(b.finance_billing_modality,b.finance_billing_day,b.finance_grace_days,lp.last_date,today,false)->>'bucket') bucket
  from base b left join last_payment lp on lp.contract_id=b.id
 )
 select jsonb_build_object('zoneId',p_zone,'asOf',today,'totalContracts',(select count(*) from base),
  'buckets',coalesce((select jsonb_agg(x order by bucket) from(select bucket,count(*) contracts,coalesce(sum(monthly_fee),0) amount from status group by bucket)x),'[]'::jsonb),
  'dueToday',jsonb_build_object('contracts',coalesce((select count(*) from status where bucket='vence_hoy'),0),'amount',coalesce((select sum(monthly_fee) from status where bucket='vence_hoy'),0)),
  'inGrace',jsonb_build_object('contracts',coalesce((select count(*) from status where bucket='en_prorroga'),0),'amount',coalesce((select sum(monthly_fee) from status where bucket='en_prorroga'),0)),
  'overdueNoGrace',jsonb_build_object('contracts',coalesce((select count(*) from status where bucket='vencido_sin_prorroga'),0),'amount',coalesce((select sum(monthly_fee) from status where bucket='vencido_sin_prorroga'),0)),
  'notConfigured',coalesce((select count(*) from status where bucket='sin_configurar'),0),
  'basis','Proyección por modalidad/ciclo comercial confirmado (fase 7C) sobre la mensualidad vigente — no es saldo facturado real. "Sin configurar" nunca se cuenta como al día ni como vencido.') into answer;
 return answer;
end $$;
revoke all on function public.finance_collection_summary(uuid) from public,anon,service_role;
grant execute on function public.finance_collection_summary(uuid) to authenticated;

commit;
