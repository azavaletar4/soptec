-- LOCAL: requiere fases 2, 3, 4 y 5. No ejecutar en producción sin publicación aprobada.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.invoice_adjustments add column source_credit_movement_id uuid references public.client_credit_movements(id);
create index invoice_adjustments_opening_source on public.invoice_adjustments(source_credit_movement_id) where source_credit_movement_id is not null;
create unique index finance_opening_operation_unique on public.admin_audit_log(tabla,accion,entidad_id) where accion in ('apply_opening_credit','reverse_opening_credit');

create function public.finance_apply_opening_credit(p_operation_id uuid,p_source_id uuid,p_invoice_ids uuid[],p_amount numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); item public.finance_import_items%rowtype; c public.service_contracts%rowtype; inv public.invoices%rowtype; source public.client_credit_movements%rowtype;
 ids uuid[]; payload jsonb; prior record; result jsonb; available numeric(14,2); balance numeric(14,2); remaining numeric(14,2); take numeric(14,2); adjustment uuid; adjustments jsonb:='[]';
begin
 if p_operation_id is null or p_source_id is null or p_amount is null or p_amount<=0 or p_amount>99999999.99 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Operación, importe PEN o motivo inválidos';end if;
 select array_agg(x order by x) into ids from(select distinct unnest(p_invoice_ids)x)s;
 if coalesce(cardinality(ids),0) not between 1 and 50 or array_position(ids,null) is not null then raise exception 'Seleccione facturas verificadas';end if;
 payload:=jsonb_build_object('source',p_source_id,'invoices',ids,'amount',p_amount,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,8));
 select actor_id,nuevo into prior from public.admin_audit_log where tabla='client_credit_movements' and accion='apply_opening_credit' and entidad_id=p_operation_id::text;
 if found then if prior.actor_id<>actor or prior.nuevo->'payload'<>payload then raise exception 'Clave usada con otra aplicación';end if;return prior.nuevo->'result';end if;
 select i.* into item from public.finance_import_items i where i.kind='opening_credit' and i.result->>'creditMovementId'=p_source_id::text;
 if not found then raise exception 'Saldo inicial sin fuente conciliada';end if;
 select * into strict c from public.service_contracts where id=item.contract_id;
 perform 1 from public.clients where id=c.client_id for update;
 select * into c from public.service_contracts where id=c.id and finance_reconciled_at is not null and finance_start_date<=(now() at time zone 'America/Lima')::date and status::text in ('active','suspended') for update;
 if not found then raise exception 'Contrato no conciliado o no elegible';end if;
 select * into source from public.client_credit_movements where id=p_source_id and client_id=c.client_id and monto>0 for update;
 if not found then raise exception 'Fuente de crédito inconsistente';end if;
 perform 1 from public.invoices where id=any(ids) order by id for update;
 if (select count(*) from public.invoices where id=any(ids) and contract_id=c.id and client_id=c.client_id and finance_reconciled and status::text='pending' and amount_due>0)<>cardinality(ids) then raise exception 'Facturas no conciliadas o de otro contrato';end if;
 select source.monto-coalesce(sum(monto),0) into available from public.invoice_adjustments where source_credit_movement_id=p_source_id and reversed_at is null;
 select saldo_a_favor into balance from public.clients where id=c.client_id;
 if p_amount>available or p_amount>balance or p_amount>(select sum(amount_due) from public.invoices where id=any(ids)) then raise exception 'Saldo inicial insuficiente o aplicación superior a la deuda';end if;
 remaining:=p_amount;
 for inv in select * from public.invoices where id=any(ids) order by due_date,id loop
  take:=least(remaining,inv.amount_due);
  if take>0 then
   insert into public.invoice_adjustments(invoice_id,tipo,descripcion,monto,operation_id,created_by,source_credit_movement_id)
    values(inv.id,'saldo_a_favor',p_reason,take,gen_random_uuid(),actor,p_source_id) returning id into adjustment;
   adjustments:=adjustments||jsonb_build_array(adjustment);
   perform public.finance_change_paid(inv.id,0,p_reason);
   remaining:=remaining-take;
  end if;
 end loop;
 update public.clients set saldo_a_favor=saldo_a_favor-p_amount where id=c.client_id returning saldo_a_favor into balance;
 insert into public.client_credit_movements(client_id,tipo,monto,saldo_resultante,created_by) values(c.client_id,'consumo_saldo_favor',-p_amount,balance,actor);
 result:=jsonb_build_object('operationId',p_operation_id,'sourceId',p_source_id,'contractId',c.id,'applied',p_amount,'remainingCredit',available-p_amount,'adjustments',adjustments,'cashReceived',0);
 perform public.log_admin_audit('client_credit_movements','apply_opening_credit',p_operation_id::text,jsonb_build_object('available',available,'clientCredit',balance+p_amount),jsonb_build_object('payload',payload,'result',result),p_reason);
 return result;
end $$;
revoke all on function public.finance_apply_opening_credit(uuid,uuid,uuid[],numeric,text) from public,anon,service_role;
grant execute on function public.finance_apply_opening_credit(uuid,uuid,uuid[],numeric,text) to authenticated;

create function public.finance_reverse_opening_credit(p_operation_id uuid,p_application_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); original jsonb; payload jsonb; prior record; source public.client_credit_movements%rowtype; contract uuid; ids uuid[]; inv record; balance numeric(14,2); amount numeric(14,2); outcome jsonb;
begin
 if p_operation_id is null or p_application_id is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Operación y motivo requeridos';end if;
 payload:=jsonb_build_object('application',p_application_id,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,8));
 select actor_id,nuevo into prior from public.admin_audit_log where tabla='client_credit_movements' and accion='reverse_opening_credit' and entidad_id=p_operation_id::text;
 if found then if prior.actor_id<>actor or prior.nuevo->'payload'<>payload then raise exception 'Clave de reverso reutilizada';end if;return prior.nuevo->'result';end if;
 select nuevo->'result' into original from public.admin_audit_log where tabla='client_credit_movements' and accion='apply_opening_credit' and entidad_id=p_application_id::text;
 if not found then raise exception 'Aplicación de apertura no encontrada';end if;
 select * into strict source from public.client_credit_movements where id=(original->>'sourceId')::uuid;
 perform 1 from public.clients where id=source.client_id for update;
 contract:=(original->>'contractId')::uuid;
 perform 1 from public.service_contracts where id=contract for update;
 perform 1 from public.client_credit_movements where id=source.id for update;
 select array_agg(value::uuid) into ids from jsonb_array_elements_text(original->'adjustments');
 perform 1 from public.invoices where id in(select invoice_id from public.invoice_adjustments where id=any(ids)) order by id for update;
 perform 1 from public.invoice_adjustments where id=any(ids) order by id for update;
 if (select count(*) from public.invoice_adjustments where id=any(ids) and source_credit_movement_id=source.id and reversed_at is null)<>cardinality(ids) then raise exception 'La aplicación ya fue revertida o es inconsistente';end if;
 amount:=(original->>'applied')::numeric;
 update public.invoice_adjustments set reversed_at=now(),reversed_by=actor where id=any(ids);
 for inv in select distinct invoice_id from public.invoice_adjustments where id=any(ids) order by invoice_id loop perform public.finance_change_paid(inv.invoice_id,0,p_reason);end loop;
 update public.clients set saldo_a_favor=saldo_a_favor+amount where id=source.client_id returning saldo_a_favor into balance;
 insert into public.client_credit_movements(client_id,tipo,monto,saldo_resultante,created_by) values(source.client_id,'ajuste_manual',amount,balance,actor);
 outcome:=jsonb_build_object('applicationId',p_application_id,'restoredCredit',amount,'cashReceived',0);
 perform public.log_admin_audit('client_credit_movements','reverse_opening_credit',p_operation_id::text,null,jsonb_build_object('payload',payload,'result',outcome),p_reason);
 return outcome;
end $$;
revoke all on function public.finance_reverse_opening_credit(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.finance_reverse_opening_credit(uuid,uuid,text) to authenticated;
create function public.finance_search_contracts(p_search text,p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); needle text;
begin
 if length(btrim(coalesce(p_search,''))) not between 3 and 100 then raise exception 'Escribe entre 3 y 100 caracteres';end if;
 needle:='%'||replace(replace(replace(btrim(p_search),'\','\\'),'%','\%'),'_','\_')||'%';
 return coalesce((select jsonb_agg(x) from(select c.id,c.client_id,c.contract_number,c.client_code,c.service_type,c.status,c.monthly_fee,c.finance_reconciled_at is not null reconciled,cl.first_name||' '||cl.last_name customer,z.name zone
 from public.service_contracts c join public.clients cl on cl.id=c.client_id left join public.zones z on z.id=c.zone_id
 where (p_zone is null or c.zone_id=p_zone) and (c.contract_number ilike needle or c.client_code ilike needle or cl.first_name||' '||cl.last_name ilike needle)
 order by c.contract_number,c.id limit 20)x),'[]'::jsonb);
end $$;
revoke all on function public.finance_search_contracts(text,uuid) from public,anon,service_role;
grant execute on function public.finance_search_contracts(text,uuid) to authenticated;
-- GENERATED PHASE6 COMPATIBILITY
create or replace function public.finance_change_paid(p_invoice uuid,p_delta numeric,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inv public.invoices%rowtype; paid numeric(14,2); due numeric(14,2); reductions numeric(14,2); credits numeric(14,2);
begin
 select * into strict inv from public.invoices where id=p_invoice for update;
 paid:=coalesce(inv.amount_paid,0)+p_delta;
 if paid<0 then raise exception 'El reverso contradice el saldo conciliado'; end if;
 select coalesce(sum(monto),0),coalesce(sum(monto) filter(where tipo='saldo_a_favor'),0) into reductions,credits from public.invoice_adjustments where invoice_id=inv.id and reversed_at is null;
 due:=greatest(inv.amount-reductions-paid,0);
 update public.invoices set amount_paid=paid,amount_due=due,
 status=case when due>0 then 'pending'::public.invoice_status when paid=0 and reductions>0 and credits=0 then 'exonerada'::public.invoice_status else 'paid'::public.invoice_status end,
 paid_at=case when due>0 or paid=0 then null else coalesce((select max(p.received_at) from public.invoice_payment_allocations a join public.invoice_payments p on p.id=a.payment_id where a.invoice_id=inv.id and p.reversed_at is null),inv.paid_at) end,
 payment_method=(select p.method from public.invoice_payment_allocations a join public.invoice_payments p on p.id=a.payment_id where a.invoice_id=inv.id and p.reversed_at is null order by p.received_at desc,p.id limit 1)
 where id=inv.id;
 perform public.log_admin_audit('invoices','financial_delta',inv.id::text,
  jsonb_build_object('paid',inv.amount_paid,'due',inv.amount_due,'status',inv.status),
  jsonb_build_object('paid',paid,'due',due,'delta',p_delta),p_reason);
end $$;
create or replace function public.finance_pon_matrix(p_zone uuid,p_year integer,p_page integer default 1,p_search text default '',p_state text default '') returns jsonb
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
   'sin_verificar'::text technical_state,jsonb_agg(c.cell order by c.month) months,sum(c.issued) billed,sum(c.paid) paid,sum(c.due) due
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
 'openingApplications',coalesce((select jsonb_agg(x) from(select l.entidad_id id,l.created_at,l.actor_id,l.motivo,l.nuevo->'result' result,exists(select 1 from public.admin_audit_log r where r.tabla='client_credit_movements' and r.accion='reverse_opening_credit' and r.nuevo->'payload'->>'application'=l.entidad_id) reversed from public.admin_audit_log l where l.tabla='client_credit_movements' and l.accion='apply_opening_credit' and l.nuevo->'result'->>'contractId'=p_contract_id::text order by l.created_at desc limit 100)x),'[]'::jsonb),'openingBalances',coalesce((select jsonb_agg(x) from(select i.kind,i.result,b.started_on,b.reason,b.actor_id,b.created_at from public.finance_import_items i join public.finance_import_batches b on b.id=i.batch_id where i.contract_id=p_contract_id and i.kind in ('opening_credit','opening_debt') order by b.created_at desc limit 100)x),'[]'::jsonb),'audit',coalesce((select jsonb_agg(x) from(select l.* from public.admin_audit_log l where
  (l.tabla='invoices' and l.entidad_id in(select id::text from invs)) or
  (l.tabla='invoice_payments' and (l.entidad_id in(select id::text from pay) or l.nuevo->'payload'->>'payment' in(select id::text from pay))) or
  (l.tabla='service_contracts' and l.accion='monthly_fee' and l.nuevo->'payload'->>'contract'=p_contract_id::text)
  order by l.created_at desc,l.id desc limit 100)x),'[]'::jsonb)));
end $$;
commit;
