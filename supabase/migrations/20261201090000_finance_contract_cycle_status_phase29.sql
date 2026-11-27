-- Fase 29: resumen financiero por contrato para la ficha del cliente.
-- Expone de forma segura (finance_require_actor) lo que finance_last_covered_period/
-- finance_next_cycle_date ya calculan internamente — nunca se inventa una fecha,
-- nunca se infiere "cubierto hasta" sin este cálculo real.
create function public.finance_contract_cycle_status(p_contract_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(false); c record; covered date; next_cycle date; today date; promo jsonb;
begin
 select l.nuevo into promo from public.admin_audit_log l where l.tabla='service_contracts' and l.accion='opening_anchor' and l.entidad_id=p_contract_id::text and l.nuevo->>'promo3plus1' is not null order by l.created_at desc limit 1;
 today:=(now() at time zone 'America/Lima')::date;
 select cc.id,cc.monthly_fee,cc.status,cc.is_courtesy,cc.courtesy_reason,cc.finance_billing_modality billing_modality,
  cc.finance_billing_day billing_day,cc.finance_grace_days grace_days,cc.finance_reconciled_at,cc.finance_opening_anchor_date,
  cc.debt_hold_status
 into c from public.service_contracts cc where cc.id=p_contract_id;
 if not found then raise exception 'Contrato no encontrado'; end if;
 if c.finance_reconciled_at is null or c.billing_day is null then
  return jsonb_build_object('contractId',p_contract_id,'reconciled',false,'isCourtesy',c.is_courtesy,
   'courtesyReason',c.courtesy_reason,'monthlyFee',c.monthly_fee,'status',c.status,'debtHoldStatus',c.debt_hold_status,
   'promo3plus1',coalesce((promo->>'promo3plus1')::boolean,false),'promoCoverageThrough',promo->>'coverageThroughDate','asOf',today);
 end if;
 covered:=public.finance_last_covered_period(p_contract_id);
 next_cycle:=public.finance_next_cycle_date(covered,c.billing_day);
 return jsonb_build_object('contractId',p_contract_id,'reconciled',true,'isCourtesy',c.is_courtesy,
  'courtesyReason',c.courtesy_reason,'monthlyFee',c.monthly_fee,'status',c.status,'debtHoldStatus',c.debt_hold_status,
  'billingModality',c.billing_modality,'billingDay',c.billing_day,'graceDays',c.grace_days,
  'coveredUntil',covered,'nextCycleDate',next_cycle,
  'graceEndDate',case when c.billing_modality='adelantado' then next_cycle+coalesce(c.grace_days,7) else null end,
  'promo3plus1',coalesce((promo->>'promo3plus1')::boolean,false),'promoCoverageThrough',promo->>'coverageThroughDate',
  'asOf',today);
end $$;
revoke all on function public.finance_contract_cycle_status(uuid) from public,anon,service_role;
grant execute on function public.finance_contract_cycle_status(uuid) to authenticated;
