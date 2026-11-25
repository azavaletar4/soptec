-- PREPARADO LOCALMENTE. Depende de fases 2, 3 y 4. No aplicar en producción.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.invoices add column finance_origin text not null default 'operational' check(finance_origin in ('operational','opening_balance'));
create table public.finance_import_batches(
 id uuid primary key, label text not null check(length(label) between 3 and 120), started_on date not null,
 actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 reason text not null, payload jsonb not null, result jsonb not null
);
create table public.finance_import_items(
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.finance_import_batches(id),
 event_key text not null unique, source_key text not null, contract_id uuid not null references public.service_contracts(id),
 kind text not null, result jsonb not null, created_at timestamptz not null default now()
);
create index finance_import_items_batch on public.finance_import_items(batch_id);
alter table public.finance_import_batches enable row level security;
alter table public.finance_import_items enable row level security;
revoke all on public.finance_import_batches,public.finance_import_items from public,anon,authenticated,service_role;
grant select on public.finance_import_batches,public.finance_import_items to authenticated;
create policy finance_import_batches_read on public.finance_import_batches for select to authenticated using(public.current_user_role()::text in ('ADMIN','SUPERADMIN'));
create policy finance_import_items_read on public.finance_import_items for select to authenticated using(public.current_user_role()::text in ('ADMIN','SUPERADMIN'));

create function public.finance_import_lab_enabled() returns boolean language sql stable set search_path=pg_catalog as $$
 select current_database()='finance_reconciliation_lab' and coalesce(current_setting('smartrayco.finance_import_mode',true),'')='local-synthetic'
$$;
revoke all on function public.finance_import_lab_enabled() from public,anon,authenticated,service_role;
create function public.finance_import_context() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true);
begin return jsonb_build_object('canApply',public.finance_import_lab_enabled(),'mode','local-synthetic-only',
 'collectors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',coalesce(full_name,id::text))) from public.profiles where role::text in ('ADMIN','SUPERADMIN','FACTURACION')),'[]'::jsonb));end $$;
revoke all on function public.finance_import_context() from public,anon,service_role;
grant execute on function public.finance_import_context() to authenticated;

create function public.finance_import_validate_rows(p_rows jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
declare r jsonb;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>262144 then raise exception 'Seleccione entre 1 y 100 registros sanitizados (máximo 256 KB)';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if exists(select 1 from jsonb_object_keys(r) k where k not in ('key','sheet','row','column','zoneId','contractCode','subscriber','customer','contractId','kind','period','amount','receivedOn','method','reference','collectorId','reason','reviewed','invoiceId','invoiceIds','periodStart','periodEnd','dueOn','asOf','fee','expectedDue','paymentId','sourceAmount')) then raise exception 'Campos ajenos a la proyección financiera rechazados';end if;
  if nullif(r->>'sourceAmount','') is not null and r->>'sourceAmount' !~ '^\d{1,8}(\.\d{1,2})?$' then raise exception 'Importe fuente no verificable';end if;
  if length(coalesce(r->>'key','')) not between 1 and 200 or length(coalesce(r->>'sheet',''))>100 or length(coalesce(r->>'reason',''))>500 or length(coalesce(r->>'customer',''))>200 or length(coalesce(r->>'reference',''))>100 then raise exception 'Metadatos financieros fuera de límite';end if;
  if coalesce(r->>'kind','') not in ('payment','advance','discount','exemption','promotion','opening_debt','opening_credit','link') then raise exception 'Tipo de operación inválido';end if;
  if coalesce(r->>'reason','') ~* '(pppoe|password|contrase|secret|token|clave|wifi)' then raise exception 'No se admite información técnica en motivos';end if;
 end loop;
 if (select count(distinct value->>'key') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'Coordenadas repetidas en la vista previa';end if;
end $$;
revoke all on function public.finance_import_validate_rows(jsonb) from public,anon,authenticated,service_role;

create function public.finance_import_event_key(r jsonb) returns text language sql immutable set search_path=pg_catalog as $$
 select md5(jsonb_build_object('contract',r->>'contractId','kind',case when r->>'kind' in ('payment','advance','promotion','link') then 'cash_source' else r->>'kind' end,
  'amount',nullif(r->>'amount','')::numeric,'date',case when r->>'kind' like 'opening_%' then r->>'asOf' else r->>'receivedOn' end,
  'method',r->>'method','reference',lower(btrim(coalesce(r->>'reference',''))),
  'period',case when r->>'kind' in ('payment','advance','promotion','link') then null else r->>'period' end)::text)
$$;
revoke all on function public.finance_import_event_key(jsonb) from public,anon,authenticated,service_role;

create function public.finance_import_preview(p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); answer jsonb;
begin
 perform public.finance_import_validate_rows(p_rows);
 with input as materialized(select value r,value->>'key' key from jsonb_array_elements(p_rows)),
 matches as materialized(
  select x.key,c.id,c.client_id,c.contract_number,c.client_code,c.monthly_fee,c.status,c.zone_id,c.service_type,cl.first_name||' '||cl.last_name customer,
   row_number() over(partition by x.key order by c.contract_number,c.id) rank
  from input x join public.service_contracts c on c.zone_id=nullif(x.r->>'zoneId','')::uuid
  join public.clients cl on cl.id=c.client_id
  where (case when nullif(x.r->>'contractId','') is not null then c.id=(x.r->>'contractId')::uuid else
    (nullif(x.r->>'contractCode','') is not null and c.contract_number=x.r->>'contractCode') or
    (nullif(x.r->>'subscriber','') is not null and c.client_code=x.r->>'subscriber') or
    (coalesce(x.r->>'contractCode','')='' and coalesce(x.r->>'subscriber','')='' and length(coalesce(x.r->>'customer',''))>=3 and position(lower(x.r->>'customer') in lower(cl.first_name||' '||cl.last_name))>0) end)
 ), targets as materialized(select * from matches where rank<=5),
 inv as materialized(
  select x.key,i.id,i.invoice_number,i.amount,i.amount_paid,i.amount_due,i.period_start,i.period_end,i.due_date,i.finance_reconciled,i.finance_origin,i.status
  from input x join targets t on t.key=x.key join public.invoices i on i.contract_id=t.id and i.status<>'cancelled'
  where (nullif(x.r->>'invoiceId','') is not null and i.id=(x.r->>'invoiceId')::uuid)
   or (coalesce(x.r->>'period','') ~ '^\d{4}-(0[1-9]|1[012])$' and i.period_start>=((x.r->>'period')||'-01')::date and i.period_start<((x.r->>'period')||'-01')::date+interval '1 month')
   or i.id in(select value::uuid from jsonb_array_elements_text(coalesce(x.r->'invoiceIds','[]'::jsonb)))
   or (x.r->>'kind'='promotion' and i.status::text='pending' and i.period_start>=(now() at time zone 'America/Lima')::date and i.period_start<(now() at time zone 'America/Lima')::date+interval '18 months')
 ), money as materialized(
  select x.key,p.id,p.amount,p.method,p.reference,p.received_at,p.reversed_at,p.receipt_number
  from input x join targets t on t.key=x.key join public.invoice_payments p on p.contract_id=t.id
  where coalesce(x.r->>'amount','') ~ '^\d{1,8}(\.\d{1,2})?$' and p.amount=(x.r->>'amount')::numeric
   and coalesce(x.r->>'receivedOn','') ~ '^\d{4}-\d{2}-\d{2}$' and p.received_at>=(x.r->>'receivedOn')::date::timestamp at time zone 'America/Lima'
   and p.received_at<((x.r->>'receivedOn')::date+1)::timestamp at time zone 'America/Lima'
 )
 select jsonb_build_object('canApply',public.finance_import_lab_enabled(),'rows',coalesce((select jsonb_agg(jsonb_build_object('key',x.key,
  'candidates',coalesce((select jsonb_agg(to_jsonb(t)-'key'-'rank') from targets t where t.key=x.key),'[]'::jsonb),
  'candidateCount',(select count(*) from matches m where m.key=x.key),
  'invoices',coalesce((select jsonb_agg(to_jsonb(i)-'key') from inv i where i.key=x.key),'[]'::jsonb),
  'possiblePayments',coalesce((select jsonb_agg(to_jsonb(p)-'key') from money p where p.key=x.key),'[]'::jsonb)) order by x.key) from input x),'[]'::jsonb)) into answer;
 return answer;
end $$;
revoke all on function public.finance_import_preview(jsonb) from public,anon,service_role;
grant execute on function public.finance_import_preview(jsonb) to authenticated;

-- Solo se invoca dentro del importador, antes de numerar la constancia al COMMIT.
-- Fecha civil conocida; la hora normalizada NO se presenta como hora de cobro.
create function public.finance_import_source(p_payment uuid,p_on date,p_collector uuid,p_batch uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare name text; p public.invoice_payments%rowtype; early boolean; partial boolean; kind text;
begin
 select full_name into name from public.profiles where id=p_collector and role::text in ('ADMIN','SUPERADMIN','FACTURACION');
 if not found then raise exception 'Debe identificar al responsable original; no se inventa el cobrador';end if;
 select * into strict p from public.invoice_payments where id=p_payment for update;
 if p.receipt_number is not null then raise exception 'El recibo ya emitido no puede refecharse';end if;
 select coalesce(bool_or((v->>'start')::date>p_on),false),coalesce(bool_or((v->>'balanceAfter')::numeric>0),false) into early,partial from jsonb_array_elements(p.receipt_document->'periods')v;
 kind:=case when partial then 'parcial' when early or (p.result->>'credit')::numeric>0 then 'adelantado' else 'completo' end;
 update public.invoice_payments set received_at=p_on::timestamp at time zone 'America/Lima',created_by=p_collector,
  request_payload=request_payload||jsonb_build_object('importBatch',p_batch,'registeredBy',auth.uid(),'sourceDatePrecision','date'),
  receipt_snapshot=receipt_snapshot||jsonb_build_object('collector',coalesce(name,p_collector::text)),
  receipt_document=receipt_document||jsonb_build_object('receivedAt',p_on::timestamp at time zone 'America/Lima','receivedDateOnly',true,'collectorId',p_collector,'kind',kind,'inAdvance',early)
 where id=p_payment;
 update public.invoice_payment_allocations set applied_at=p_on::timestamp at time zone 'America/Lima' where payment_id=p_payment and credit_applied=0;
end $$;
revoke all on function public.finance_import_source(uuid,date,uuid,uuid) from public,anon,authenticated,service_role;

create function public.finance_import_commit(p_batch_id uuid,p_label text,p_started_on date,p_rows jsonb,p_reason text,p_expected_totals jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); prior public.finance_import_batches%rowtype; payload jsonb; r jsonb; c public.service_contracts%rowtype; inv public.invoices%rowtype;
 key text; operation uuid; outcome jsonb; result jsonb:='[]'; item public.finance_import_items%rowtype; v_amount numeric(14,2); on_date date; balance numeric(14,2); invoice_id uuid;
 totals jsonb; ids uuid[]; found_payment uuid; effective jsonb:='{"cash":"0","debt":"0","credit":"0","discount":"0","linked":"0"}'; category text;
begin
 if not public.finance_import_lab_enabled() then raise exception 'Importación bloqueada: solo laboratorio sintético autorizado; producción no habilitada' using errcode='42501';end if;
 if coalesce(p_reason,'') ~* '(pppoe|password|contrase|secret|token|clave|wifi)' or coalesce(p_label,'') ~* '(pppoe|password|contrase|secret|token|clave|wifi)' then raise exception 'No se admite información técnica en etiquetas o motivos';end if;
 perform public.finance_import_validate_rows(p_rows);
 if jsonb_array_length(p_rows)>50 or p_batch_id is null or length(btrim(coalesce(p_label,''))) not between 3 and 120 or length(btrim(coalesce(p_reason,''))) not between 10 and 500 or p_started_on is null or p_started_on>(now() at time zone 'America/Lima')::date then raise exception 'Lote, motivo o fecha de inicio inválidos (máximo 50 operaciones)';end if;
 payload:=jsonb_build_object('rows',p_rows,'label',p_label,'start',p_started_on,'reason',p_reason,'totals',p_expected_totals);
 perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,5));
 select * into prior from public.finance_import_batches where id=p_batch_id;
 if found then if prior.actor_id<>actor or prior.payload<>payload then raise exception 'Clave de lote usada con otra revisión';end if;return prior.result;end if;
 -- Una transacción de hasta 50: orden estable para cliente/contrato/factura.
 perform 1 from public.clients where id in(select sc.client_id from public.service_contracts sc join jsonb_array_elements(p_rows)x on sc.id=nullif(x->>'contractId','')::uuid) order by id for update;
 perform 1 from public.service_contracts where id in(select nullif(x->>'contractId','')::uuid from jsonb_array_elements(p_rows)x) order by id for update;
 perform 1 from public.invoices where id in(select nullif(x->>'invoiceId','')::uuid from jsonb_array_elements(p_rows)x union select j.value::uuid from jsonb_array_elements(p_rows)x cross join lateral jsonb_array_elements_text(coalesce(x->'invoiceIds','[]'::jsonb)) j(value)) order by id for update;
 select jsonb_build_object('cash',coalesce(sum(case when x->>'kind' in ('payment','advance','promotion') then (x->>'amount')::numeric else 0 end),0)::text,
 'debt',coalesce(sum(case when x->>'kind'='opening_debt' then (x->>'amount')::numeric else 0 end),0)::text,
 'credit',coalesce(sum(case when x->>'kind'='opening_credit' then (x->>'amount')::numeric else 0 end),0)::text,
 'discount',coalesce(sum(case when x->>'kind' in ('discount','exemption') then (x->>'amount')::numeric else 0 end),0)::text,
 'linked',coalesce(sum(case when x->>'kind'='link' then (x->>'amount')::numeric else 0 end),0)::text) into totals from jsonb_array_elements(p_rows)x;
 if exists(select 1 from jsonb_each_text(totals)t where t.value::numeric is distinct from (p_expected_totals->>t.key)::numeric) then raise exception 'Los totales revisados no coinciden';end if;
 if (select count(distinct public.finance_import_event_key(x)) from jsonb_array_elements(p_rows)x)<>jsonb_array_length(p_rows) then raise exception 'Eventos duplicados dentro del lote: resolver antes de importar';end if;
 insert into public.finance_import_batches values(p_batch_id,p_label,p_started_on,actor,now(),p_reason,payload,'{}');
 for r in select value from jsonb_array_elements(p_rows) order by value->>'contractId',value->>'period',value->>'key' loop
  if coalesce((r->>'reviewed')::boolean,false) is not true or length(btrim(coalesce(r->>'reason',''))) not between 10 and 500 or coalesce(r->>'amount','') !~ '^\d{1,8}(\.\d{1,2})?$' then raise exception 'Cada registro requiere importe explícito y revisión con motivo';end if;
  v_amount:=(r->>'amount')::numeric;if v_amount<=0 then raise exception 'No se importan ceros, celdas vacías ni importes negativos';end if;
  select * into c from public.service_contracts where id=nullif(r->>'contractId','')::uuid and zone_id=nullif(r->>'zoneId','')::uuid and status::text in ('active','suspended');
  if not found then raise exception 'Contrato/PON no verificados o servicio no elegible';end if;
  if (nullif(r->>'contractCode','') is not null and r->>'contractCode' is distinct from c.contract_number) or (nullif(r->>'subscriber','') is not null and r->>'subscriber' is distinct from c.client_code) then raise exception 'Los identificadores fuente no corresponden al contrato seleccionado';end if;
  if r->>'kind'='link' and exists(select 1 from public.invoice_payments where id=nullif(r->>'paymentId','')::uuid and reversed_at is not null) then raise exception 'No se vincula un pago revertido como vigente';end if;
  key:=public.finance_import_event_key(r);perform pg_advisory_xact_lock(hashtextextended(key,6));
  select * into item from public.finance_import_items where event_key=key;
  if found then result:=result||jsonb_build_array(jsonb_build_object('key',r->>'key','state','already_imported','result',item.result));continue;end if;
  if c.finance_reconciled_at is null then
   update public.service_contracts set finance_reconciled_at=now(),finance_start_date=p_started_on where id=c.id;
   perform public.log_admin_audit('service_contracts','financial_reconciliation',c.id::text,jsonb_build_object('reconciled',false),jsonb_build_object('start',p_started_on,'batch',p_batch_id),r->>'reason');
  elsif c.finance_start_date is distinct from p_started_on then raise exception 'La fecha financiera ya aprobada no puede reescribirse';end if;
  operation:=gen_random_uuid();outcome:='{}';invoice_id:=nullif(r->>'invoiceId','')::uuid;
  if r->>'kind' in ('payment','discount','exemption') then
   select * into inv from public.invoices where id=invoice_id and contract_id=c.id and client_id=c.client_id and status::text='pending';
   if not found or inv.amount_due is distinct from nullif(r->>'expectedDue','')::numeric then raise exception 'Factura o saldo cambió desde la vista previa';end if;
   if not inv.finance_reconciled and exists(select 1 from public.invoices where contract_id=c.id and finance_origin='opening_balance') then raise exception 'Existe apertura conciliada: el histórico no puede volver a incorporarse como deuda';end if;
   if inv.finance_origin='operational' and nullif(r->>'fee','') is not null and (r->>'fee')::numeric<>inv.amount then raise exception 'La mensualidad fuente no coincide con el cargo: requiere resolución explícita';end if;
   if not inv.finance_reconciled then update public.invoices set finance_reconciled=true where id=inv.id;perform public.log_admin_audit('invoices','invoice_reconciliation',inv.id::text,jsonb_build_object('reconciled',false),jsonb_build_object('batch',p_batch_id,'reconciled',true),r->>'reason');end if;
  end if;
  if r->>'kind' in ('payment','advance','promotion','link') then
   on_date:=nullif(r->>'receivedOn','')::date;
   if on_date is null or on_date>(now() at time zone 'America/Lima')::date or coalesce(r->>'method','') not in ('cash','yape','plin','transfer','other') or nullif(r->>'collectorId','') is null then raise exception 'Fecha real, método y cobrador original requeridos';end if;
   select p.id into found_payment from public.invoice_payments p where p.contract_id=c.id and p.amount=v_amount and p.received_at>=on_date::timestamp at time zone 'America/Lima' and p.received_at<(on_date+1)::timestamp at time zone 'America/Lima'
    and (r->>'kind'<>'link' or (p.id=nullif(r->>'paymentId','')::uuid and p.method=r->>'method' and (nullif(r->>'reference','') is null or lower(btrim(p.reference))=lower(btrim(r->>'reference'))))) order by p.id limit 1;
   if r->>'kind'='link' then
    if found_payment is null or not exists(select 1 from public.invoice_payments where id=found_payment and reversed_at is null) then raise exception 'Vínculo de pago existente no verificado o revertido';end if;
    outcome:=jsonb_build_object('paymentId',found_payment,'linked',true);
   else
    if found_payment is not null then raise exception 'Posible pago duplicado: revisar/vincular el movimiento existente';end if;
    if r->>'kind'='promotion' then
     select array_agg(value::uuid) into ids from jsonb_array_elements_text(coalesce(r->'invoiceIds','[]'::jsonb));
     if cardinality(ids)<>4 or v_amount is distinct from (select sum(i.amount) from(select amount from public.invoices where id=any(ids) and contract_id=c.id order by period_start limit 3)i) then raise exception 'Promoción requiere cuatro facturas verificadas e importe recibido exacto';end if;
     if (select count(*) from public.invoices where id=any(ids) and contract_id=c.id and client_id=c.client_id and status::text='pending' and amount_due=amount and coalesce(amount_paid,0)=0)<>4 then raise exception 'Facturas de promoción ambiguas o con movimientos';end if;
     for inv in select * from public.invoices where id=any(ids) and not finance_reconciled loop
      update public.invoices set finance_reconciled=true where id=inv.id;
      perform public.log_admin_audit('invoices','invoice_reconciliation',inv.id::text,jsonb_build_object('reconciled',false),jsonb_build_object('batch',p_batch_id,'reconciled',true),r->>'reason');
     end loop;
     -- La regla futura/consecutiva vigente se conserva; no se inventa una promo histórica.
     outcome:=public.finance_promo_3_1(operation,c.id,ids,r->>'method',nullif(r->>'reference',''),r->>'reason');
    else
     outcome:=public.finance_record_payment(operation,c.id,case when r->>'kind'='advance' then '{}'::uuid[] else array[invoice_id] end,v_amount,r->>'method',nullif(r->>'reference',''),r->>'reason');
    end if;
    perform public.finance_import_source(operation,on_date,(r->>'collectorId')::uuid,p_batch_id);
   end if;
  elsif r->>'kind' in ('discount','exemption') then
   outcome:=public.finance_apply_adjustment(operation,invoice_id,v_amount,case when r->>'kind'='exemption' then 'exoneracion' else 'averia' end,r->>'reason');
  elsif r->>'kind'='opening_debt' then
   if nullif(r->>'periodStart','') is null or nullif(r->>'periodEnd','') is null or nullif(r->>'dueOn','') is null or nullif(r->>'asOf','') is null or (r->>'asOf')::date<>p_started_on or (r->>'periodEnd')::date<(r->>'periodStart')::date then raise exception 'Saldo inicial requiere corte, período y vencimiento verificables';end if;
   if exists(select 1 from public.invoices where contract_id=c.id and finance_origin='opening_balance') then raise exception 'Ya existe apertura: no se reinicia ni duplica la deuda';end if;
   if exists(select 1 from public.invoices where contract_id=c.id and finance_reconciled and status::text='pending' and amount_due>0 and period_start<=p_started_on) then raise exception 'Deuda ya conciliada: resolver antes de crear una apertura';end if;
   insert into public.invoices(contract_id,client_id,amount,amount_due,period_start,period_end,due_date,finance_reconciled,finance_origin,notes,created_by)
    values(c.id,c.client_id,v_amount,v_amount,p_started_on,p_started_on,(r->>'dueOn')::date,true,'opening_balance',r->>'reason',actor) returning id into invoice_id;
   outcome:=jsonb_build_object('invoiceId',invoice_id,'openingDebt',v_amount);
   perform public.log_admin_audit('invoices','opening_balance',invoice_id::text,null,outcome,r->>'reason');
  elsif r->>'kind'='opening_credit' then
   if nullif(r->>'asOf','') is null or (r->>'asOf')::date<>p_started_on then raise exception 'Saldo a favor inicial requiere fecha de corte verificada';end if;
   if exists(select 1 from public.finance_import_items where contract_id=c.id and kind='opening_credit') then raise exception 'Ya existe saldo a favor inicial: corregir auditadamente, no duplicar';end if;
   update public.clients set saldo_a_favor=saldo_a_favor+v_amount where id=c.client_id returning saldo_a_favor into balance;
   insert into public.client_credit_movements(client_id,tipo,monto,saldo_resultante,created_by) values(c.client_id,'ajuste_manual',v_amount,balance,actor) returning id into invoice_id;
   outcome:=jsonb_build_object('creditMovementId',invoice_id,'openingCredit',v_amount,'cashReceived',0);
   perform public.log_admin_audit('clients','opening_credit',c.client_id::text,jsonb_build_object('credit',balance-v_amount),outcome,r->>'reason');
  end if;
  insert into public.finance_import_items(batch_id,event_key,source_key,contract_id,kind,result) values(p_batch_id,key,r->>'key',c.id,r->>'kind',outcome);
  category:=case when r->>'kind' in ('payment','advance','promotion') then 'cash' when r->>'kind'='opening_debt' then 'debt' when r->>'kind'='opening_credit' then 'credit' when r->>'kind'='link' then 'linked' else 'discount' end;
  effective:=jsonb_set(effective,array[category],to_jsonb(((effective->>category)::numeric+v_amount)::text));
  result:=result||jsonb_build_array(jsonb_build_object('key',r->>'key','state','applied','result',outcome));
 end loop;
 outcome:=jsonb_build_object('batchId',p_batch_id,'rows',result,'totals',totals,'appliedTotals',effective);
 update public.finance_import_batches set result=outcome where id=p_batch_id;
 perform public.log_admin_audit('finance_import_batches','import_committed',p_batch_id::text,null,jsonb_build_object('count',jsonb_array_length(p_rows),'totals',totals),p_reason);
 return outcome;
end $$;
revoke all on function public.finance_import_commit(uuid,text,date,jsonb,text,jsonb) from public,anon,service_role;
grant execute on function public.finance_import_commit(uuid,text,date,jsonb,text,jsonb) to authenticated;

create function public.finance_import_origin_guard() returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare owner_name name;
begin
 select pg_get_userbyid(proowner) into owner_name from pg_proc where oid='public.finance_import_commit(uuid,text,date,jsonb,text,jsonb)'::regprocedure;
 if current_user<>owner_name and ((tg_op='INSERT' and new.finance_origin<>'operational') or (tg_op='UPDATE' and new.finance_origin is distinct from old.finance_origin)) then raise exception 'El origen requiere una operación financiera autorizada' using errcode='42501';end if;return new;
end $$;
create trigger finance_import_origin_guard before insert or update of finance_origin on public.invoices for each row execute function public.finance_import_origin_guard();
-- Las adaptaciones de reportes se preparan a partir de las funciones reales.
-- GENERATED PHASE5 REPORT COMPATIBILITY
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
  if new.finance_origin='opening_balance' or new.status <> 'pending' or not new.finance_reconciled or not exists(select 1 from public.service_contracts where id=new.contract_id and finance_reconciled_at is not null and finance_start_date<=(now() at time zone 'America/Lima')::date) then
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
create or replace function public.finance_capture_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 select c.zone_id,c.service_type,
 jsonb_build_object('version',1,'client',jsonb_build_object('name',cl.first_name||' '||cl.last_name,'document',cl.document_number),
  'contract',c.contract_number,'cintillo',c.client_code,'service',c.service_type,'plan',pl.name,'monthlyFee',c.monthly_fee,
  'zone',z.name,'collector',coalesce(p.full_name,new.created_by::text),'timezone','America/Lima','currency','PEN',
  'periods',coalesce((select jsonb_agg(jsonb_build_object('origin',i.finance_origin,'id',i.id,'invoice',i.invoice_number,'start',i.period_start,'end',i.period_end,'amount',i.amount,'dueBefore',i.amount_due) order by i.period_start,i.id)
   from public.invoices i where i.id in(select value::uuid from jsonb_array_elements_text(new.request_payload->'invoices'))),'[]'::jsonb))
 into new.zone_id,new.service_type,new.receipt_snapshot
 from public.service_contracts c join public.clients cl on cl.id=c.client_id
 left join public.plans pl on pl.id=c.plan_id left join public.zones z on z.id=c.zone_id
 left join public.profiles p on p.id=new.created_by where c.id=new.contract_id;
 return new;
end $$;
create or replace function public.finance_build_receipt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare periods jsonb; balance numeric(14,2); partial boolean; early boolean;
begin
 if old.receipt_number is not null then return new; end if;
 if old.result is null and new.result is not null then
  if new.result->>'paymentId' is distinct from new.id::text or
   (new.result->>'received')::numeric is distinct from new.amount or new.receipt_snapshot is null then
   raise exception 'No se puede emitir una constancia sin pago confirmado';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('origin',s.v->>'origin','invoiceId',s.v->>'id','invoice',s.v->>'invoice',
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
create or replace function public.finance_dashboard(p_from date,p_to date,p_zone uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); first_at timestamptz; end_at timestamptz; answer jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1096 then raise exception 'Rango inválido (máximo tres años)'; end if;
 first_at:=p_from::timestamp at time zone 'America/Lima';end_at:=(p_to+1)::timestamp at time zone 'America/Lima';
 with cohort as materialized(select i.*,c.zone_id,c.service_type from public.invoices i join public.service_contracts c on c.id=i.contract_id where i.finance_reconciled and i.created_at>=first_at and i.created_at<end_at and (p_zone is null or c.zone_id=p_zone)),
 events as materialized(
  select p.id,p.contract_id,p.zone_id,p.service_type,p.method,p.created_by,p.receipt_snapshot->>'collector' collector,p.received_at occurred,p.amount amount,false reversal from public.invoice_payments p where p.received_at>=first_at and p.received_at<end_at and (p_zone is null or p.zone_id=p_zone)
  union all select p.id,p.contract_id,p.zone_id,p.service_type,p.method,p.created_by,p.receipt_snapshot->>'collector',p.reversed_at,-p.amount,true from public.invoice_payments p where p.reversed_at>=first_at and p.reversed_at<end_at and (p_zone is null or p.zone_id=p_zone)
 ), series as(
  select m.month::date as month,coalesce(b.amount,0) billed,coalesce(c.amount,0) received from generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month')m(month)
  left join(select date_trunc('month',created_at at time zone 'America/Lima') as month,sum(amount) amount from cohort where status<>'cancelled' and finance_origin='operational' group by 1)b on b.month=m.month
  left join(select date_trunc('month',occurred at time zone 'America/Lima') as month,sum(amount) amount from events group by 1)c on c.month=m.month
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
  'aging',jsonb_build_array(coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 1 and 30),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 31 and 60),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date between 61 and 90),0),coalesce((select sum(amount_due) from cohort where status='pending' and (now() at time zone 'America/Lima')::date-due_date>90),0))) into answer;
 return answer;
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
  select a.invoice_id,sum(a.monto) amount,bool_or(a.tipo='promo_4to_gratis') promotion
  from public.invoice_adjustments a join inv i on i.id=a.invoice_id where a.reversed_at is null group by a.invoice_id
 ), monthly as(
  select i.contract_id,extract(month from i.period_start)::integer as month,count(*) count,
   sum(i.amount) amount,sum(case when i.finance_origin='operational' then i.amount else 0 end) issued,bool_or(i.finance_origin='opening_balance') opening,sum(coalesce(i.amount_paid,0)) paid,sum(i.amount_due) due,
   bool_or(i.amount_due>0 and i.due_date<(now() at time zone 'America/Lima')::date) overdue,
   bool_or(not i.finance_reconciled) unreconciled,
   bool_and(i.status::text='exonerada' or coalesce(r.amount,0)>=i.amount) exempt,
   bool_or(coalesce(r.promotion,false)) promotion,
   bool_and(coalesce(pi.advance,false) and coalesce(pi.allocated,0)=coalesce(i.amount_paid,0)) advance
  from inv i left join payment_info pi on pi.invoice_id=i.id left join reductions r on r.invoice_id=i.id group by i.contract_id,extract(month from i.period_start)
 ), cells as materialized(
  select b.id,g.month,coalesce(m.issued,0) issued,coalesce(m.amount,0) amount,coalesce(m.paid,0) paid,coalesce(m.due,0) due,
   jsonb_build_object('opening',coalesce(m.opening,false),'month',g.month,'amount',coalesce(m.amount,0)::text,'paid',coalesce(m.paid,0)::text,'due',coalesce(m.due,0)::text,'invoiceCount',coalesce(m.count,0),
    'overdue',coalesce(m.overdue,false),'unreconciled',coalesce(m.unreconciled,false),'promotion',coalesce(m.promotion,false),
    'state',case when m.count is null then 'sin_facturacion' when m.due=0 and m.exempt then 'exonerado' when m.due=0 and m.paid>0 and m.advance then 'adelantado' when m.due=0 then 'pagado' when m.paid>0 then 'parcial' when m.overdue then 'vencido' else 'pendiente' end) cell
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
create or replace function public.finance_daily_collections(p_from date,p_to date,p_zone uuid default null,p_collector uuid default null,p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); start_at timestamptz; end_at timestamptz; answer jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>30 or p_page is null or p_page not between 1 and 100000 then raise exception 'Seleccione un rango de hasta 31 días y página válida'; end if;
 start_at:=p_from::timestamp at time zone 'America/Lima';end_at:=(p_to+1)::timestamp at time zone 'America/Lima';
 with events as materialized(
  select p.id,p.receipt_number,p.received_at occurred,p.amount,'received'::text kind,p.created_by collector_id,p.created_by actor_id,p.method,p.reference,p.zone_id,
   coalesce((p.receipt_document->>'receivedDateOnly')::boolean,false) date_only,p.receipt_snapshot->>'collector' collector,p.receipt_snapshot->'client'->>'name' customer,p.receipt_snapshot->>'contract' contract,p.receipt_snapshot->>'zone' zone,
   coalesce((p.result->>'credit')::numeric,0) advance,p.reversed_at
  from public.invoice_payments p where p.received_at>=start_at and p.received_at<end_at and (p_zone is null or p.zone_id=p_zone) and (p_collector is null or p.created_by=p_collector)
  union all
  select p.id,p.receipt_number,p.reversed_at,-p.amount,'reversed',p.created_by,p.reversed_by,p.method,p.reference,p.zone_id,
   false,p.receipt_snapshot->>'collector',p.receipt_snapshot->'client'->>'name',p.receipt_snapshot->>'contract',p.receipt_snapshot->>'zone',0,p.reversed_at
  from public.invoice_payments p where p.reversed_at>=start_at and p.reversed_at<end_at and (p_zone is null or p.zone_id=p_zone) and (p_collector is null or p.created_by=p_collector)
 )
 select jsonb_build_object('total',(select count(*) from events),'page',p_page,'pageSize',50,
  'totals',jsonb_build_object('received',coalesce((select sum(amount) from events where kind='received'),0),'reversed',-coalesce((select sum(amount) from events where kind='reversed'),0),'net',coalesce((select sum(amount) from events),0),
   'advancesReceived',coalesce((select sum(advance) from events where kind='received'),0),'payments',(select count(*) from events where kind='received'),'reversals',(select count(*) from events where kind='reversed')),
  'methods',(select jsonb_agg(jsonb_build_object('method',m,'received',coalesce((select sum(amount) from events where method=m and kind='received'),0),'reversed',-coalesce((select sum(amount) from events where method=m and kind='reversed'),0),'net',coalesce((select sum(amount) from events where method=m),0))) from unnest(array['cash','yape','plin','transfer','other'])m),
  'administrators',coalesce((select jsonb_agg(x) from(select collector_id,collector,sum(case when kind='received' then amount else 0 end) received,-sum(case when kind='reversed' then amount else 0 end) reversed,sum(amount) net from events group by collector_id,collector order by collector)x),'[]'::jsonb),
  'collectors',coalesce((select jsonb_agg(x) from(select pr.id,coalesce(pr.full_name,pr.id::text) name from public.profiles pr where exists(select 1 from public.invoice_payments p where p.created_by=pr.id) order by name)x),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(x) from(select id,receipt_number,occurred,amount::text,kind,collector_id,actor_id,method,reference,zone_id,date_only,collector,customer,contract,zone,advance::text,reversed_at from events order by occurred desc,id,kind limit 50 offset(p_page-1)*50)x),'[]'::jsonb)) into answer;
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
 'openingBalances',coalesce((select jsonb_agg(x) from(select i.kind,i.result,b.started_on,b.reason,b.actor_id,b.created_at from public.finance_import_items i join public.finance_import_batches b on b.id=i.batch_id where i.contract_id=p_contract_id and i.kind in ('opening_credit','opening_debt') order by b.created_at desc limit 100)x),'[]'::jsonb),'audit',coalesce((select jsonb_agg(x) from(select l.* from public.admin_audit_log l where
  (l.tabla='invoices' and l.entidad_id in(select id::text from invs)) or
  (l.tabla='invoice_payments' and (l.entidad_id in(select id::text from pay) or l.nuevo->'payload'->>'payment' in(select id::text from pay))) or
  (l.tabla='service_contracts' and l.accion='monthly_fee' and l.nuevo->'payload'->>'contract'=p_contract_id::text)
  order by l.created_at desc,l.id desc limit 100)x),'[]'::jsonb)));
end $$;
create or replace function public.finance_month_detail(p_contract uuid,p_year integer,p_month integer) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(); first_day date;
begin
 if p_year is null or p_year not between 2020 and 2100 or p_month is null or p_month not between 1 and 12 then raise exception 'Período inválido'; end if;
 first_day:=make_date(p_year,p_month,1);
 return(with invoices as materialized(select i.* from public.invoices i where i.contract_id=p_contract and i.period_start>=first_day and i.period_start<first_day+interval '1 month' and i.status<>'cancelled')
 select jsonb_build_object('contract',p_contract,'year',p_year,'month',p_month,
 'invoices',coalesce((select jsonb_agg(to_jsonb(i) order by period_start,id) from invoices i),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(x) from(select p.id,p.amount received,p.method,p.reference,p.received_at,coalesce((p.receipt_document->>'receivedDateOnly')::boolean,false) received_date_only,p.created_by,p.reversed_at,p.reversal_reason,coalesce(p.receipt_snapshot->>'collector',p.created_by::text) collector,a.invoice_id,a.amount applied,a.credit_applied
  from public.invoice_payment_allocations a join invoices i on i.id=a.invoice_id join public.invoice_payments p on p.id=a.payment_id order by p.received_at desc,p.id limit 100)x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(to_jsonb(a)) from public.invoice_adjustments a join invoices i on i.id=a.invoice_id),'[]'::jsonb)));
end $$;
commit;
