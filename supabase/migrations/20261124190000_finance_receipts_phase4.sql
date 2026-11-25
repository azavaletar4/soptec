-- Fase 4 LOCAL. Requiere fases 2/3. No backfill, conciliación ni equipos.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.invoice_payments add column receipt_number text unique,
 add column receipt_document jsonb;
-- Únicamente una fila por año. No es otro libro de pagos ni almacén de PDF.
create table public.finance_receipt_counters(
 year integer primary key check(year between 2020 and 2200),
 last_value bigint not null check(last_value between 1 and 99999999)
);
alter table public.finance_receipt_counters enable row level security;
revoke all on public.finance_receipt_counters from public,anon,authenticated,service_role;

create or replace function public.finance_capture_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 select c.zone_id,c.service_type,
 jsonb_build_object('version',1,'client',jsonb_build_object('name',cl.first_name||' '||cl.last_name,'document',cl.document_number),
  'contract',c.contract_number,'cintillo',c.client_code,'service',c.service_type,'plan',pl.name,'monthlyFee',c.monthly_fee,
  'zone',z.name,'collector',coalesce(p.full_name,new.created_by::text),'timezone','America/Lima','currency','PEN',
  'periods',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'invoice',i.invoice_number,'start',i.period_start,'end',i.period_end,'amount',i.amount,'dueBefore',i.amount_due) order by i.period_start,i.id)
   from public.invoices i where i.id in(select value::uuid from jsonb_array_elements_text(new.request_payload->'invoices'))),'[]'::jsonb))
 into new.zone_id,new.service_type,new.receipt_snapshot
 from public.service_contracts c join public.clients cl on cl.id=c.client_id
 left join public.plans pl on pl.id=c.plan_id left join public.zones z on z.id=c.zone_id
 left join public.profiles p on p.id=new.created_by where c.id=new.contract_id;
 return new;
end $$;

-- Congela el resultado al confirmar, antes de cualquier pago posterior incluso
-- si varios se registran dentro de una misma transacción.
create function public.finance_build_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare periods jsonb; balance numeric(14,2); partial boolean; early boolean;
begin
 if old.receipt_number is not null then return new; end if;
 if old.result is null and new.result is not null then
  if new.result->>'paymentId' is distinct from new.id::text or
   (new.result->>'received')::numeric is distinct from new.amount or new.receipt_snapshot is null then
   raise exception 'No se puede emitir una constancia sin pago confirmado';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('invoiceId',s.v->>'id','invoice',s.v->>'invoice',
   'start',s.v->>'start','end',s.v->>'end','amount',s.v->>'amount',
   'applied',(a.amount-a.credit_applied)::text,'balanceAfter',greatest((s.v->>'dueBefore')::numeric-a.amount+a.credit_applied,0)::text)
   order by s.v->>'start',s.v->>'id'),'[]'::jsonb),
   coalesce(bool_or((s.v->>'dueBefore')::numeric>a.amount-a.credit_applied),false),
   coalesce(bool_or((new.received_at at time zone 'America/Lima')::date<(s.v->>'start')::date),false)
  into periods,partial,early
  from jsonb_array_elements(new.receipt_snapshot->'periods')s(v)
  join public.invoice_payment_allocations a on a.payment_id=new.id and a.invoice_id=(s.v->>'id')::uuid
  where a.amount>a.credit_applied;
  select coalesce(sum(amount_due),0) into balance from public.invoices where contract_id=new.contract_id and status<>'cancelled';
  new.receipt_document:=jsonb_build_object('version',1,'business','Comunicaciones Rayco','paymentId',new.id,
   'receivedAt',new.received_at,'amount',new.amount::text,'method',new.method,
   'reference',new.reference,'collectorId',new.created_by,'periods',periods,
   'applied',new.result->>'applied','creditGenerated',new.result->>'credit','contractBalanceAfter',balance::text,
   'kind',case when partial then 'parcial' when early or (new.result->>'credit')::numeric>0 then 'adelantado' else 'completo' end,
   'inAdvance',early,'notice','Constancia interna de pago. No es un comprobante tributario ni electrónico SUNAT.');
 elsif old.receipt_document is not null and old.result->>'promotion' is null and new.result->>'promotion'='3+1' then
  -- La promoción completa la misma operación antes del COMMIT. El cuarto mes
  -- es descuento, no una aplicación monetaria adicional.
  new.receipt_document:=old.receipt_document||jsonb_build_object('promotion',new.receipt_snapshot->'freePeriod',
   'contractBalanceAfter',greatest((old.receipt_document->>'contractBalanceAfter')::numeric-(new.receipt_snapshot->'freePeriod'->>'discount')::numeric,0)::text);
 end if;
 return new;
end $$;
create trigger finance_build_receipt before update of result on public.invoice_payments for each row execute function public.finance_build_receipt();

create function public.finance_number_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.invoice_payments%rowtype; yr integer; seq bigint; num text;
begin
 select * into strict p from public.invoice_payments where id=new.id for update;
 if p.receipt_number is not null then return null; end if;
 if p.receipt_document is null or p.result is null then raise exception 'Pago no confirmado: recibo pendiente'; end if;
 yr:=extract(year from p.received_at at time zone 'America/Lima');
 insert into public.finance_receipt_counters(year,last_value) values(yr,1)
 on conflict(year) do update set last_value=finance_receipt_counters.last_value+1 returning last_value into seq;
 num:='RCI-'||yr||'-'||lpad(seq::text,8,'0');
 update public.invoice_payments set receipt_number=num,receipt_document=receipt_document||jsonb_build_object('number',num) where id=p.id;
 perform public.log_admin_audit('invoice_payments','receipt_issued',p.id::text,null,jsonb_build_object('number',num),'Numeración de constancia al confirmar el pago');
 return null;
end $$;
create constraint trigger finance_number_receipt after insert on public.invoice_payments deferrable initially deferred for each row execute function public.finance_number_receipt();

create function public.finance_protect_receipt() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if old.receipt_number is not null and (new.receipt_number,new.receipt_document,new.receipt_snapshot) is distinct from (old.receipt_number,old.receipt_document,old.receipt_snapshot) then
  raise exception 'El recibo emitido es inmutable; un reverso conserva su original';
 end if;
 return new;
end $$;
create trigger finance_protect_receipt before update of receipt_number,receipt_document,receipt_snapshot on public.invoice_payments for each row execute function public.finance_protect_receipt();
revoke all on function public.finance_build_receipt(),public.finance_number_receipt(),public.finance_protect_receipt() from public,anon,authenticated,service_role;

create function public.finance_receipt(p_payment_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); p public.invoice_payments%rowtype;
begin
 select * into p from public.invoice_payments where id=p_payment_id;
 if not found then raise exception 'Pago no encontrado'; end if;
 if p.receipt_number is null then raise exception 'Pago anterior sin constancia numerada. No se reconstruye ni numera al leer.'; end if;
 return jsonb_build_object('document',p.receipt_document||jsonb_build_object('metadata',p.receipt_snapshot-'periods'),'reversal',case when p.reversed_at is null then null else jsonb_build_object('at',p.reversed_at,'by',p.reversed_by,'reason',p.reversal_reason) end);
end $$;
revoke all on function public.finance_receipt(uuid) from public,anon,service_role;
grant execute on function public.finance_receipt(uuid) to authenticated;

-- El índice de recepción ya existe. Este parcial atiende únicamente el flujo
-- de reversos por su fecha efectiva; no se crea un índice por celda o lectura.
create index invoice_payments_reversed_daily on public.invoice_payments(reversed_at,created_by) where reversed_at is not null;
create function public.finance_daily_collections(p_from date,p_to date,p_zone uuid default null,p_collector uuid default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); start_at timestamptz; end_at timestamptz; answer jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>30 or p_page is null or p_page not between 1 and 100000 then raise exception 'Seleccione un rango de hasta 31 días y página válida'; end if;
 start_at:=p_from::timestamp at time zone 'America/Lima';end_at:=(p_to+1)::timestamp at time zone 'America/Lima';
 with events as materialized(
  select p.id,p.receipt_number,p.received_at occurred,p.amount,'received'::text kind,p.created_by collector_id,p.created_by actor_id,p.method,p.reference,p.zone_id,
   p.receipt_snapshot->>'collector' collector,p.receipt_snapshot->'client'->>'name' customer,p.receipt_snapshot->>'contract' contract,p.receipt_snapshot->>'zone' zone,
   coalesce((p.result->>'credit')::numeric,0) advance,p.reversed_at
  from public.invoice_payments p where p.received_at>=start_at and p.received_at<end_at and (p_zone is null or p.zone_id=p_zone) and (p_collector is null or p.created_by=p_collector)
  union all
  select p.id,p.receipt_number,p.reversed_at,-p.amount,'reversed',p.created_by,p.reversed_by,p.method,p.reference,p.zone_id,
   p.receipt_snapshot->>'collector',p.receipt_snapshot->'client'->>'name',p.receipt_snapshot->>'contract',p.receipt_snapshot->>'zone',0,p.reversed_at
  from public.invoice_payments p where p.reversed_at>=start_at and p.reversed_at<end_at and (p_zone is null or p.zone_id=p_zone) and (p_collector is null or p.created_by=p_collector)
 )
 select jsonb_build_object('total',(select count(*) from events),'page',p_page,'pageSize',50,
  'totals',jsonb_build_object('received',coalesce((select sum(amount) from events where kind='received'),0),'reversed',-coalesce((select sum(amount) from events where kind='reversed'),0),'net',coalesce((select sum(amount) from events),0),
   'advancesReceived',coalesce((select sum(advance) from events where kind='received'),0),'payments',(select count(*) from events where kind='received'),'reversals',(select count(*) from events where kind='reversed')),
  'methods',(select jsonb_agg(jsonb_build_object('method',m,'received',coalesce((select sum(amount) from events where method=m and kind='received'),0),'reversed',-coalesce((select sum(amount) from events where method=m and kind='reversed'),0),'net',coalesce((select sum(amount) from events where method=m),0))) from unnest(array['cash','yape','plin','transfer','other'])m),
  'administrators',coalesce((select jsonb_agg(x) from(select collector_id,collector,sum(case when kind='received' then amount else 0 end) received,-sum(case when kind='reversed' then amount else 0 end) reversed,sum(amount) net from events group by collector_id,collector order by collector)x),'[]'::jsonb),
  'collectors',coalesce((select jsonb_agg(x) from(select pr.id,coalesce(pr.full_name,pr.id::text) name from public.profiles pr where exists(select 1 from public.invoice_payments p where p.created_by=pr.id) order by name)x),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(x) from(select id,receipt_number,occurred,amount::text,kind,collector_id,actor_id,method,reference,zone_id,collector,customer,contract,zone,advance::text,reversed_at from events order by occurred desc,id,kind limit 50 offset(p_page-1)*50)x),'[]'::jsonb)) into answer;
 return answer;
end $$;
revoke all on function public.finance_daily_collections(date,date,uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.finance_daily_collections(date,date,uuid,uuid,integer) to authenticated;
commit;
