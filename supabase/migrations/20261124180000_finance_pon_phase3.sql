-- Fase 3 LOCAL. Requiere fase 2; no ejecuta comandos ni habilita conciliación.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.invoice_payments
 add column reversed_at timestamptz,
 add column reversed_by uuid references public.profiles(id),
 add column reversal_reason text,
 add column reversal_operation_id uuid,
 add column reversal_result jsonb,
 add column zone_id uuid references public.zones(id),
 add column service_type text,
 add column receipt_snapshot jsonb;
create unique index invoice_payments_reversal_operation on public.invoice_payments(reversal_operation_id) where reversal_operation_id is not null;
alter table public.invoice_payment_allocations
 add column credit_applied numeric(14,2) not null default 0 check(credit_applied>=0 and credit_applied<=amount),
 add column applied_at timestamptz not null default now();
alter table public.invoice_adjustments
 add column source_payment_id uuid references public.invoice_payments(id),
 add column reversed_at timestamptz,
 add column reversed_by uuid references public.profiles(id);
-- Los índices existentes de contrato/period_start, factura/aplicación y zona se
-- reutilizan. No hay tabla por celda, reporte, gráfico ni nuevo libro paralelo.

create function public.finance_require_actor(p_admin boolean default false) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();
begin
 if not exists(select 1 from public.profiles where id=actor and active and
  (role::text in ('ADMIN','SUPERADMIN') or (not p_admin and role::text='FACTURACION'))) then
  raise exception 'Operador financiero activo requerido' using errcode='42501';
 end if;
 return actor;
end $$;
revoke all on function public.finance_require_actor(boolean) from public,anon,authenticated,service_role;

create function public.finance_capture_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 select c.zone_id,c.service_type,
 jsonb_build_object('version',1,'client',jsonb_build_object('name',cl.first_name||' '||cl.last_name,'document',cl.document_number),
  'contract',c.contract_number,'cintillo',c.client_code,'service',c.service_type,'plan',pl.name,
  'zone',z.name,'collector',coalesce(p.full_name,new.created_by::text),'timezone','America/Lima','currency','PEN',
  'periods',coalesce((select jsonb_agg(jsonb_build_object('invoice',i.invoice_number,'start',i.period_start,'end',i.period_end,'amount',i.amount,'dueBefore',i.amount_due) order by i.period_start,i.id)
   from public.invoices i where i.id in(select value::uuid from jsonb_array_elements_text(new.request_payload->'invoices'))),'[]'::jsonb))
 into new.zone_id,new.service_type,new.receipt_snapshot
 from public.service_contracts c join public.clients cl on cl.id=c.client_id
 left join public.plans pl on pl.id=c.plan_id left join public.zones z on z.id=c.zone_id
 left join public.profiles p on p.id=new.created_by where c.id=new.contract_id;
 return new;
end $$;
create trigger finance_capture_receipt before insert on public.invoice_payments for each row execute function public.finance_capture_receipt();

-- Delta compatible con pagos históricos conciliados: no inventa aplicaciones
-- para baselines anteriores al libro. Cada nueva operación deja auditoría.
create function public.finance_change_paid(p_invoice uuid,p_delta numeric,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inv public.invoices%rowtype; paid numeric(14,2); due numeric(14,2); reductions numeric(14,2);
begin
 select * into strict inv from public.invoices where id=p_invoice for update;
 paid:=coalesce(inv.amount_paid,0)+p_delta;
 if paid<0 then raise exception 'El reverso contradice el saldo conciliado'; end if;
 select coalesce(sum(monto),0) into reductions from public.invoice_adjustments where invoice_id=inv.id and reversed_at is null;
 due:=greatest(inv.amount-reductions-paid,0);
 update public.invoices set amount_paid=paid,amount_due=due,
 status=case when due>0 then 'pending'::public.invoice_status when paid=0 and reductions>0 then 'exonerada'::public.invoice_status else 'paid'::public.invoice_status end,
 paid_at=case when due>0 or paid=0 then null else coalesce((select max(p.received_at) from public.invoice_payment_allocations a join public.invoice_payments p on p.id=a.payment_id where a.invoice_id=inv.id and p.reversed_at is null),inv.paid_at) end,
 payment_method=(select p.method from public.invoice_payment_allocations a join public.invoice_payments p on p.id=a.payment_id where a.invoice_id=inv.id and p.reversed_at is null order by p.received_at desc,p.id limit 1)
 where id=inv.id;
 perform public.log_admin_audit('invoices','financial_delta',inv.id::text,
  jsonb_build_object('paid',inv.amount_paid,'due',inv.amount_due,'status',inv.status),
  jsonb_build_object('paid',paid,'due',due,'delta',p_delta),p_reason);
end $$;
revoke all on function public.finance_change_paid(uuid,numeric,text) from public,anon,authenticated,service_role;

create function public.finance_reverse_payment(p_operation_id uuid,p_payment_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); p public.invoice_payments%rowtype; allocation record; remaining numeric(14,2); balance numeric(14,2); outcome jsonb;
begin
 if p_operation_id is null or p_payment_id is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Operación y motivo de reversión requeridos'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,3));
 select * into p from public.invoice_payments where id=p_payment_id;
 if not found then raise exception 'Pago no encontrado'; end if;
 perform 1 from public.clients where id=p.client_id for update;
 perform 1 from public.service_contracts where id=p.contract_id for update;
 select * into p from public.invoice_payments where id=p_payment_id for update;
 if p.reversed_at is not null then
  if p.reversal_operation_id=p_operation_id and p.reversed_by=actor and p.reversal_reason=p_reason then return p.reversal_result; end if;
  raise exception 'El pago ya tiene un reverso registrado' using errcode='23505';
 end if;
 perform 1 from public.invoices where id in(select invoice_id from public.invoice_payment_allocations where payment_id=p.id union select invoice_id from public.invoice_adjustments where source_payment_id=p.id) order by id for update;
 select p.amount-coalesce(sum(amount),0) into remaining from public.invoice_payment_allocations where payment_id=p.id;
 select saldo_a_favor into balance from public.clients where id=p.client_id;
 if remaining<0 or remaining>balance then raise exception 'Crédito incompatible: revisar sus aplicaciones antes de revertir'; end if;
 update public.invoice_payments set reversed_at=now(),reversed_by=actor,reversal_reason=p_reason,reversal_operation_id=p_operation_id where id=p.id;
 update public.invoice_adjustments set reversed_at=now(),reversed_by=actor where source_payment_id=p.id and reversed_at is null;
 for allocation in select invoice_id,sum(delta) delta from(
  select invoice_id,-amount delta from public.invoice_payment_allocations where payment_id=p.id
  union all select invoice_id,0 delta from public.invoice_adjustments where source_payment_id=p.id) s group by invoice_id order by invoice_id loop
  perform public.finance_change_paid(allocation.invoice_id,allocation.delta,p_reason);
 end loop;
 if remaining>0 then
  update public.clients set saldo_a_favor=saldo_a_favor-remaining where id=p.client_id returning saldo_a_favor into balance;
  insert into public.client_credit_movements(client_id,tipo,monto,saldo_resultante,created_by) values(p.client_id,'ajuste_manual',-remaining,balance,actor);
 end if;
 outcome:=jsonb_build_object('paymentId',p.id,'operationId',p_operation_id,'reversedAmount',p.amount,'creditRemoved',remaining);
 update public.invoice_payments set reversal_result=outcome where id=p.id;
 perform public.log_admin_audit('invoice_payments','payment_reversal',p.id::text,
  jsonb_build_object('amount',p.amount,'reversed',false),outcome,p_reason);
 return outcome;
end $$;
revoke all on function public.finance_reverse_payment(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.finance_reverse_payment(uuid,uuid,text) to authenticated;

create function public.finance_apply_advance(p_operation_id uuid,p_payment_id uuid,p_invoice_ids uuid[],p_amount numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); p public.invoice_payments%rowtype; inv public.invoices%rowtype; ids uuid[]; remaining numeric(14,2); available numeric(14,2); take numeric(14,2); balance numeric(14,2); payload jsonb; prior record; result jsonb;
begin
 if p_operation_id is null or p_amount is null or p_amount<=0 or p_amount>99999999.99 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Importe o motivo inválido'; end if;
 select array_agg(x order by x) into ids from(select distinct unnest(p_invoice_ids) x)s;
 if coalesce(cardinality(ids),0) not between 1 and 50 or array_position(ids,null) is not null then raise exception 'Seleccione facturas válidas'; end if;
 payload:=jsonb_build_object('payment',p_payment_id,'invoices',ids,'amount',p_amount,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,3));
 select actor_id,nuevo into prior from public.admin_audit_log where tabla='invoice_payments' and accion='apply_advance' and entidad_id=p_operation_id::text;
 if found then
  if prior.actor_id<>actor or prior.nuevo->'payload'<>payload then raise exception 'Clave reutilizada con otra aplicación'; end if;
  return prior.nuevo->'result';
 end if;
 select * into p from public.invoice_payments where id=p_payment_id;
 if not found then raise exception 'Anticipo no encontrado'; end if;
 perform 1 from public.clients where id=p.client_id for update;
 perform 1 from public.service_contracts where id=p.contract_id and finance_reconciled_at is not null and finance_start_date<=(now() at time zone 'America/Lima')::date and status::text in ('active','suspended') for update;
 if not found then raise exception 'Contrato no conciliado o no elegible'; end if;
 select * into p from public.invoice_payments where id=p_payment_id for update;
 if p.reversed_at is not null then raise exception 'El anticipo está revertido'; end if;
 perform 1 from public.invoices where id=any(ids) order by id for update;
 if (select count(*) from public.invoices where id=any(ids) and contract_id=p.contract_id and client_id=p.client_id and finance_reconciled and status::text='pending' and amount_due>0)<>cardinality(ids) then raise exception 'Facturas sin conciliar o de otro contrato'; end if;
 select p.amount-coalesce(sum(amount),0) into available from public.invoice_payment_allocations where payment_id=p.id;
 select saldo_a_favor into balance from public.clients where id=p.client_id;
 if p_amount>available or p_amount>balance or p_amount>(select sum(amount_due) from public.invoices where id=any(ids)) then raise exception 'Anticipo insuficiente o aplicación superior al saldo'; end if;
 remaining:=p_amount;
 for inv in select * from public.invoices where id=any(ids) order by due_date,id loop
  take:=least(remaining,inv.amount_due);
  if take>0 then
   insert into public.invoice_payment_allocations(payment_id,invoice_id,amount,credit_applied,applied_at) values(p.id,inv.id,take,take,now())
    on conflict(payment_id,invoice_id) do update set amount=invoice_payment_allocations.amount+excluded.amount,credit_applied=invoice_payment_allocations.credit_applied+excluded.credit_applied,applied_at=now();
   perform public.finance_change_paid(inv.id,take,p_reason); remaining:=remaining-take;
  end if;
 end loop;
 update public.clients set saldo_a_favor=saldo_a_favor-p_amount where id=p.client_id returning saldo_a_favor into balance;
 insert into public.client_credit_movements(client_id,tipo,monto,saldo_resultante,created_by) values(p.client_id,'consumo_saldo_favor',-p_amount,balance,actor);
 result:=jsonb_build_object('paymentId',p.id,'applied',p_amount,'remainingCredit',available-p_amount);
 perform public.log_admin_audit('invoice_payments','apply_advance',p_operation_id::text,null,jsonb_build_object('payload',payload,'result',result),p_reason);
 return result;
end $$;
revoke all on function public.finance_apply_advance(uuid,uuid,uuid[],numeric,text) from public,anon,service_role;
grant execute on function public.finance_apply_advance(uuid,uuid,uuid[],numeric,text) to authenticated;

create function public.finance_promo_3_1(p_operation_id uuid,p_contract_id uuid,p_invoice_ids uuid[],p_method text,p_reference text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); inv public.invoices%rowtype; ids uuid[]; paid_ids uuid[]; client uuid; price numeric(14,2); total numeric(14,2); last_end date; n integer:=0; request jsonb; previous public.invoice_payments%rowtype; outcome jsonb;
begin
 if p_operation_id is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Motivo y operación requeridos'; end if;
 select array_agg(x order by x) into ids from(select distinct unnest(p_invoice_ids)x)s;
 if coalesce(cardinality(ids),0)<>4 or array_position(ids,null) is not null then raise exception 'Seleccione cuatro mensualidades explícitas'; end if;
 request:=jsonb_build_object('contract',p_contract_id,'invoices',ids,'method',p_method,'reference',p_reference,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,3));
 select * into previous from public.invoice_payments where id=p_operation_id;
 if found then
  if previous.created_by<>actor or previous.request_payload->'promotionRequest' is distinct from request then raise exception 'Clave usada por otra operación'; end if;
  if previous.reversed_at is not null then raise exception 'La promoción fue revertida; consulte el historial'; end if;
  return previous.result;
 end if;
 select client_id into client from public.service_contracts where id=p_contract_id;
 perform 1 from public.clients where id=client for update;
 perform 1 from public.service_contracts where id=p_contract_id and finance_reconciled_at is not null and status::text='active' for update;
 if not found then raise exception 'Contrato activo y conciliado requerido'; end if;
 perform 1 from public.invoices where id=any(ids) order by id for update;
 if (select count(*) from public.invoices where id=any(ids) and contract_id=p_contract_id and client_id=client and finance_reconciled and status::text='pending' and coalesce(amount_paid,0)=0 and amount_due=amount and amount>0)<>4 then raise exception 'Mensualidades sin conciliar, ya pagadas o con reducciones'; end if;
 for inv in select * from public.invoices where id=any(ids) order by period_start,id loop
  n:=n+1;
  if inv.period_start<(now() at time zone 'America/Lima')::date or inv.period_end-inv.period_start not between 27 and 30 or (last_end is not null and inv.period_start<>last_end+1) then raise exception 'Requiere cuatro mensualidades futuras, completas y consecutivas; revise las reglas comerciales'; end if;
  if price is null then price:=inv.amount; end if;
  if price<>inv.amount or exists(select 1 from public.invoice_adjustments where invoice_id=inv.id and reversed_at is null) then raise exception 'Importes variables o descuentos previos requieren revisión comercial'; end if;
  last_end:=inv.period_end;
  if n<=3 then paid_ids:=array_append(paid_ids,inv.id); end if;
 end loop;
 total:=price*3;
 outcome:=public.finance_record_payment(p_operation_id,p_contract_id,paid_ids,total,p_method,p_reference,p_reason);
 update public.invoice_payments set request_payload=request_payload||jsonb_build_object('promotionRequest',request),result=outcome||jsonb_build_object('promotion','3+1','freeInvoice',inv.id),
  receipt_snapshot=receipt_snapshot||jsonb_build_object('promotion','3+1','freePeriod',jsonb_build_object('invoice',inv.invoice_number,'start',inv.period_start,'end',inv.period_end,'discount',price)) where id=p_operation_id;
 insert into public.invoice_adjustments(invoice_id,tipo,descripcion,monto,operation_id,created_by,source_payment_id) values(inv.id,'promo_4to_gratis',p_reason,price,p_operation_id,actor,p_operation_id);
 perform public.finance_change_paid(inv.id,0,p_reason);
 perform public.log_admin_audit('invoice_payments','promo_3_1',p_operation_id::text,null,jsonb_build_object('freeInvoice',inv.id,'discount',price,'cashReceived',total),p_reason);
 return (select p.result from public.invoice_payments p where p.id=p_operation_id);
end $$;
revoke all on function public.finance_promo_3_1(uuid,uuid,uuid[],text,text,text) from public,anon,service_role;
grant execute on function public.finance_promo_3_1(uuid,uuid,uuid[],text,text,text) to authenticated;

create function public.finance_set_monthly_fee(p_operation_id uuid,p_contract_id uuid,p_amount numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); c public.service_contracts%rowtype; payload jsonb; previous record;
begin
 if p_operation_id is null or p_amount is null or p_amount<=0 or p_amount>99999999.99 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Mensualidad o motivo inválido'; end if;
 payload:=jsonb_build_object('contract',p_contract_id,'amount',p_amount,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,3));
 select actor_id,nuevo into previous from public.admin_audit_log where tabla='service_contracts' and accion='monthly_fee' and entidad_id=p_operation_id::text;
 if found then
  if previous.actor_id<>actor or previous.nuevo->'payload'<>payload then raise exception 'Clave usada por otro cambio'; end if; return previous.nuevo->'result';
 end if;
 select * into c from public.service_contracts where id=p_contract_id for update;
 if not found or c.finance_reconciled_at is null then raise exception 'Contrato conciliado requerido'; end if;
 update public.service_contracts set monthly_fee=p_amount where id=c.id;
 perform public.log_admin_audit('service_contracts','monthly_fee',p_operation_id::text,jsonb_build_object('monthly_fee',c.monthly_fee),jsonb_build_object('payload',payload,'result',jsonb_build_object('monthlyFee',p_amount)),p_reason);
 return jsonb_build_object('monthlyFee',p_amount);
end $$;
revoke all on function public.finance_set_monthly_fee(uuid,uuid,numeric,text) from public,anon,service_role;
grant execute on function public.finance_set_monthly_fee(uuid,uuid,numeric,text) to authenticated;

create function public.finance_pon_matrix(p_zone uuid,p_year integer,p_page integer default 1,p_search text default '',p_state text default '') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); start_at date; end_at date; answer jsonb;
begin
 if p_zone is null or p_year is null or p_year not between 2020 and 2100 or p_page is null or p_page not between 1 and 100000 or length(coalesce(p_search,''))>100 or coalesce(p_state,'') not in ('','pagado','parcial','vencido','pendiente','adelantado','exonerado','sin_facturacion') then raise exception 'Seleccione una PON/zona, año y filtros válidos'; end if;
 start_at:=make_date(p_year,1,1);end_at:=make_date(p_year+1,1,1);
 with base as materialized(
  select c.id,c.client_id,c.contract_number,c.client_code,c.service_type,c.monthly_fee,c.status,pl.name plan,
   cl.first_name||' '||cl.last_name customer
  from public.service_contracts c join public.clients cl on cl.id=c.client_id left join public.plans pl on pl.id=c.plan_id
  where c.zone_id=p_zone and (coalesce(p_search,'')='' or position(lower(p_search) in lower(coalesce(c.contract_number,'')||' '||coalesce(c.client_code,'')||' '||cl.first_name||' '||cl.last_name))>0)
 ), inv as materialized(
  select i.* from public.invoices i join base b on b.id=i.contract_id where i.period_start>=start_at and i.period_start<end_at and i.status<>'cancelled'
 ), payment_info as(
  select a.invoice_id,sum(a.amount) allocated,bool_and((p.received_at at time zone 'America/Lima')::date<i.period_start) advance
  from public.invoice_payment_allocations a join inv i on i.id=a.invoice_id join public.invoice_payments p on p.id=a.payment_id and p.reversed_at is null group by a.invoice_id
 ), reductions as(
  select a.invoice_id,sum(a.monto) amount,bool_or(a.tipo='promo_4to_gratis') promotion
  from public.invoice_adjustments a join inv i on i.id=a.invoice_id where a.reversed_at is null group by a.invoice_id
 ), monthly as(
  select i.contract_id,extract(month from i.period_start)::integer as month,count(*) count,
   sum(i.amount) amount,sum(coalesce(i.amount_paid,0)) paid,sum(i.amount_due) due,
   bool_or(i.amount_due>0 and i.due_date<(now() at time zone 'America/Lima')::date) overdue,
   bool_or(not i.finance_reconciled) unreconciled,
   bool_and(i.status::text='exonerada' or coalesce(r.amount,0)>=i.amount) exempt,
   bool_or(coalesce(r.promotion,false)) promotion,
   bool_and(coalesce(pi.advance,false) and coalesce(pi.allocated,0)=coalesce(i.amount_paid,0)) advance
  from inv i left join payment_info pi on pi.invoice_id=i.id left join reductions r on r.invoice_id=i.id group by i.contract_id,extract(month from i.period_start)
 ), cells as materialized(
  select b.id,g.month,coalesce(m.amount,0) amount,coalesce(m.paid,0) paid,coalesce(m.due,0) due,
   jsonb_build_object('month',g.month,'amount',coalesce(m.amount,0)::text,'paid',coalesce(m.paid,0)::text,'due',coalesce(m.due,0)::text,'invoiceCount',coalesce(m.count,0),
    'overdue',coalesce(m.overdue,false),'unreconciled',coalesce(m.unreconciled,false),'promotion',coalesce(m.promotion,false),
    'state',case when m.count is null then 'sin_facturacion' when m.due=0 and m.exempt then 'exonerado' when m.due=0 and m.paid>0 and m.advance then 'adelantado' when m.due=0 then 'pagado' when m.paid>0 then 'parcial' when m.overdue then 'vencido' else 'pendiente' end) cell
  from base b cross join generate_series(1,12)g(month) left join monthly m on m.contract_id=b.id and m.month=g.month
 ), grouped as materialized(
  select b.id,b.client_id,b.customer,b.contract_number,b.client_code,b.service_type,b.plan,b.monthly_fee,b.status,
   'sin_verificar'::text technical_state,jsonb_agg(c.cell order by c.month) months,sum(c.amount) billed,sum(c.paid) paid,sum(c.due) due
  from base b join cells c on c.id=b.id group by b.id,b.client_id,b.customer,b.contract_number,b.client_code,b.service_type,b.plan,b.monthly_fee,b.status
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
  'basis','Mensualidad por inicio de período; saldos actuales. Dinero por fecha de recepción/reverso; zona congelada en pago.') into answer;
 return answer;
end $$;
revoke all on function public.finance_pon_matrix(uuid,integer,integer,text,text) from public,anon,service_role;
grant execute on function public.finance_pon_matrix(uuid,integer,integer,text,text) to authenticated;

create function public.finance_month_detail(p_contract uuid,p_year integer,p_month integer) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); first_day date;
begin
 if p_year is null or p_year not between 2020 and 2100 or p_month is null or p_month not between 1 and 12 then raise exception 'Período inválido'; end if;
 first_day:=make_date(p_year,p_month,1);
 return(with invoices as materialized(select i.* from public.invoices i where i.contract_id=p_contract and i.period_start>=first_day and i.period_start<first_day+interval '1 month' and i.status<>'cancelled')
 select jsonb_build_object('contract',p_contract,'year',p_year,'month',p_month,
 'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by period_start,id) from invoices i),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(x) from(select p.id,p.amount received,p.method,p.reference,p.received_at,p.created_by,p.reversed_at,p.reversal_reason,coalesce(p.receipt_snapshot->>'collector',p.created_by::text) collector,a.invoice_id,a.amount applied,a.credit_applied
  from public.invoice_payment_allocations a join invoices i on i.id=a.invoice_id join public.invoice_payments p on p.id=a.payment_id order by p.received_at desc,p.id limit 100)x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(to_jsonb(a)) from public.invoice_adjustments a join invoices i on i.id=a.invoice_id),'[]'::jsonb)));
end $$;
revoke all on function public.finance_month_detail(uuid,integer,integer) from public,anon,service_role;
grant execute on function public.finance_month_detail(uuid,integer,integer) to authenticated;

create or replace function public.finance_dashboard(p_from date,p_to date,p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); first_at timestamptz; end_at timestamptz; answer jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1096 then raise exception 'Rango inválido (máximo tres años)'; end if;
 first_at:=p_from::timestamp at time zone 'America/Lima';end_at:=(p_to+1)::timestamp at time zone 'America/Lima';
 with cohort as materialized(select i.*,c.zone_id,c.service_type from public.invoices i join public.service_contracts c on c.id=i.contract_id where i.created_at>=first_at and i.created_at<end_at and (p_zone is null or c.zone_id=p_zone)),
 events as materialized(
  select p.id,p.contract_id,p.zone_id,p.service_type,p.method,p.created_by,p.receipt_snapshot->>'collector' collector,p.received_at occurred,p.amount amount,false reversal from public.invoice_payments p where p.received_at>=first_at and p.received_at<end_at and (p_zone is null or p.zone_id=p_zone)
  union all select p.id,p.contract_id,p.zone_id,p.service_type,p.method,p.created_by,p.receipt_snapshot->>'collector',p.reversed_at,-p.amount,true from public.invoice_payments p where p.reversed_at>=first_at and p.reversed_at<end_at and (p_zone is null or p.zone_id=p_zone)
 ), series as(
  select m.month::date as month,coalesce(b.amount,0) billed,coalesce(c.amount,0) received from generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month')m(month)
  left join(select date_trunc('month',created_at at time zone 'America/Lima') as month,sum(amount) amount from cohort where status<>'cancelled' group by 1)b on b.month=m.month
  left join(select date_trunc('month',occurred at time zone 'America/Lima') as month,sum(amount) amount from events group by 1)c on c.month=m.month
 )
 select jsonb_build_object('billed',coalesce((select sum(amount) from cohort where status<>'cancelled'),0),
  'received',coalesce((select sum(amount) from events),0),'receivedGross',coalesce((select sum(amount) from events where not reversal),0),'reversed',-coalesce((select sum(amount) from events where reversal),0),
  'pending',coalesce((select sum(amount_due) from cohort where status='pending'),0),
  'overdue',coalesce((select sum(amount_due) from cohort where status='pending' and due_date<(now() at time zone 'America/Lima')::date),0),
  'discounts',coalesce((select sum(a.monto) from public.invoice_adjustments a join cohort i on i.id=a.invoice_id where a.tipo<>'saldo_a_favor' and a.reversed_at is null),0),
  'legacyReported',coalesce((select sum(i.amount_paid) from public.invoices i join public.service_contracts c on c.id=i.contract_id where i.paid_at>=first_at and i.paid_at<end_at and (p_zone is null or c.zone_id=p_zone) and not exists(select 1 from public.invoice_payment_allocations a where a.invoice_id=i.id)),0),
  'historicalRecovery',coalesce((select sum((a.amount-a.credit_applied)*case when e.reversal then -1 else 1 end) from events e join public.invoice_payment_allocations a on a.payment_id=e.id join public.invoices i on i.id=a.invoice_id where i.created_at<first_at),0),
  'unreconciled',(select count(*) from cohort where not finance_reconciled),
  'methods',coalesce((select jsonb_agg(x) from(select method,sum(amount) amount from events group by method order by method)x),'[]'::jsonb),
  'administrators',coalesce((select jsonb_agg(x) from(select created_by,coalesce(collector,created_by::text) collector,sum(amount) amount from events group by created_by,collector order by created_by)x),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(x) from(select (occurred at time zone 'America/Lima')::date as day,created_by,coalesce(collector,created_by::text) collector,method,sum(case when not reversal then amount else 0 end) received,-sum(case when reversal then amount else 0 end) reversed,sum(amount) net from events group by 1,created_by,collector,method order by 1 desc,created_by,method limit 200)x),'[]'::jsonb),
  'series',coalesce((select jsonb_agg(x order by month) from series x),'[]'::jsonb),
  'zones',coalesce((select jsonb_agg(x) from(select e.zone_id,coalesce(z.name,'Sin PON congelada') name,sum(e.amount) amount from events e left join public.zones z on z.id=e.zone_id group by e.zone_id,z.name order by name)x),'[]'::jsonb),
  'services',coalesce((select jsonb_agg(x) from(select service_type,sum(amount) amount from cohort where status<>'cancelled' group by service_type)x),'[]'::jsonb),
  'aging',jsonb_build_array(coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 1 and 30),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 31 and 60),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 61 and 90),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date>90),0))) into answer;
 return answer;
end $$;

create or replace function public.finance_history(p_contract_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor();
begin
 return(with pay as materialized(select * from public.invoice_payments where contract_id=p_contract_id),invs as materialized(select id from public.invoices where contract_id=p_contract_id)
 select jsonb_build_object(
 'payments',coalesce((select jsonb_agg(x) from(select p.id,p.amount,p.method,p.reference,p.reason,p.created_by,p.received_at,p.result,p.reversed_at,p.reversed_by,p.reversal_reason,coalesce(p.receipt_snapshot->>'collector',p.created_by::text) collector,
  case when p.reversed_at is null then p.amount-coalesce((select sum(a.amount) from public.invoice_payment_allocations a where a.payment_id=p.id),0) else 0 end credit_remaining
  from pay p order by received_at desc,id limit 100)x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(x) from(select a.* from public.invoice_adjustments a join invs i on i.id=a.invoice_id order by a.created_at desc,a.id limit 100)x),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(x) from(select l.* from public.admin_audit_log l where
  (l.tabla='invoices' and l.entidad_id in(select id::text from invs)) or
  (l.tabla='invoice_payments' and (l.entidad_id in(select id::text from pay) or l.nuevo->'payload'->>'payment' in(select id::text from pay))) or
  (l.tabla='service_contracts' and l.accion='monthly_fee' and l.nuevo->'payload'->>'contract'=p_contract_id::text)
  order by l.created_at desc,l.id desc limit 100)x),'[]'::jsonb)));
end $$;








-- GENERATED PHASE 2 COMPATIBILITY
create or replace function public.finance_record_payment(p_request_id uuid,p_contract_id uuid,p_invoice_ids uuid[],p_amount numeric,p_method text,p_reference text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); client uuid; inv public.invoices%rowtype; previous public.invoice_payments%rowtype;
 ids uuid[]; payload jsonb; remaining numeric(14,2); applied numeric(14,2); due numeric(14,2); credit numeric(14,2); outcome jsonb;
begin
 if not exists(select 1 from public.profiles where id=actor and active and role::text in ('ADMIN','SUPERADMIN','FACTURACION')) then raise exception 'Rol financiero activo requerido' using errcode='42501'; end if;
 if p_request_id is null or p_contract_id is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>99999999.99 then raise exception 'Importe PEN inválido (máximo dos decimales)'; end if;
 if p_method is null or p_method not in ('cash','yape','plin','transfer','other') or (p_method<>'cash' and nullif(btrim(p_reference),'') is null) or length(coalesce(p_reference,''))>100 or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Método, referencia o motivo inválidos'; end if;
 select coalesce(array_agg(x order by x),'{}'::uuid[]) into ids from(select distinct unnest(coalesce(p_invoice_ids,'{}'::uuid[])) x)s;
 if cardinality(ids)>50 or array_position(ids,null) is not null then raise exception 'Selección de facturas inválida'; end if;
 payload:=jsonb_build_object('contract',p_contract_id,'invoices',ids,'amount',p_amount,'method',p_method,'reference',nullif(lower(btrim(p_reference)),''),'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into previous from public.invoice_payments where id=p_request_id;
 if found then
  if previous.created_by<>actor or previous.request_payload<>payload then raise exception 'La clave de operación ya tiene otro contenido' using errcode='23505'; end if;
  return previous.result;
 end if;
 select client_id into client from public.service_contracts where id=p_contract_id;
 if client is null then raise exception 'Contrato no encontrado'; end if;
 perform 1 from public.clients where id=client for update;
 perform 1 from public.service_contracts where id=p_contract_id and client_id=client and finance_reconciled_at is not null and finance_start_date<=((now() at time zone 'America/Lima')::date) and status::text in ('active','suspended') for update;
 if not found then raise exception 'Contrato no habilitado: requiere conciliación inicial aprobada'; end if;
 perform 1 from public.invoices where id=any(ids) order by id for update;
 if (select count(*) from public.invoices where id=any(ids) and contract_id=p_contract_id and client_id=client and finance_reconciled and status::text='pending' and amount_due>0)<>cardinality(ids) then raise exception 'Facturas no conciliadas, saldadas o de otro contrato'; end if;
 insert into public.invoice_payments(id,contract_id,client_id,amount,method,reference,reason,created_by,request_payload)
 values(p_request_id,p_contract_id,client,p_amount,p_method,nullif(btrim(p_reference),''),btrim(p_reason),actor,payload);
 remaining:=p_amount;
 for inv in select * from public.invoices where id=any(ids) order by due_date,id loop
  due:=greatest(inv.amount-coalesce(inv.amount_paid,0)-coalesce((select sum(monto) from public.invoice_adjustments where invoice_id=inv.id and reversed_at is null),0),0);
  if due<>inv.amount_due then raise exception 'Saldo inconsistente; revisar conciliación'; end if;
  applied:=least(remaining,due);
  if applied>0 then
   insert into public.invoice_payment_allocations values(p_request_id,inv.id,applied);
   update public.invoices set amount_paid=coalesce(amount_paid,0)+applied,amount_due=due-applied,
    status=case when due=applied then 'paid'::public.invoice_status else 'pending'::public.invoice_status end,
    paid_at=case when due=applied then now() else paid_at end,payment_method=p_method where id=inv.id;
   perform public.log_admin_audit('invoices','payment_allocation',inv.id::text,jsonb_build_object('paid',inv.amount_paid,'due',inv.amount_due),(select jsonb_build_object('paid',i.amount_paid,'due',i.amount_due) from public.invoices i where i.id=inv.id),p_reason);
   remaining:=remaining-applied;
  end if;
 end loop;
 if remaining>0 then
  update public.clients set saldo_a_favor=saldo_a_favor+remaining where id=client returning saldo_a_favor into credit;
  insert into public.client_credit_movements(client_id,tipo,monto,saldo_resultante,created_by) values(client,'pago_excedente',remaining,credit,actor);
 end if;
 outcome:=jsonb_build_object('paymentId',p_request_id,'received',p_amount,'applied',p_amount-remaining,'credit',remaining,'reactivation',jsonb_build_object('attempted',false));
 update public.invoice_payments set result=outcome where id=p_request_id;
 perform public.log_admin_audit('invoice_payments','payment',p_request_id::text,null,jsonb_build_object('contract_id',p_contract_id,'amount',p_amount,'method',p_method,'credit',remaining),p_reason);
 return outcome;
end $$;
create or replace function public.finance_guard_fields() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare trusted name;
begin
 select pg_get_userbyid(proowner) into trusted from pg_proc where oid='public.finance_record_payment(uuid,uuid,uuid[],numeric,text,text,text)'::regprocedure;
 if current_user=trusted then return new; end if;
 if tg_table_name='clients' then
  if (tg_op='INSERT' and coalesce(new.saldo_a_favor,0)<>0) or (tg_op='UPDATE' and new.saldo_a_favor is distinct from old.saldo_a_favor) then raise exception 'El saldo requiere una operación financiera autorizada' using errcode='42501'; end if;
 elsif tg_table_name='service_contracts' then
  if (tg_op='INSERT' and (new.finance_reconciled_at is not null or new.finance_start_date is not null)) or (tg_op='UPDATE' and (new.finance_reconciled_at,new.finance_start_date) is distinct from (old.finance_reconciled_at,old.finance_start_date)) then raise exception 'La conciliación requiere un lote aprobado' using errcode='42501'; end if;
 else
  if tg_op='INSERT' then
   new.created_by:=auth.uid();
   if new.finance_reconciled or new.amount_paid is not null or new.paid_at is not null or new.status::text not in ('pending','exonerada') or (new.status::text='exonerada' and new.amount<>0) then raise exception 'Use el registro financiero autorizado' using errcode='42501'; end if;
   new.amount_due:=case when new.status::text='exonerada' then 0 else new.amount end;
  else
   if (new.finance_reconciled,new.amount_paid,new.paid_at,new.payment_method,new.created_by) is distinct from (old.finance_reconciled,old.amount_paid,old.paid_at,old.payment_method,old.created_by)
   or (new.status is distinct from old.status and not(old.status::text='pending' and new.status::text='cancelled' and coalesce(old.amount_paid,0)=0 and not exists(select 1 from public.invoice_adjustments where invoice_id=old.id))) then
    raise exception 'Use pagos o ajustes auditados; no se permite editar el cobro' using errcode='42501';
   end if;
   if (new.contract_id,new.client_id) is distinct from (old.contract_id,old.client_id) or new.amount is distinct from old.amount then
    if coalesce(old.amount_paid,0)>0 or exists(select 1 from public.invoice_adjustments where invoice_id=old.id) then raise exception 'La factura tiene movimientos; requiere corrección auditada'; end if;
   end if;
   new.amount_due:=case when new.status::text='cancelled' then 0 else greatest(new.amount-coalesce(new.amount_paid,0)-coalesce((select sum(monto) from public.invoice_adjustments where invoice_id=new.id and reversed_at is null),0),0) end;
  end if;
  if new.amount<0 or new.period_end<new.period_start or not exists(select 1 from public.service_contracts where id=new.contract_id and client_id=new.client_id) then raise exception 'Importe, período o identidad de contrato inválidos'; end if;
 end if;
 return new;
end $$;
CREATE OR REPLACE FUNCTION public.apply_invoice_credits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if new.status <> 'pending' or not new.finance_reconciled or not exists(select 1 from public.service_contracts where id=new.contract_id and finance_reconciled_at is not null and finance_start_date<=(now() at time zone 'America/Lima')::date) then
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
     order by created_at asc for update
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
   limit 1 for update of r;

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

  -- El dinero adelantado se aplica por fuente con finance_apply_advance.
  update public.invoices
     set amount_due = greatest(v_remaining, 0),
         status = case when v_remaining <= 0 then 'exonerada' else status end,
         paid_at = case when v_remaining <= 0 then null else paid_at end,
         payment_method = case when v_remaining <= 0 then null else payment_method end
   where id = new.id;

  if v_remaining<new.amount then
    perform public.log_admin_audit('invoices','commercial_credits',new.id::text,jsonb_build_object('due',new.amount),jsonb_build_object('due',greatest(v_remaining,0),'cashReceived',0),'Aplicación de descuentos aprobados');
  end if;
  return new;
end;
$function$
;
drop index public.invoice_payments_operation_unique;
create unique index invoice_payments_operation_unique on public.invoice_payments(method,lower(btrim(reference))) where reversed_at is null and nullif(btrim(reference),'') is not null;
create unique index finance_operation_audit_unique on public.admin_audit_log(tabla,accion,entidad_id) where accion in ('apply_advance','monthly_fee');

-- Un evento preciso por operación. Evita duplicar snapshot de UPDATE interno
-- además del evento financiero explícito. Las lecturas no emiten auditoría.
drop trigger finance_audit_invoice on public.invoices;
do $audit$ declare owner_name text; begin
 select pg_get_userbyid(proowner) into owner_name from pg_proc where oid='public.finance_record_payment(uuid,uuid,uuid[],numeric,text,text,text)'::regprocedure;
 execute format('create trigger finance_audit_invoice after insert or update on public.invoices for each row when(current_user <> %L) execute function public.finance_audit_invoice()',owner_name);
end $audit$;
create function public.finance_guard_fee() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare owner_name name; begin
 select pg_get_userbyid(proowner) into owner_name from pg_proc where oid='public.finance_set_monthly_fee(uuid,uuid,numeric,text)'::regprocedure;
 if old.finance_reconciled_at is not null and new.monthly_fee is distinct from old.monthly_fee and current_user<>owner_name then raise exception 'Use Mensualidad personalizada con motivo y auditoría' using errcode='42501'; end if;
 return new; end $$;
create trigger finance_guard_fee before update of monthly_fee on public.service_contracts for each row execute function public.finance_guard_fee();

commit;
