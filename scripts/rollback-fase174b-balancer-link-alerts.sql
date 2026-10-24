-- Revierte 20261024150000_fase174_balancer_link_alerts.sql.
--
-- No depende de nada de Fase 174 base (descubrimiento de conexiones WAN,
-- 20261024140000) ni de Fase 172 (saturacion del borde dedicado) -- es
-- independiente, solo agrega una tabla nueva. Se puede revertir sola sin
-- afectar el descubrimiento de conexiones ni los graficos/historial ya
-- desplegados.
--
-- Solo lectura antes de borrar: avisa cuantas alertas reales se van a
-- perder (nunca bloquea el rollback, es informativo).
do $$
declare
  v_alerts bigint;
begin
  select count(*) into v_alerts from public.mikrotik_balancer_link_alerts;
  raise notice 'Fase 174b rollback: se van a borrar % alertas de enlaces WAN del balanceador (historico real, si el monitoreo ya corrio en produccion)', v_alerts;
end $$;

begin;

drop table if exists public.mikrotik_balancer_link_alerts;

commit;
