-- Fase 23: vincula cada contrato con su linea IPTV en el panel XUI.one
-- (172.168.1.253/RaycoAlex). Igual que mikrotik_profile (Fase 21), se elige
-- por contrato y no por cliente, porque un cliente puede tener mas de un
-- contrato con lineas IPTV distintas.
--
-- xui_line_id: id numerico de la linea en XUI (clave para consultar/editar/
-- suspender via server/src/services/xuiService.ts).
-- xui_username: cache del username de esa linea, para no tener que
-- resolverlo contra el panel solo para mostrarlo en la UI.

alter table public.service_contracts
  add column if not exists xui_line_id integer,
  add column if not exists xui_username text;
