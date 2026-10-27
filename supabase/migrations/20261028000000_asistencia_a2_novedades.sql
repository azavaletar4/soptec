-- A2 LOCAL: vacaciones por rango, descansos programados, permisos por horas
-- y medias jornadas. No modifica asistencia_registros/solicitudes existentes
-- ni sus RLS/triggers (Fase 117/135, A0/A1). Reutiliza current_user_role(),
-- el patron idempotente por UUID + bloqueo advisory de A1, y el trigger de
-- auditoria de configuracion (asistencia_config_auditar/asistencia_config_eventos)
-- ya aplicado para company_settings/feriados.
--
-- SUPERADMIN configura y aprueba en un solo paso (no hay flujo "pendiente":
-- es quien programa directamente, origen "programacion SUPERADMIN", ver
-- docs/ASISTENCIA-SEMIAUTOMATICA-FASE-A-PROPUESTA.md). ADMIN/TECNICO_RED
-- solo consultan sus propias novedades (RLS) y mantienen su marcacion/A1
-- intactas. SUPERADMIN sigue exento: no puede ser el user_id objetivo.
--
-- media_jornada lleva turno + hora_inicio/hora_fin REALES (igual forma que
-- permiso_horas) — es un permiso EXCEPCIONAL de un solo dia. La migracion
-- 20261028010000_asistencia_a2_horarios_personales.sql (siguiente) usa esas
-- horas para calcular tardanza/falta contra la mitad que si se trabaja, en
-- vez de eximir el dia completo; y agrega el horario HABITUAL recurrente
-- (semanal, por dia de la semana) como tabla aparte, para no mezclar ambos
-- conceptos (ver esa migracion para el detalle).
begin;

create table public.asistencia_novedades (
  id uuid primary key,
  user_id uuid not null references public.profiles(id),
  tipo text not null check (tipo in ('vacaciones','descanso_programado','permiso_horas','media_jornada')),
  fecha_inicio date not null,
  fecha_fin date not null,
  turno text check (turno in ('manana','tarde')),
  hora_inicio time,
  hora_fin time,
  motivo text check (length(motivo) <= 500),
  estado text not null default 'activa' check (estado in ('activa','cancelada')),
  version integer not null default 1,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_motivo text check (length(cancel_motivo) <= 500),
  check (fecha_fin >= fecha_inicio),
  -- Vacaciones/descanso: rango de dias completos, sin turno ni horas.
  check (tipo not in ('vacaciones','descanso_programado') or (turno is null and hora_inicio is null and hora_fin is null)),
  -- Media jornada: un solo dia, turno + rango horario real (igual que un
  -- permiso por horas) — así el servidor puede calcular tardanza/falta
  -- contra la mitad que SÍ se trabaja, sin eximir el día completo.
  check (tipo <> 'media_jornada' or (fecha_inicio = fecha_fin and turno is not null and turno in ('manana','tarde') and hora_inicio is not null and hora_fin is not null and hora_fin > hora_inicio)),
  -- Permiso por horas: un solo dia, rango horario valido, sin turno.
  check (tipo <> 'permiso_horas' or (fecha_inicio = fecha_fin and turno is null and hora_inicio is not null and hora_fin is not null and hora_fin > hora_inicio)),
  check ((estado = 'activa' and cancelled_at is null and cancelled_by is null) or (estado = 'cancelada' and cancelled_at is not null and cancelled_by is not null))
);
create index asistencia_novedades_usuario on public.asistencia_novedades(user_id, fecha_inicio, fecha_fin);
create index asistencia_novedades_rango on public.asistencia_novedades(fecha_inicio, fecha_fin) where estado = 'activa';

alter table public.asistencia_novedades enable row level security;
create policy asistencia_novedades_lectura on public.asistencia_novedades for select to authenticated
using (public.current_user_role() = 'SUPERADMIN' or user_id = auth.uid());
revoke all on public.asistencia_novedades from anon, authenticated;
grant select on public.asistencia_novedades to authenticated;

-- Reutiliza integramente el trigger/tabla de auditoria de configuracion ya
-- aplicados (company_settings/feriados) — misma lectura exclusiva SUPERADMIN,
-- sin tabla ni politica nueva.
create trigger asistencia_novedades_auditar after insert or update on public.asistencia_novedades
for each row execute function public.asistencia_config_auditar();

create function public.asistencia_novedad_crear(
  p_operacion_id uuid, p_user_id uuid, p_tipo text, p_fecha_inicio date, p_fecha_fin date,
  p_turno text default null, p_hora_inicio time default null, p_hora_fin time default null, p_motivo text default null
) returns public.asistencia_novedades language plpgsql security definer set search_path = public as $$
declare r public.asistencia_novedades; hoy date := (now() at time zone 'America/Lima')::date; v_rol text;
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN configura novedades' using errcode = '42501'; end if;
  if p_operacion_id is null or p_user_id is null or p_tipo is null or p_fecha_inicio is null or p_fecha_fin is null then raise exception 'Datos incompletos'; end if;
  if p_tipo not in ('vacaciones','descanso_programado','permiso_horas','media_jornada') then raise exception 'Tipo de novedad inválido'; end if;
  if p_fecha_fin < p_fecha_inicio then raise exception 'El rango de fechas es inválido'; end if;
  if p_fecha_inicio < hoy then raise exception 'No se pueden programar novedades en fechas pasadas'; end if;
  if length(p_motivo) > 500 then raise exception 'El motivo es demasiado largo'; end if;
  if p_tipo in ('vacaciones','descanso_programado') and (p_turno is not null or p_hora_inicio is not null or p_hora_fin is not null) then
    raise exception 'Vacaciones/descanso no usan turno ni horas';
  end if;
  if p_tipo = 'media_jornada' and (p_fecha_inicio <> p_fecha_fin or p_turno is null or p_turno not in ('manana','tarde') or p_hora_inicio is null or p_hora_fin is null or p_hora_fin <= p_hora_inicio) then
    raise exception 'Media jornada requiere un solo día, turno y un rango de horas válido (la mitad que sí se trabaja)';
  end if;
  if p_tipo = 'permiso_horas' and (p_fecha_inicio <> p_fecha_fin or p_turno is not null or p_hora_inicio is null or p_hora_fin is null or p_hora_fin <= p_hora_inicio) then
    raise exception 'Permiso por horas requiere un solo día y un rango de horas válido';
  end if;
  select role into v_rol from public.profiles where id = p_user_id and active;
  if v_rol is null then raise exception 'Colaborador inexistente o inactivo'; end if;
  if v_rol = 'SUPERADMIN' then raise exception 'SUPERADMIN está exento de asistencia; no aplica' using errcode = '42501'; end if;
  if v_rol not in ('ADMIN','TECNICO_RED') then raise exception 'Rol sin obligación de asistencia'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || 'novedad', 0));
  select * into r from public.asistencia_novedades where id = p_operacion_id;
  if found then
    if r.user_id <> p_user_id or r.tipo <> p_tipo or r.fecha_inicio <> p_fecha_inicio or r.fecha_fin <> p_fecha_fin
       or r.turno is distinct from p_turno or r.hora_inicio is distinct from p_hora_inicio or r.hora_fin is distinct from p_hora_fin
    then raise exception 'Operación reutilizada con datos diferentes'; end if;
    return r;
  end if;
  if exists (
    select 1 from public.asistencia_novedades n
    where n.user_id = p_user_id and n.estado = 'activa' and n.fecha_inicio <= p_fecha_fin and n.fecha_fin >= p_fecha_inicio
  ) then
    raise exception 'Ya existe una novedad activa que se superpone con ese rango de fechas';
  end if;
  insert into public.asistencia_novedades(id, user_id, tipo, fecha_inicio, fecha_fin, turno, hora_inicio, hora_fin, motivo, created_by)
  values (p_operacion_id, p_user_id, p_tipo, p_fecha_inicio, p_fecha_fin, p_turno, p_hora_inicio, p_hora_fin, nullif(btrim(p_motivo), ''), auth.uid())
  returning * into r;
  return r;
end $$;

create function public.asistencia_novedad_cancelar(p_novedad_id uuid, p_version_esperada integer, p_motivo text)
returns public.asistencia_novedades language plpgsql security definer set search_path = public as $$
declare r public.asistencia_novedades; hoy date := (now() at time zone 'America/Lima')::date;
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN cancela novedades' using errcode = '42501'; end if;
  if nullif(btrim(p_motivo), '') is null or length(p_motivo) > 500 then raise exception 'El motivo de cancelación es obligatorio'; end if;
  select * into r from public.asistencia_novedades where id = p_novedad_id;
  if not found then raise exception 'Novedad inexistente'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.user_id::text || 'novedad', 0));
  select * into r from public.asistencia_novedades where id = p_novedad_id for update;
  if r.estado <> 'activa' or r.version is distinct from p_version_esperada then raise exception 'La novedad ya cambió; actualice la lista' using errcode = '40001'; end if;
  if r.fecha_fin < hoy then raise exception 'No se puede cancelar una novedad ya concluida'; end if;
  update public.asistencia_novedades set estado = 'cancelada', version = version + 1, cancelled_at = now(), cancelled_by = auth.uid(), cancel_motivo = btrim(p_motivo)
  where id = r.id returning * into r;
  return r;
end $$;

-- Resumen multi-colaborador sin motivos privados, para que ADMIN interprete
-- el tablero sin leer la fila cruda de un tercero (RLS la limita a SUPERADMIN
-- o al propio usuario). Un dia por fila, igual que asistencia_ausencias_resumen.
create function public.asistencia_novedades_resumen(p_desde date, p_hasta date, p_cursor_fecha date default null, p_cursor_usuario uuid default null)
returns table(user_id uuid, fecha date, tipo text, turno text, hora_inicio time, hora_fin time)
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() is null or public.current_user_role() not in ('SUPERADMIN','ADMIN') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 62 or (p_cursor_fecha is null) <> (p_cursor_usuario is null) then
    raise exception 'Rango o cursor inválido';
  end if;
  return query select s.user_id, s.fecha, s.tipo, s.turno, s.hora_inicio, s.hora_fin from (
    select distinct on (d.fecha, n.user_id) n.user_id, d.fecha::date as fecha, n.tipo, n.turno, n.hora_inicio, n.hora_fin
    from public.asistencia_novedades n
    cross join lateral generate_series(greatest(n.fecha_inicio, p_desde)::timestamp, least(n.fecha_fin, p_hasta)::timestamp, interval '1 day') as d(fecha)
    where n.estado = 'activa' and n.fecha_inicio <= p_hasta and n.fecha_fin >= p_desde
    order by d.fecha, n.user_id, n.created_at desc
  ) s where p_cursor_fecha is null or (s.fecha, s.user_id) > (p_cursor_fecha, p_cursor_usuario)
  order by s.fecha, s.user_id limit 500;
end $$;

revoke all on function public.asistencia_novedad_crear(uuid,uuid,text,date,date,text,time,time,text) from public, anon;
revoke all on function public.asistencia_novedad_cancelar(uuid,integer,text) from public, anon;
revoke all on function public.asistencia_novedades_resumen(date,date,date,uuid) from public, anon;
grant execute on function public.asistencia_novedad_crear(uuid,uuid,text,date,date,text,time,time,text) to authenticated;
grant execute on function public.asistencia_novedad_cancelar(uuid,integer,text) to authenticated;
grant execute on function public.asistencia_novedades_resumen(date,date,date,uuid) to authenticated;
commit;
