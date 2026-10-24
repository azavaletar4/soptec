-- Revierte 20261024120000_fase168_mikrotik_device_role.sql.
--
-- Guarda de orden: Fase 169 depende de device_role (mikrotikBorderTrafficService.ts
-- filtra por el). Si sus columnas (monitored_interface_name, etc.) todavia
-- existen, esta fase NO se revierte sola -- hay que correr primero
-- scripts/rollback-fase169-mikrotik-borde-trafico.sql.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mikrotik_devices' and column_name = 'monitored_interface_name'
  ) then
    raise exception 'Fase 169 todavia esta aplicada (mikrotik_devices.monitored_interface_name existe) -- correr primero scripts/rollback-fase169-mikrotik-borde-trafico.sql';
  end if;
end $$;

begin;

alter table public.mikrotik_devices
  drop constraint if exists mikrotik_devices_device_role_check;

alter table public.mikrotik_devices
  drop column if exists device_role;

commit;
