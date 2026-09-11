-- SmartRayco — guarda el perfil de ancho de banda (tcont/traffic) usado al
-- registrar cada ONT, para poder mostrarlo/editarlo despues sin tener que
-- volver a consultar la OLT. Ver fix real de registerOntCommands()
-- (server/src/ssh/zteCommands.ts): el registro anterior usaba una sintaxis
-- ("tcont 1 name ...") que la OLT rechazaba silenciosamente, dejando la
-- ONU sin ancho de banda real aunque el resto de la config se aplicara.

alter table public.olt_onts add column if not exists tcont_profile text;
alter table public.olt_onts add column if not exists traffic_profile text;
