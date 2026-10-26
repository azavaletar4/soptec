-- Rollback de supabase/migrations/20261027010000_asistencia_a0_a1.sql
--
-- Diseñado para usarse DESPUES de activar A0/A1 en producción, cuando ya
-- pueden existir marcaciones reales nuevas (ADMIN/TECNICO_RED) y
-- solicitudes de ausencia reales (pendientes/aprobadas/rechazadas) escritas
-- por las RPC nuevas. Por eso este rollback NUNCA hace DROP TABLE de
-- asistencia_solicitudes / asistencia_solicitud_eventos / asistencia_config_eventos
-- — esos datos se conservan intactos para revisión administrativa, igual
-- que pide el documento de propuesta ("no DROP de evidencias ni
-- restauración destructiva de tablas"). Lo que SÍ revierte es el
-- COMPORTAMIENTO: deja feriados/company_settings otra vez editables por
-- ADMIN (no solo SUPERADMIN) y desactiva las RPC/triggers nuevos.
--
-- No se restaura el EXECUTE de anon/authenticated sobre los 4
-- mark_attendance_* que la migración original revocó de anon — esa
-- revocación cierra un hueco real que ya estaba documentado (Fase 117
-- nunca validaba rol en el cuerpo de esas RPC) y no se vuelve a abrir
-- aunque se revierta el resto.
--
-- Probado (2026-10-26) en Postgres aislado: aplicar la migración, simular
-- marcaciones/solicitudes nuevas "mientras el sistema estaba activo",
-- aplicar este rollback, y confirmar que esos datos siguen intactos y que
-- ADMIN vuelve a poder editar company_settings/feriados.
begin;

-- 1) Restaura el acceso de ADMIN a configuración/feriados.
drop policy if exists company_settings_update_superadmin on public.company_settings;
create policy company_settings_update_admin on public.company_settings for update to authenticated
using (public.current_user_role() in ('ADMIN','SUPERADMIN')) with check (public.current_user_role() in ('ADMIN','SUPERADMIN'));

drop policy if exists feriados_insert_superadmin on public.feriados;
drop policy if exists feriados_update_superadmin on public.feriados;
drop policy if exists feriados_delete_superadmin on public.feriados;
create policy feriados_write_admin on public.feriados for all to authenticated
using (public.current_user_role() in ('ADMIN','SUPERADMIN')) with check (public.current_user_role() in ('ADMIN','SUPERADMIN'));

-- 2) Quita los triggers nuevos (deja de auditar/bloquear) — asistencia_registros
--    vuelve a escribirse exactamente como antes de A0/A1.
drop trigger if exists asistencia_historial_guard on public.asistencia_registros;
drop trigger if exists asistencia_feriado_guard on public.feriados;
drop trigger if exists asistencia_settings_auditar on public.company_settings;
drop trigger if exists asistencia_feriados_auditar on public.feriados;
drop function if exists public.asistencia_guardar_historial();
drop function if exists public.asistencia_feriado_guard();
drop function if exists public.asistencia_config_auditar();

-- 3) Desactiva las RPC nuevas (revoca ejecución; NO se eliminan las
--    funciones ni las tablas — las solicitudes/eventos ya creados quedan
--    disponibles para consulta/auditoría SUPERADMIN tal cual quedaron).
revoke execute on function public.reportar_ausencia_hoy(uuid,date,text,text) from authenticated;
revoke execute on function public.resolver_ausencia(uuid,integer,text,text) from authenticated;
revoke execute on function public.asistencia_ausencias_resumen(date,date,date,uuid) from authenticated;

commit;
