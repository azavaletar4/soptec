-- Solo antes del primer descarte. No borra trazabilidad ni restaura estados.
begin;
set local lock_timeout = '3s';
lock table public.clients,public.service_contracts,public.installations in access exclusive mode;
do $$ begin
  if exists(select 1 from public.clients where prospect_discarded_at is not null
    or prospect_discarded_by is not null or prospect_discard_reason is not null) then
    raise exception 'Rollback bloqueado: existe trazabilidad. Revertir frontend y revocar RPC, conservar columnas y guardas.';
  end if;
end $$;
drop trigger trg_contracts_discarded_prospect_guard on public.service_contracts;
drop trigger trg_installations_discarded_prospect_guard on public.installations;
drop trigger trg_clients_unfulfilled_prospect_discard on public.clients;
drop function public.guard_discarded_prospect_child();
drop function public.guard_unfulfilled_prospect_discard();
drop function public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean);
alter table public.clients drop constraint clients_prospect_discard_trace_check,
  drop column prospect_discarded_at, drop column prospect_discarded_by, drop column prospect_discard_reason;
commit;
