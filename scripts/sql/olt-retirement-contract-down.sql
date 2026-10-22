-- CANDIDATE rollback; refuses history loss. Not applicable after a position was reused.
begin;
set local lock_timeout='2s';
lock table public.olt_onts in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.olt_onts where retired_at is not null) then
  raise exception 'Keep lifecycle support: retired history exists; do not erase it to downgrade';
 end if;
end $$;
alter table public.olt_onts add constraint olt_onts_olt_device_id_frame_slot_port_ont_id_key unique(olt_device_id,frame,slot,port,ont_id);
drop index public.olt_onts_active_position_key;
drop index public.olt_onts_active_serial_key;
commit;
