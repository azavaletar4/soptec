-- Execute only as a SELECT snapshot into a NEW protected local file before any future activation.
begin read only;
set local statement_timeout='10s';
select json_build_object('captured_at',transaction_timestamp(),'read_only',current_setting('transaction_read_only'),
 'onts',(select json_agg(o order by id) from public.olt_onts o where id in ('a1f0b671-a1e2-482c-b24e-7e584bf0e4ed','74d586e3-3a0a-40c2-aba3-46294adcf095','76701eb5-405e-462f-862d-384a469cadac') or upper(btrim(serial)) in ('MSTC8CCE647E','HWTCDEB847B6','HWTCE5C94DB6','HWTC5C94DB6')),
 'alerts',(select json_agg(a order by id) from public.olt_alert_log a where olt_ont_id in ('a1f0b671-a1e2-482c-b24e-7e584bf0e4ed','74d586e3-3a0a-40c2-aba3-46294adcf095','76701eb5-405e-462f-862d-384a469cadac')),
 'operations',(select json_agg(o order by id) from (select id,serial,ont_db_id,client_id,contract_id,status,steps,created_at,updated_at from public.olt_provisioning_operations where serial in ('MSTC8CCE647E','HWTCDEB847B6','HWTCE5C94DB6','HWTC5C94DB6'))o),
 'protected_clients',(select json_agg(c order by id) from (select id,status,updated_at from public.clients where id in ('a563d740-a060-417e-852a-5153edeefb18','3f01013e-ad20-44bb-ad15-443416e14d63'))c),
 'protected_contracts',(select json_agg(c order by id) from (select id,client_id,status,updated_at from public.service_contracts where id in ('cb2ee4ae-3301-44cc-b44c-939cca819e3b','91f25111-758a-4f5a-9b79-196065509cde'))c),
 'protected_inventory',(select json_agg(u order by id) from (select id,serial_number,status,client_id,contract_id from public.inventory_units where id='f4c174ef-9136-4ee6-83e7-4082d8a47140')u)
);
rollback;
