-- Rollback conjunto de:
--   supabase/migrations/20261028000000_asistencia_a2_novedades.sql
--   supabase/migrations/20261028010000_asistencia_a2_horarios_personales.sql
--
-- Diseñado para usarse DESPUÉS de activar A2/A2.1 en producción, cuando ya
-- pueden existir novedades reales (vacaciones/descansos/permisos/medias
-- jornadas) y horarios personales reales configurados por SUPERADMIN. Por
-- eso este rollback NUNCA hace DROP TABLE de asistencia_novedades ni de
-- asistencia_horarios_personales — esos datos se conservan intactos para
-- revisión administrativa, mismo criterio que el rollback de A0/A1
-- (scripts/sql/asistencia-a0-a1-rollback.sql: "no DROP de evidencias ni
-- restauración destructiva de tablas"). Tampoco toca asistencia_solicitudes/
-- asistencia_solicitud_eventos/asistencia_config_eventos ni el trigger/
-- función de auditoría de configuración (asistencia_config_auditar) — son
-- infraestructura COMPARTIDA de A0/A1 que sigue en uso por
-- company_settings/feriados independientemente de este rollback.
--
-- Orden: primero A2.1 (depende de A2), después A2 — exactamente al revés
-- de como se aplicaron.
--
-- Probado en Postgres aislado: aplicar ambas migraciones, simular
-- novedades/horarios reales "mientras el sistema estaba activo", aplicar
-- este rollback, y confirmar que esos datos siguen intactos, que
-- mark_attendance_ingreso vuelve a calcular tardanza exactamente como en
-- Fase 117 (sin horario personal ni permiso excepcional), y que las RPC
-- nuevas quedan sin permiso de ejecución.
begin;

-- ---- 1) A2.1: horarios parciales recurrentes ----

-- mark_attendance_ingreso vuelve a su forma EXACTA de Fase 117 (capturada
-- por lectura directa de producción antes de aplicar A2.1 — no se inventa
-- ningún comportamiento intermedio).
create or replace function public.mark_attendance_ingreso(p_lat numeric, p_lng numeric)
returns public.asistencia_registros
language plpgsql
security definer set search_path = public
as $$
declare
  v_settings public.company_settings;
  v_lima_now timestamp;
  v_hoy date;
  v_dow int;
  v_es_lunes boolean;
  v_hora_limite time;
  v_limite_local timestamp;
  v_minutos_tardanza int;
  v_fuera boolean;
  v_estado public.asistencia_estado;
  v_row public.asistencia_registros;
begin
  select * into v_settings from public.company_settings where id = 1;
  v_lima_now := now() at time zone 'America/Lima';
  v_hoy := v_lima_now::date;
  v_dow := extract(dow from v_hoy); -- 0 = domingo ... 6 = sabado

  if v_dow = 0 then
    raise exception 'Hoy es domingo — no es un dia laborable.';
  end if;
  if exists (select 1 from public.feriados where fecha = v_hoy) then
    raise exception 'Hoy es feriado — no es un dia laborable.';
  end if;
  if exists (select 1 from public.asistencia_registros where user_id = auth.uid() and fecha = v_hoy and hora_ingreso is not null) then
    raise exception 'Ya marcaste tu ingreso hoy.';
  end if;

  v_es_lunes := v_dow = 1;
  v_hora_limite := case when v_es_lunes then v_settings.lunes_hora_ingreso else v_settings.resto_hora_ingreso end;
  v_limite_local := v_hoy + v_hora_limite + make_interval(mins => v_settings.tolerancia_min);
  v_minutos_tardanza := greatest(0, floor(extract(epoch from (v_lima_now - v_limite_local)) / 60))::int;
  v_fuera := public.distancia_metros(p_lat, p_lng, v_settings.oficina_lat, v_settings.oficina_lng) > v_settings.oficina_radio_m;
  v_estado := case when v_minutos_tardanza > 0 then 'Tardanza' else 'Puntual' end;

  insert into public.asistencia_registros (
    user_id, fecha, es_lunes_reunion, hora_ingreso, lat_ingreso, lng_ingreso, fuera_oficina_ingreso, minutos_tardanza, estado
  ) values (
    auth.uid(), v_hoy, v_es_lunes, now(), p_lat, p_lng, v_fuera, v_minutos_tardanza, v_estado
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Deja de auditar/validar escrituras de horarios personales (no se borra
-- la tabla ni sus filas — solo se desactiva la vía de escritura directa).
drop trigger if exists asistencia_horarios_personales_auditar on public.asistencia_horarios_personales;
drop trigger if exists asistencia_horarios_personales_guard on public.asistencia_horarios_personales;
drop function if exists public.asistencia_horario_personal_guard();
drop policy if exists asistencia_horarios_personales_escritura_superadmin on public.asistencia_horarios_personales;
revoke insert, update, delete on public.asistencia_horarios_personales from authenticated;

-- ---- 2) A2: novedades (vacaciones/descanso/permiso por horas/media jornada) ----

-- Desactiva las RPC nuevas (revoca ejecución; NO se eliminan las funciones
-- ni la tabla — las novedades ya creadas quedan disponibles para consulta/
-- auditoría SUPERADMIN tal cual quedaron, igual criterio que A0/A1).
revoke execute on function public.asistencia_novedad_crear(uuid,uuid,text,date,date,text,time,time,text) from authenticated;
revoke execute on function public.asistencia_novedad_cancelar(uuid,integer,text) from authenticated;
revoke execute on function public.asistencia_novedades_resumen(date,date,date,uuid) from authenticated;
drop trigger if exists asistencia_novedades_auditar on public.asistencia_novedades;

commit;
