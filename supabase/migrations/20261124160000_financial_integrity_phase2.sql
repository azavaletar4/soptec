-- Fase 2. Preparada localmente; NO aplicar sin revisión/autorización productiva.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$ begin
if md5(pg_get_functiondef('public.apply_invoice_credits()'::regprocedure))<>'bd4ed06572e6ce639097e2a631dcb73a' then raise exception 'Drift en apply_invoice_credits'; end if;
if md5(pg_get_functiondef('public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric)'::regprocedure))<>'c1c02a8de1aefa7c35279dfe1c298749' then raise exception 'Drift en crear_descuento_compensacion_masivo'; end if;
if md5(pg_get_functiondef('public.increment_client_saldo(uuid,numeric)'::regprocedure))<>'6df2939866a19b4e54855a9baaea181e' then raise exception 'Drift en increment_client_saldo'; end if;
if md5(pg_get_functiondef('public.log_admin_audit(text,text,text,jsonb,jsonb,text)'::regprocedure))<>'c8a6ba8928dbd5adf4b55014db0c11f3' then raise exception 'Drift en log_admin_audit'; end if;
end $guard$;

alter table public.invoices add column finance_reconciled boolean not null default false;
alter table public.service_contracts add column finance_reconciled_at timestamptz;
alter table public.service_contracts add column finance_start_date date;

-- No existe un libro de pagos/aplicaciones en el esquema auditado. La factura
-- conserva su agregado compatible; estas dos tablas registran dinero, no cargos.
create table public.invoice_payments (
 id uuid primary key,
 contract_id uuid not null references public.service_contracts(id),
 client_id uuid not null references public.clients(id),
 amount numeric(14,2) not null check(amount>0),
 method text not null check(method in ('cash','yape','plin','transfer','other')),
 reference text,
 reason text not null check(length(btrim(reason)) between 5 and 500),
 created_by uuid not null references public.profiles(id),
 received_at timestamptz not null default now(),
 request_payload jsonb not null,
 result jsonb
);
create unique index invoice_payments_operation_unique on public.invoice_payments(method,lower(btrim(reference))) where nullif(btrim(reference),'') is not null;
create index invoice_payments_received on public.invoice_payments(received_at,created_by);
create index invoice_payments_contract on public.invoice_payments(contract_id,received_at desc);
create table public.invoice_payment_allocations (
 payment_id uuid not null references public.invoice_payments(id),
 invoice_id uuid not null references public.invoices(id),
 amount numeric(14,2) not null check(amount>0),
 primary key(payment_id,invoice_id)
);
create index invoice_payment_allocations_invoice on public.invoice_payment_allocations(invoice_id);
alter table public.invoice_payments enable row level security;
alter table public.invoice_payment_allocations enable row level security;
create policy invoice_payments_read on public.invoice_payments for select to authenticated using(public.current_user_role()::text in ('SUPERADMIN','ADMIN','FACTURACION'));
create policy invoice_payment_allocations_read on public.invoice_payment_allocations for select to authenticated using(public.current_user_role()::text in ('SUPERADMIN','ADMIN','FACTURACION'));
revoke all on public.invoice_payments,public.invoice_payment_allocations from public,anon,authenticated;
grant select on public.invoice_payments,public.invoice_payment_allocations to authenticated;

alter table public.invoice_adjustments add column operation_id uuid;
alter table public.invoice_adjustments add column created_by uuid references public.profiles(id) default auth.uid();
alter table public.descuentos_compensacion add column operation_id uuid;
create unique index descuentos_compensacion_operation on public.descuentos_compensacion(operation_id) where operation_id is not null;
create unique index invoice_adjustments_operation on public.invoice_adjustments(operation_id) where operation_id is not null;
alter table public.invoice_adjustments drop constraint invoice_adjustments_tipo_check;
alter table public.invoice_adjustments add constraint invoice_adjustments_tipo_check check(tipo in ('averia','referido','saldo_a_favor','promo_4to_gratis','exoneracion'));

-- Funciones internas: no RPC pública para inventar dinero o eventos.
revoke all on function public.increment_client_saldo(uuid,numeric) from public,anon,authenticated,service_role;
revoke all on function public.log_admin_audit(text,text,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.generate_invoice_number() from public,anon,authenticated,service_role;
alter function public.set_invoice_number() security definer;
alter function public.set_invoice_number() set search_path=pg_catalog,public;
revoke insert,update,delete on public.client_credit_movements,public.invoice_adjustments,public.descuentos_compensacion,public.descuentos_compensacion_lotes,public.pagos_adelantados from authenticated,anon;
revoke insert,update,delete on public.debt_hold_events,public.admin_audit_log from authenticated,anon;

-- Guardas INVOKER: llamadas internas heredan el dueño de una RPC DEFINER;
-- UPDATE directo como authenticated/service_role no puede falsificar agregados.
create function public.finance_guard_fields() returns trigger language plpgsql set search_path=pg_catalog,public as $$
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
   new.amount_due:=case when new.status::text='cancelled' then 0 else greatest(new.amount-coalesce(new.amount_paid,0)-coalesce((select sum(monto) from public.invoice_adjustments where invoice_id=new.id),0),0) end;
  end if;
  if new.amount<0 or new.period_end<new.period_start or not exists(select 1 from public.service_contracts where id=new.contract_id and client_id=new.client_id) then raise exception 'Importe, período o identidad de contrato inválidos'; end if;
 end if;
 return new;
end $$;

create function public.finance_record_payment(p_request_id uuid,p_contract_id uuid,p_invoice_ids uuid[],p_amount numeric,p_method text,p_reference text,p_reason text)
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
  due:=greatest(inv.amount-coalesce(inv.amount_paid,0)-coalesce((select sum(monto) from public.invoice_adjustments where invoice_id=inv.id),0),0);
  if due<>inv.amount_due then raise exception 'Saldo inconsistente; revisar conciliación'; end if;
  applied:=least(remaining,due);
  if applied>0 then
   insert into public.invoice_payment_allocations values(p_request_id,inv.id,applied);
   update public.invoices set amount_paid=coalesce(amount_paid,0)+applied,amount_due=due-applied,
    status=case when due=applied then 'paid'::public.invoice_status else 'pending'::public.invoice_status end,
    paid_at=case when due=applied then now() else paid_at end,payment_method=p_method where id=inv.id;
   perform public.log_admin_audit('invoices','payment_allocation',inv.id::text,to_jsonb(inv),(select to_jsonb(i) from public.invoices i where i.id=inv.id),p_reason);
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
revoke all on function public.finance_record_payment(uuid,uuid,uuid[],numeric,text,text,text) from public,anon,service_role;
grant execute on function public.finance_record_payment(uuid,uuid,uuid[],numeric,text,text,text) to authenticated;

create function public.finance_apply_adjustment(p_operation_id uuid,p_invoice_id uuid,p_amount numeric,p_kind text,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare inv public.invoices%rowtype; existing public.invoice_adjustments%rowtype; actor uuid:=auth.uid(); client uuid;
begin
 if not exists(select 1 from public.profiles where id=actor and active and role::text in ('ADMIN','SUPERADMIN')) then raise exception 'Requiere ADMIN/SUPERADMIN activo' using errcode='42501'; end if;
 if p_operation_id is null or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_kind is null or p_kind not in ('averia','exoneracion') or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Ajuste o motivo inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into existing from public.invoice_adjustments where operation_id=p_operation_id;
 if found then
  if existing.invoice_id<>p_invoice_id or existing.monto<>p_amount or existing.tipo<>p_kind or existing.descripcion<>p_reason or existing.created_by<>actor then raise exception 'Clave reutilizada con otro ajuste'; end if;
  return jsonb_build_object('adjustmentId',existing.id);
 end if;
 select client_id into client from public.invoices where id=p_invoice_id;
 perform 1 from public.clients where id=client for update;
 select * into inv from public.invoices where id=p_invoice_id for update;
 if not found or not inv.finance_reconciled or inv.status::text<>'pending' or p_amount>inv.amount_due or (p_kind='exoneracion' and p_amount<>inv.amount_due) then raise exception 'Factura no conciliada o importe no aplicable'; end if;
 insert into public.invoice_adjustments(invoice_id,tipo,descripcion,monto,operation_id,created_by) values(inv.id,p_kind,p_reason,p_amount,p_operation_id,actor);
 update public.invoices set amount_due=amount_due-p_amount,status=case when amount_due=p_amount then 'exonerada'::public.invoice_status else status end where id=inv.id;
 perform public.log_admin_audit('invoices',p_kind,inv.id::text,to_jsonb(inv),(select to_jsonb(i) from public.invoices i where i.id=inv.id),p_reason);
 return jsonb_build_object('adjustmentId',(select id from public.invoice_adjustments where operation_id=p_operation_id));
end $$;
revoke all on function public.finance_apply_adjustment(uuid,uuid,numeric,text,text) from public,anon,service_role;
grant execute on function public.finance_apply_adjustment(uuid,uuid,numeric,text,text) to authenticated;

create trigger finance_guard_invoice before insert or update on public.invoices for each row execute function public.finance_guard_fields();
create trigger finance_guard_credit before insert or update of saldo_a_favor on public.clients for each row execute function public.finance_guard_fields();
create trigger finance_guard_reconciliation before insert or update of finance_reconciled_at,finance_start_date on public.service_contracts for each row execute function public.finance_guard_fields();

create function public.finance_audit_invoice() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Dentro de pagos/ajustes se registra el motivo preciso; el DML general
 -- conserva además el snapshot (no es permiso para alterar historial).
 perform public.log_admin_audit('invoices',lower(tg_op),new.id::text,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),coalesce(new.notes,'Edición/alta de factura'));
 return new;
end $$;
create trigger finance_audit_invoice after insert or update on public.invoices for each row execute function public.finance_audit_invoice();

-- El esquema anterior crea cuatro paid por un anticipo; se impide esa vía.
create or replace function public.apply_pago_adelantado() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin raise exception 'Utilice el registro de pagos adelantados conciliados; promoción 3+1 pendiente de habilitación'; end $$;

CREATE OR REPLACE FUNCTION public.crear_descuento_compensacion_masivo(p_criterio text, p_criterio_id uuid, p_motivo text, p_monto numeric DEFAULT NULL::numeric, p_porcentaje numeric DEFAULT NULL::numeric)
 RETURNS TABLE(lote_id uuid, clientes_afectados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote_id uuid;
  v_client_id uuid;
  v_contract_id uuid;
  v_ont_count int;
  v_monthly numeric(10, 2);
  v_monto_cliente numeric(10, 2);
  v_count int := 0;
begin
  if coalesce(public.current_user_role()::text,'') not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo ADMIN/SUPERADMIN pueden aplicar descuentos por averia masiva';
  end if;
  if p_criterio is null or p_criterio_id is null or nullif(btrim(p_motivo),'') is null or p_criterio not in ('zona', 'olt', 'nap') then
    raise exception 'Criterio invalido: %', p_criterio;
  end if;
  if (p_monto is null) = (p_porcentaje is null) then
    raise exception 'Indica exactamente uno: monto fijo o porcentaje';
  end if;

  if (p_monto is not null and (p_monto<=0 or p_monto>99999999.99 or p_monto<>round(p_monto,2))) or (p_porcentaje is not null and (p_porcentaje<=0 or p_porcentaje>100)) then raise exception 'Importe/porcentaje inválido'; end if;
  insert into public.descuentos_compensacion_lotes (criterio, criterio_id, motivo, monto, porcentaje)
  values (p_criterio, p_criterio_id, p_motivo, p_monto, p_porcentaje)
  returning id into v_lote_id;

  for v_client_id in
    select distinct c.id
      from public.clients c
     where (p_criterio = 'zona' and c.zone_id = p_criterio_id)
        or (p_criterio = 'olt' and exists (
              select 1 from public.olt_onts o where o.retired_at is null and o.client_id = c.id and o.olt_device_id = p_criterio_id
            ))
        or (p_criterio = 'nap' and exists (
              select 1 from public.fo_nap_puertos n where n.client_id = c.id and n.infra_elemento_id = p_criterio_id
            ))
  loop
    v_contract_id := null;

    if p_criterio = 'olt' then
      -- Solo se resuelve el contrato si hay exactamente UN ont de este
      -- cliente en esta OLT (y ese ont ya tiene contract_id, Fase 37).
      select count(*) into v_ont_count
        from public.olt_onts o
       where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;

      if v_ont_count = 1 then
        select o.contract_id into v_contract_id
          from public.olt_onts o
         where o.retired_at is null and o.client_id = v_client_id and o.olt_device_id = p_criterio_id;
      end if;
    end if;

    if p_porcentaje is not null then
      if v_contract_id is not null then
        select monthly_fee into v_monthly from public.service_contracts where id = v_contract_id;
      end if;
      if v_monthly is null then
        select monthly_fee into v_monthly
          from public.service_contracts
         where client_id = v_client_id and status = 'active'
         order by created_at desc
         limit 1;
      end if;
      if v_monthly is null then
        continue; -- sin contrato activo, no hay mensualidad de la que sacar el %
      end if;
      v_monto_cliente := round(v_monthly * p_porcentaje / 100, 2);
    else
      v_monto_cliente := p_monto;
    end if;

    if v_monto_cliente > 0 then
      insert into public.descuentos_compensacion (client_id, contract_id, monto, motivo, lote_id)
      values (v_client_id, v_contract_id, v_monto_cliente, p_motivo, v_lote_id);
      v_count := v_count + 1;
    end if;

    v_monthly := null;
  end loop;

  update public.descuentos_compensacion_lotes set clientes_afectados = v_count where id = v_lote_id;

  perform public.log_admin_audit('descuentos_compensacion_lotes','create',v_lote_id::text,null,jsonb_build_object('clientes_afectados',v_count),p_motivo);
  return query select v_lote_id, v_count;
end;
$function$
;
revoke all on function public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric) from public,anon,service_role;
grant execute on function public.crear_descuento_compensacion_masivo(text,uuid,text,numeric,numeric) to authenticated;
create unique index invoices_contract_period_live on public.invoices(contract_id,period_start,period_end) where status<>'cancelled';
create function public.finance_dashboard(p_from date,p_to date,p_zone uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare answer jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN','FACTURACION')) then raise exception 'Rol financiero requerido' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1096 then raise exception 'Rango inválido (máximo tres años)'; end if;
 with cohort as(select i.* from public.invoices i join public.service_contracts c on c.id=i.contract_id where i.created_at>=p_from::timestamp at time zone 'America/Lima' and i.created_at<(p_to+1)::timestamp at time zone 'America/Lima' and (p_zone is null or c.zone_id=p_zone)),
 cash as(select p.* from public.invoice_payments p join public.service_contracts c on c.id=p.contract_id where p.received_at>=p_from::timestamp at time zone 'America/Lima' and p.received_at<(p_to+1)::timestamp at time zone 'America/Lima' and (p_zone is null or c.zone_id=p_zone))
 select jsonb_build_object(
 'billed',coalesce((select sum(amount) from cohort where status::text<>'cancelled'),0),
 'received',coalesce((select sum(amount) from cash),0),
 'pending',coalesce((select sum(amount_due) from cohort where status::text='pending'),0),
 'overdue',coalesce((select sum(amount_due) from cohort where status::text='pending' and due_date<=p_to and due_date<(now() at time zone 'America/Lima')::date),0),
 'legacyReported',coalesce((select sum(i.amount_paid) from public.invoices i join public.service_contracts c on c.id=i.contract_id where i.paid_at>=p_from::timestamp at time zone 'America/Lima' and i.paid_at<(p_to+1)::timestamp at time zone 'America/Lima' and (p_zone is null or c.zone_id=p_zone) and not exists(select 1 from public.invoice_payment_allocations a where a.invoice_id=i.id)),0),
 'discounts',coalesce((select sum(a.monto) from public.invoice_adjustments a join cohort i on i.id=a.invoice_id where a.tipo<>'saldo_a_favor'),0),
 'historicalRecovery',coalesce((select sum(a.amount) from public.invoice_payment_allocations a join cash p on p.id=a.payment_id join public.invoices i on i.id=a.invoice_id where i.created_at<p_from::timestamp at time zone 'America/Lima'),0),
 'unreconciled',(select count(*) from cohort where not finance_reconciled),
 'methods',coalesce((select jsonb_agg(x) from(select method,sum(amount) amount from cash group by method)x),'[]'::jsonb),
 'administrators',coalesce((select jsonb_agg(x) from(select created_by,sum(amount) amount from cash group by created_by)x),'[]'::jsonb),
 'aging',jsonb_build_array(
  coalesce((select sum(amount_due) from cohort where status::text='pending' and ((now() at time zone 'America/Lima')::date)-due_date between 1 and 30),0),
  coalesce((select sum(amount_due) from cohort where status::text='pending' and ((now() at time zone 'America/Lima')::date)-due_date between 31 and 60),0),
  coalesce((select sum(amount_due) from cohort where status::text='pending' and ((now() at time zone 'America/Lima')::date)-due_date between 61 and 90),0),
  coalesce((select sum(amount_due) from cohort where status::text='pending' and ((now() at time zone 'America/Lima')::date)-due_date>90),0))) into answer;
 return answer;
end $$;
revoke all on function public.finance_dashboard(date,date,uuid) from public,anon,service_role;
grant execute on function public.finance_dashboard(date,date,uuid) to authenticated;

create function public.finance_history(p_contract_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN','FACTURACION')) then raise exception 'Rol financiero requerido' using errcode='42501'; end if;
 return jsonb_build_object(
 'payments',coalesce((select jsonb_agg(x) from(select id,amount,method,reference,reason,created_by,received_at,result from public.invoice_payments where contract_id=p_contract_id order by received_at desc limit 100)x),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(x) from(select a.* from public.invoice_adjustments a join public.invoices i on i.id=a.invoice_id where i.contract_id=p_contract_id order by a.created_at desc limit 100)x),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(x) from(select l.* from public.admin_audit_log l where l.tabla='invoices' and l.entidad_id in(select id::text from public.invoices where contract_id=p_contract_id) order by l.created_at desc limit 100)x),'[]'::jsonb));
end $$;
revoke all on function public.finance_history(uuid) from public,anon,service_role;
grant execute on function public.finance_history(uuid) to authenticated;

create function public.finance_list(p_from date,p_to date,p_page integer default 1,p_search text default '',p_status text default '',p_zone uuid default null,p_contract uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN','FACTURACION')) then raise exception 'Rol financiero requerido' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>1096 or p_page not between 1 and 100000 or length(coalesce(p_search,''))>100 then raise exception 'Filtros inválidos'; end if;
 return (with matches as materialized(
 select i.*,jsonb_build_object('id',cl.id,'first_name',cl.first_name,'last_name',cl.last_name,'document_number',cl.document_number) clients,
 jsonb_build_object('id',c.id,'contract_number',c.contract_number,'zone_id',c.zone_id,'service_type',c.service_type,'zones',case when z.id is null then null else jsonb_build_object('id',z.id,'name',z.name) end,'plans',case when pl.id is null then null else jsonb_build_object('id',pl.id,'name',pl.name) end) service_contracts
 from public.invoices i join public.service_contracts c on c.id=i.contract_id join public.clients cl on cl.id=i.client_id left join public.zones z on z.id=c.zone_id left join public.plans pl on pl.id=c.plan_id
 where i.created_at>=p_from::timestamp at time zone 'America/Lima' and i.created_at<(p_to+1)::timestamp at time zone 'America/Lima'
 and (coalesce(p_status,'')='' or i.status::text=p_status) and (p_zone is null or c.zone_id=p_zone) and (p_contract is null or i.contract_id=p_contract)
 and (coalesce(p_search,'')='' or position(lower(p_search) in lower(coalesce(i.invoice_number,'')||' '||coalesce(cl.first_name,'')||' '||coalesce(cl.last_name,'')||' '||coalesce(c.contract_number,'')))>0))
 select jsonb_build_object('total',(select count(*) from matches),'rows',coalesce((select jsonb_agg(x) from(select * from matches order by created_at desc,id limit 25 offset (p_page-1)*25)x),'[]'::jsonb)));
end $$;
revoke all on function public.finance_list(date,date,integer,text,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.finance_list(date,date,integer,text,text,uuid,uuid) to authenticated;

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

  -- 3) Saldo a favor previo del cliente, sobre lo que quede de la factura.
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

  update public.invoices
     set amount_due = greatest(v_remaining, 0),
         status = case when v_remaining <= 0 then 'paid' else status end,
         paid_at = case when v_remaining <= 0 then now() else paid_at end,
         payment_method = case when v_remaining <= 0 then 'credito' else payment_method end
   where id = new.id;

  return new;
end;
$function$
;
create function public.finance_schedule_compensation(p_operation_id uuid,p_client_id uuid,p_contract_id uuid,p_amount numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid:=p_contract_id; existing public.descuentos_compensacion%rowtype; created public.descuentos_compensacion%rowtype; actor uuid:=auth.uid();
begin
 if not exists(select 1 from public.profiles where id=actor and active and role::text in ('ADMIN','SUPERADMIN')) then raise exception 'Requiere ADMIN/SUPERADMIN activo' using errcode='42501'; end if;
 if p_operation_id is null or p_amount is null or p_amount<=0 or p_amount>99999999.99 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Importe o motivo inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 if target is null then
  if (select count(*) from public.service_contracts where client_id=p_client_id and status::text in ('active','suspended'))<>1 then raise exception 'Cliente con varios servicios: seleccione el contrato exacto'; end if;
  select id into target from public.service_contracts where client_id=p_client_id and status::text in ('active','suspended');
 end if;
 select * into existing from public.descuentos_compensacion where operation_id=p_operation_id;
 if found then
  if (existing.client_id,existing.contract_id,existing.monto,existing.motivo,existing.created_by) is distinct from(p_client_id,target,p_amount,p_reason,actor) then raise exception 'Clave utilizada con otra compensación'; end if;
  return to_jsonb(existing);
 end if;
 perform 1 from public.service_contracts where id=target and client_id=p_client_id and finance_reconciled_at is not null and finance_start_date<=(now() at time zone 'America/Lima')::date and status::text in ('active','suspended') for share;
 if not found then raise exception 'El contrato requiere conciliación inicial aprobada'; end if;
 insert into public.descuentos_compensacion(client_id,contract_id,monto,motivo,operation_id,created_by) values(p_client_id,target,p_amount,p_reason,p_operation_id,actor) returning * into created;
 perform public.log_admin_audit('descuentos_compensacion','create',created.id::text,null,to_jsonb(created),p_reason);
 return to_jsonb(created);
end $$;
revoke all on function public.finance_schedule_compensation(uuid,uuid,uuid,numeric,text) from public,anon,service_role;
grant execute on function public.finance_schedule_compensation(uuid,uuid,uuid,numeric,text) to authenticated;

create function public.finance_cancel_compensation(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.descuentos_compensacion%rowtype;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role::text in ('ADMIN','SUPERADMIN')) then raise exception 'Requiere ADMIN/SUPERADMIN activo' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Motivo requerido'; end if;
 select * into previous from public.descuentos_compensacion where id=p_id for update;
 if not found then raise exception 'Compensación no encontrada'; end if;
 if previous.estado='cancelado' then return; end if;
 if previous.estado<>'pendiente' then raise exception 'El descuento ya fue aplicado; requiere reverso financiero'; end if;
 update public.descuentos_compensacion set estado='cancelado' where id=p_id;
 perform public.log_admin_audit('descuentos_compensacion','cancel',p_id::text,to_jsonb(previous),(select to_jsonb(d) from public.descuentos_compensacion d where id=p_id),p_reason);
end $$;
revoke all on function public.finance_cancel_compensation(uuid,text) from public,anon,service_role;
grant execute on function public.finance_cancel_compensation(uuid,text) to authenticated;

commit;
