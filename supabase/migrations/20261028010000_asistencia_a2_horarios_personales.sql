-- A2.1 LOCAL: horarios parciales RECURRENTES por trabajador (ej. dos
-- tecnicos que todos los sabados trabajan media jornada, uno por la manana
-- y otro por la tarde). Distinto del permiso EXCEPCIONAL "media_jornada" de
-- la migracion anterior: esto es un patron SEMANAL habitual, configurado
-- una sola vez, no un permiso puntual de un dia. Solo SUPERADMIN configura;
-- ADMIN/TECNICO_RED solo consultan su propio horario (mismo patron de RLS
-- que asistencia_novedades). No inventa horas: hora_ingreso/hora_salida
-- son siempre las que SUPERADMIN configura, nunca un valor fijo asumido.
--
-- Reutiliza integramente current_user_role(), el trigger/tabla de auditoria
-- de configuracion ya aplicados (asistencia_config_auditar/
-- asistencia_config_eventos) y el mismo patron de tabla+RLS+trigger-guard
-- que feriados (Fase 117/A0) — escritura directa SUPERADMIN, sin RPC nueva.
--
-- Alcance: domingo queda FUERA (dia_semana 1..6, lunes a sabado) — convertir
-- domingo/feriado en laborable para alguien es "A3: Intercambio de
-- descanso" (ver docs/ASISTENCIA-SEMIAUTOMATICA-FASE-A-PROPUESTA.md), no
-- iniciada. "Falta" sigue exigiendo una marcacion real ese dia (sin cambios
-- en cuentaFalta/Vue): un horario personal NUNCA exime la obligacion de
-- marcar, solo corrige CONTRA QUE HORA se mide la tardanza. La mitad del
-- dia que la persona no trabaja nunca se evalua ni se marca como falta,
-- porque "falta" siempre fue por dia completo sin ninguna marcacion, nunca
-- por segmento.
begin;

create table public.asistencia_horarios_personales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  dia_semana int not null check (dia_semana between 1 and 6),
  turno text not null check (turno in ('manana','tarde')),
  hora_ingreso time not null,
  hora_salida time not null,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hora_salida > hora_ingreso),
  unique (user_id, dia_semana)
);

alter table public.asistencia_horarios_personales enable row level security;
create policy asistencia_horarios_personales_lectura on public.asistencia_horarios_personales for select to authenticated
using (public.current_user_role() = 'SUPERADMIN' or user_id = auth.uid());
create policy asistencia_horarios_personales_escritura_superadmin on public.asistencia_horarios_personales for all to authenticated
using (public.current_user_role() = 'SUPERADMIN') with check (public.current_user_role() = 'SUPERADMIN');
revoke all on public.asistencia_horarios_personales from anon, authenticated;
grant select, insert, update, delete on public.asistencia_horarios_personales to authenticated;

-- Misma validacion de objetivo que asistencia_novedad_crear (colaborador
-- activo, ADMIN/TECNICO_RED, nunca SUPERADMIN) — aqui como trigger porque
-- esta tabla se escribe directo (sin RPC), igual que feriados.
create function public.asistencia_horario_personal_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text;
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN configura horarios personales' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then return old; end if;
  select role into v_rol from public.profiles where id = new.user_id and active;
  if v_rol is null then raise exception 'Colaborador inexistente o inactivo'; end if;
  if v_rol = 'SUPERADMIN' then raise exception 'SUPERADMIN está exento de asistencia; no aplica' using errcode = '42501'; end if;
  if v_rol not in ('ADMIN','TECNICO_RED') then raise exception 'Rol sin obligación de asistencia'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger asistencia_horarios_personales_guard before insert or update or delete on public.asistencia_horarios_personales
for each row execute function public.asistencia_horario_personal_guard();

-- Reutiliza integramente el trigger/tabla de auditoria de configuracion ya
-- aplicados — misma lectura exclusiva SUPERADMIN, sin tabla nueva.
create trigger asistencia_horarios_personales_auditar after insert or update or delete on public.asistencia_horarios_personales
for each row execute function public.asistencia_config_auditar();

revoke all on function public.asistencia_horario_personal_guard() from public, anon, authenticated;

-- ---- mark_attendance_ingreso: tardanza contra el horario REAL de la persona ----
-- Precedencia (de mas a menos especifico): permiso EXCEPCIONAL de hoy
-- (media_jornada fija el inicio real de esa mitad; permiso_horas conserva
-- el horario base pero nunca cuenta tardanza dentro de su ventana) >
-- horario HABITUAL recurrente de ese dia de la semana > horario general de
-- company_settings (lunes/resto). Nunca se inventa una hora: si no hay fila
-- en ninguna de las dos tablas, el comportamiento es EXACTAMENTE el de
-- Fase 117 (lunes_hora_ingreso/resto_hora_ingreso). El resto de la funcion
-- (domingo/feriado bloqueados, una sola marca por dia, geocerca) no cambia.
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
