-- Reverts the DATA registration while retaining both histories. OLT is never changed.
-- Safe compensation: keep MSTC retired; never reactivate an identity absent from the OLT.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $$ declare old_row public.olt_onts; new_row public.olt_onts;
begin
 if current_setting('smartrayco.approve_ont_reconciliation',true) is distinct from 'rollback-janet-estiven-v1' then raise exception 'Explicit rollback authorization required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('700d31b5-679e-4dda-9eeb-53bf3aaf87e0/1/2/8:3',0));
 select * into strict old_row from public.olt_onts where id='a1f0b671-a1e2-482c-b24e-7e584bf0e4ed' for update;
 select * into strict new_row from public.olt_onts where id='76701eb5-405e-462f-862d-384a469cadac' for update;
 if old_row.serial<>'MSTC8CCE647E' or old_row.retired_at is null or old_row.client_id is not null or old_row.contract_id is not null
 or old_row.olt_device_id<>'700d31b5-679e-4dda-9eeb-53bf3aaf87e0' or (old_row.frame,old_row.slot,old_row.port,old_row.ont_id)<>(1,2,8,3)
 or new_row.serial<>'HWTCE5C94DB6' or new_row.retired_at is not null or new_row.olt_device_id<>old_row.olt_device_id or (new_row.frame,new_row.slot,new_row.port,new_row.ont_id)<>(1,2,8,3) then
  raise exception 'Rollback identity/preconditions changed; abort';
 end if;
 -- Preserve replacement client/contract references as history, never unlink or delete.
 if new_row.client_id is distinct from '3f01013e-ad20-44bb-ad15-443416e14d63'::uuid
 or new_row.contract_id is distinct from '91f25111-758a-4f5a-9b79-196065509cde'::uuid then
  raise exception 'Replacement links changed; rollback requires review';
 end if;
 update public.olt_onts set retired_at=transaction_timestamp() where id=new_row.id;
 -- Both UUIDs remain as history. The real OLT/service is unchanged; the application
 -- temporarily has no active binding here until a separately reviewed forward fix.
end $$;
commit;
