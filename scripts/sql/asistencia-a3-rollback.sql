-- Revertir frontend A3 antes de este SQL. Sin borrado de datos ni auditoría.
-- Bloquea rollback si hay intercambios: retirarlos reinterpretaría el reporte histórico.
begin;
do $$ begin
 if exists(select 1 from public.asistencia_intercambios) then
  raise exception 'Rollback detenido: hay intercambios registrados; conservar A3 y evaluar recuperación específica';
 end if;
end $$;
drop trigger asistencia_a3_novedades_guard on public.asistencia_novedades;
drop trigger asistencia_a3_feriados_guard on public.feriados;
drop trigger asistencia_a3_solicitud_guard on public.asistencia_solicitudes;
drop function public.asistencia_a3_solicitud_guard();
drop function public.asistencia_a3_conflicto_novedad();
drop function public.asistencia_a3_conflicto_feriado();
revoke execute on function public.asistencia_intercambio_crear(uuid,uuid,date,date,time,time), public.asistencia_intercambio_cancelar(uuid,text), public.asistencia_intercambios_resumen(date,date,date,uuid) from authenticated;
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
  v_novedad public.asistencia_novedades;
  v_personal public.asistencia_horarios_personales;
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
  select * into v_novedad from public.asistencia_novedades
    where user_id = auth.uid() and estado = 'activa' and v_hoy between fecha_inicio and fecha_fin
      and tipo in ('media_jornada', 'permiso_horas')
    limit 1;
  select * into v_personal from public.asistencia_horarios_personales where user_id = auth.uid() and dia_semana = v_dow;

  if v_novedad.id is not null and v_novedad.tipo = 'media_jornada' then
    v_hora_limite := v_novedad.hora_inicio; -- permiso excepcional: reemplaza el horario de hoy por completo
  elsif v_personal.id is not null then
    v_hora_limite := v_personal.hora_ingreso; -- horario habitual recurrente de ese dia de la semana
  else
    v_hora_limite := case when v_es_lunes then v_settings.lunes_hora_ingreso else v_settings.resto_hora_ingreso end;
  end if;

  v_limite_local := v_hoy + v_hora_limite + make_interval(mins => v_settings.tolerancia_min);
  v_minutos_tardanza := greatest(0, floor(extract(epoch from (v_lima_now - v_limite_local)) / 60))::int;

  -- Permiso por horas: dentro de su ventana autorizada nunca es tardanza,
  -- sin tocar el horario base del resto del dia (a diferencia de media
  -- jornada, que SI reemplaza el horario de hoy).
  if v_novedad.id is not null and v_novedad.tipo = 'permiso_horas' and v_lima_now::time <= v_novedad.hora_fin then
    v_minutos_tardanza := 0;
  end if;

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
commit;
