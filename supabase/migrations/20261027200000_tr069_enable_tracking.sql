-- CANDIDATA: habilitacion GUIADA de TR-069 por ONT (boton individual,
-- 2026-10-27). NO aplicar sin autorizacion expresa del propietario.
--
-- Trazabilidad minima de "quien habilito, cuando" (requisito 8) — el
-- resultado (Conectado/Error/Esperando conexion) NO se guarda aqui: se
-- deriva en vivo cruzando tr069_enabled/tr069_acs_url con tr069_devices por
-- serial (ver src/lib/tr069EnableStatus.ts), mismo criterio que Fase 5
-- (ESTADO_DESARROLLO.md 13aw) de no crear tabla/columna nueva cuando el dato
-- ya se puede calcular de lo que existe. Al desactivar TR-069
-- (DELETE /:id/onts/:ontDbId/tr069) estas dos columnas se limpian: "habilitado
-- por X el Y" deja de ser cierto una vez revertido.
alter table public.olt_onts
  add column tr069_enabled_by uuid references auth.users(id),
  add column tr069_enabled_at timestamptz;

comment on column public.olt_onts.tr069_enabled_by is
  'Usuario (ADMIN/SUPERADMIN) que ejecuto la habilitacion guiada de TR-069 mas reciente. Null si nunca se habilito por este flujo o si se revirtio.';
comment on column public.olt_onts.tr069_enabled_at is
  'Momento en que se aplico esa habilitacion. Null si nunca se habilito por este flujo o si se revirtio.';
