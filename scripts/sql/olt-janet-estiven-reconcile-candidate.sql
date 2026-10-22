-- CANDIDATE DATA CHANGE, NOT A MIGRATION. Never run during preparation.
-- Requires fresh physical identity proof and explicit separate production authorization.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $$
declare old_row public.olt_onts; janet public.olt_onts; new_row public.olt_onts;
 client_before jsonb; contract_before jsonb; unit_before jsonb;
begin
 if current_setting('smartrayco.approve_ont_reconciliation',true) is distinct from 'janet-estiven-v1' then
  raise exception 'Explicit reconciliation authorization required';
 end if;
 if not exists(select 1 from pg_index where indexrelid=to_regclass('public.olt_onts_active_position_key') and indisunique and indisvalid)
 or exists(select 1 from pg_constraint where conrelid='public.olt_onts'::regclass and conname='olt_onts_olt_device_id_frame_slot_port_ont_id_key') then
  raise exception 'Compatible application and active-position schema must be activated first';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('700d31b5-679e-4dda-9eeb-53bf3aaf87e0/1/2/8:3',0));
 select * into strict old_row from public.olt_onts where id='a1f0b671-a1e2-482c-b24e-7e584bf0e4ed' for update;
 select * into strict janet from public.olt_onts where id='74d586e3-3a0a-40c2-aba3-46294adcf095' for update;
 if old_row.serial<>'MSTC8CCE647E' or old_row.olt_device_id<>'700d31b5-679e-4dda-9eeb-53bf3aaf87e0'
 or (old_row.frame,old_row.slot,old_row.port,old_row.ont_id)<>(1,2,8,3)
 or old_row.client_id is not null or old_row.contract_id is not null or old_row.retired_at is not null then
  raise exception 'Historical MSTC row changed; abort';
 end if;
 if janet.serial<>'HWTCDEB847B6' or janet.olt_device_id<>old_row.olt_device_id or (janet.frame,janet.slot,janet.port,janet.ont_id)<>(1,2,8,50)
 or janet.client_id is distinct from 'a563d740-a060-417e-852a-5153edeefb18'::uuid
 or janet.contract_id is distinct from 'cb2ee4ae-3301-44cc-b44c-939cca819e3b'::uuid or janet.retired_at is not null then
  raise exception 'Current Janet ONT changed; abort';
 end if;
 if exists(select 1 from public.olt_onts where upper(btrim(serial)) in ('HWTCE5C94DB6','HWTC5C94DB6') or id='76701eb5-405e-462f-862d-384a469cadac') then
  raise exception 'Replacement serial/UUID already exists; inspect, never duplicate or overwrite';
 end if;
 select to_jsonb(c) into strict client_before from public.clients c where id='3f01013e-ad20-44bb-ad15-443416e14d63' and status='active' for share;
 select to_jsonb(c) into strict contract_before from public.service_contracts c where id='91f25111-758a-4f5a-9b79-196065509cde' and client_id='3f01013e-ad20-44bb-ad15-443416e14d63' and status='active' for share;
 select to_jsonb(u) into strict unit_before from public.inventory_units u where id='f4c174ef-9136-4ee6-83e7-4082d8a47140'
 and upper(serial_number)='48575443E5C94DB6' and status='assigned'
 and client_id='3f01013e-ad20-44bb-ad15-443416e14d63' and contract_id='91f25111-758a-4f5a-9b79-196065509cde' for share;
 update public.olt_onts set retired_at=transaction_timestamp() where id=old_row.id;
 insert into public.olt_onts(id,olt_device_id,serial,frame,slot,port,ont_id,client_id,contract_id,description,onu_type,vlan,tcont_profile,traffic_profile,status,admin_state,rx_power,tx_power,last_synced_at)
 values('76701eb5-405e-462f-862d-384a469cadac',old_row.olt_device_id,'HWTCE5C94DB6',1,2,8,3,
 '3f01013e-ad20-44bb-ad15-443416e14d63','91f25111-758a-4f5a-9b79-196065509cde','Estiven Laiza Lavado','GPT-2741GNAC',200,
 'SMARTOLT-VOIPMNG-10M','SMARTOLT-VOIPMNG-10M','unknown','enable',null,null,null);
 if (select to_jsonb(o) from public.olt_onts o where id=janet.id) is distinct from to_jsonb(janet)
 or (select to_jsonb(c) from public.clients c where id='3f01013e-ad20-44bb-ad15-443416e14d63') is distinct from client_before
 or (select to_jsonb(c) from public.service_contracts c where id='91f25111-758a-4f5a-9b79-196065509cde') is distinct from contract_before
 or (select to_jsonb(u) from public.inventory_units u where id='f4c174ef-9136-4ee6-83e7-4082d8a47140') is distinct from unit_before then
  raise exception 'Protected Janet/client/contract/inventory data changed; rollback';
 end if;
end $$;
commit;
