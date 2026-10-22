-- CANDIDATE ONLY. Apply AFTER the compatible backend/frontend, before reconciling data.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin
 if current_setting('smartrayco.olt_retirement_application_ready',true) is distinct from 'v1' then
  raise exception 'Deploy/verify compatible application before releasing active positions';
 end if;
end $$;
-- Fail closed on existing duplicate normalized serials. Never repair them in this migration.
create unique index olt_onts_active_serial_key on public.olt_onts(olt_device_id,upper(btrim(serial))) where retired_at is null;
create unique index olt_onts_active_position_key on public.olt_onts(olt_device_id,frame,slot,port,ont_id) where retired_at is null;
alter table public.olt_onts drop constraint olt_onts_olt_device_id_frame_slot_port_ont_id_key;
commit;
