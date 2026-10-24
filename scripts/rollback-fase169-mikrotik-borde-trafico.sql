-- Revierte 20261024130000_fase169_mikrotik_borde_trafico.sql.
--
-- Orden obligatorio: esta fase se revierte ANTES de (o sin necesidad de)
-- revertir Fase 168 -- Fase 168 (device_role) puede quedar aplicada sola
-- sin que nada de Fase 169 dependa de ella para funcionar en reversa.
-- Si en algun momento tambien se revierte Fase 168, hacerlo DESPUES de
-- correr este script (mikrotikBorderTrafficService.ts referencia
-- device_role; si Fase 168 se revierte primero con Fase 169 todavia
-- aplicada, esas consultas empiezan a fallar con "column does not exist").
--
-- Solo lectura antes de borrar: avisa cuanto historico/alertas reales se
-- va a perder (nunca bloquea el rollback, es informativo).
do $$
declare
  v_samples bigint;
  v_alerts bigint;
begin
  select count(*) into v_samples from public.mikrotik_interface_samples;
  select count(*) into v_alerts from public.mikrotik_saturation_alerts;
  raise notice 'Fase 169 rollback: se van a borrar % muestras de trafico y % alertas de saturacion (historico real, si el monitoreo ya corrio en produccion)', v_samples, v_alerts;
end $$;

begin;

drop function if exists public.fn_mikrotik_interface_series(uuid, text, timestamptz, int);

drop table if exists public.mikrotik_saturation_alerts;
drop table if exists public.mikrotik_interface_counters_state;
drop table if exists public.mikrotik_interface_samples;

alter table public.mikrotik_devices
  drop constraint if exists mikrotik_devices_capacity_positive_check;

alter table public.mikrotik_devices
  drop column if exists monitored_interface_name,
  drop column if exists uplink_interface_name,
  drop column if exists capacity_download_mbps,
  drop column if exists capacity_upload_mbps;

commit;
