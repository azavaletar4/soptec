-- Diagnóstico acotado; no invoca RPCs ni modifica datos.
begin transaction read only;
select jsonb_build_object(
  'readOnly', current_setting('transaction_read_only'),
  'checkedAt', now(),
  'columns', (select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'nullable',is_nullable) order by table_name,ordinal_position)
    from information_schema.columns where table_schema='public' and table_name in ('service_contracts','installations','work_order_closures')),
  'rpc', (select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'securityDefiner',p.prosecdef,'definition',pg_get_functiondef(p.oid)))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='contract_cancel_unfulfilled'),
  'completionTrigger', (select jsonb_agg(jsonb_build_object('trigger',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid)))
    from pg_trigger t where t.tgrelid='public.installations'::regclass and not t.tgisinternal and t.tgname='trg_installations_completed_at'),
  'contracts', (select jsonb_agg(jsonb_build_object('id',s.id,'clientId',s.client_id,'number',s.contract_number,'status',s.status,'clientStatus',c.status,
    'hasPppoe',nullif(s.pppoe_username,'') is not null,'hasXui',s.xui_line_id is not null))
    from public.service_contracts s join public.clients c on c.id=s.client_id
    where s.client_id in (select client_id from public.service_contracts where contract_number='CTR-2026-00400')),
  'installations', (select jsonb_agg(jsonb_build_object('id',i.id,'clientId',i.client_id,'contractId',i.contract_id,'status',i.status,
    'completedAt',to_jsonb(i)->'completed_at','updatedAt',i.updated_at))
    from public.installations i where i.client_id in (select client_id from public.service_contracts where contract_number='CTR-2026-00400')
      or i.contract_id in (select id from public.service_contracts where contract_number='CTR-2026-00400')),
  'closures', (select jsonb_agg(jsonb_build_object('jobType',w.job_type,'jobId',w.job_id,'createdAt',w.created_at))
    from public.work_order_closures w where w.client_id in (select client_id from public.service_contracts where contract_number='CTR-2026-00400')),
  'completedSample', (select jsonb_build_object('installationId',i.id,'contractId',i.contract_id,'sameClient',i.client_id=s.client_id,'status',i.status,'completedAt',i.completed_at)
    from public.installations i join public.service_contracts s on s.id=i.contract_id
    where i.status='completed' order by i.updated_at desc limit 1),
  'onts', (select jsonb_agg(jsonb_build_object('id',o.id,'clientId',o.client_id,'contractId',o.contract_id,'status',o.status))
    from public.olt_onts o where o.client_id in (select client_id from public.service_contracts where contract_number='CTR-2026-00400')),
  'invoiceCount', (select count(*) from public.invoices where contract_id in (select id from public.service_contracts where contract_number='CTR-2026-00400'))
);
rollback;
