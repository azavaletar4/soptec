-- SmartRayco — Fase 117: Control de Asistencia, Refrigerio y Tiempos.
--
-- Marcacion de ingreso/almuerzo/salida con GPS para todo el staff interno
-- (tecnicos via App de Campo, resto via marcacion rapida del Panel Web).
-- Reglas de horario:
--   - Dias laborables: Lunes a Sabado (domingo y feriados configurables
--     quedan excluidos automaticamente).
--   - Ingreso Lunes (reunion semanal): 7:30 AM. Martes a Sabado: 8:00 AM.
--     Tolerancia configurable (default 5 min) antes de marcar 'Tardanza'.
--   - Refrigerio: 120 min exactos: el exceso se calcula solo, no bloquea.
--
-- Todos los calculos (tardanza, exceso de almuerzo, fuera de geocerca) se
-- hacen SERVER-SIDE dentro de funciones SECURITY DEFINER (mismo patron que
-- update_own_telemetry, Fase 115) — nunca se confia en lo que mande el
-- cliente para esos numeros. La fecha/hora del dia se resuelve siempre en
-- hora de Peru (America/Lima), no en la zona horaria de la base (UTC) —
-- de lo contrario un cliente marcando a las 7pm Lima quedaria registrado en
-- el dia siguiente.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'asistencia_estado') then
    create type public.asistencia_estado as enum ('Puntual', 'Tardanza', 'En Almuerzo', 'Finalizado', 'Falta');
  end if;
end
$$;

-- ---- Configuracion (fila unica) ----
create table if not exists public.company_settings (
  id                  int primary key default 1 check (id = 1),
  oficina_lat         numeric not null,
  oficina_lng         numeric not null,
  oficina_radio_m     int not null default 1550,
  tolerancia_min      int not null default 5,
  lunes_hora_ingreso  time not null default '07:30',
  resto_hora_ingreso  time not null default '08:00',
  almuerzo_min        int not null default 120,
  updated_at          timestamptz not null default now()
);

insert into public.company_settings (id, oficina_lat, oficina_lng)
values (1, -8.068415, -79.001572)
on conflict (id) do nothing;

drop trigger if exists trg_company_settings_updated_at on public.company_settings;
create trigger trg_company_settings_updated_at
  before update on public.company_settings
  for each row execute procedure public.set_updated_at();

alter table public.company_settings enable row level security;

drop policy if exists "company_settings_select_staff" on public.company_settings;
create policy "company_settings_select_staff"
  on public.company_settings for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop policy if exists "company_settings_update_admin" on public.company_settings;
create policy "company_settings_update_admin"
  on public.company_settings for update to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- ---- Feriados (dias no laborables configurables) ----
create table if not exists public.feriados (
  fecha       date primary key,
  nombre      text not null,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.feriados enable row level security;

drop policy if exists "feriados_select_staff" on public.feriados;
create policy "feriados_select_staff"
  on public.feriados for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'));

drop policy if exists "feriados_write_admin" on public.feriados;
create policy "feriados_write_admin"
  on public.feriados for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- ---- Registros de asistencia (1 fila por persona por dia) ----
create table if not exists public.asistencia_registros (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  fecha                     date not null,
  es_lunes_reunion          boolean not null default false,

  hora_ingreso              timestamptz,
  lat_ingreso               numeric,
  lng_ingreso               numeric,
  fuera_oficina_ingreso     boolean,

  inicio_almuerzo           timestamptz,
  fin_almuerzo              timestamptz,
  lat_fin_almuerzo          numeric,
  lng_fin_almuerzo          numeric,
  fuera_oficina_fin_almuerzo boolean,
  duracion_almuerzo_min     int,
  exceso_almuerzo_min       int,

  hora_salida               timestamptz,
  lat_salida                numeric,
  lng_salida                numeric,

  minutos_tardanza          int not null default 0,
  estado                    public.asistencia_estado not null default 'Puntual',

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (user_id, fecha)
);

create index if not exists idx_asistencia_fecha on public.asistencia_registros (fecha);
create index if not exists idx_asistencia_user on public.asistencia_registros (user_id, fecha desc);

drop trigger if exists trg_asistencia_registros_updated_at on public.asistencia_registros;
create trigger trg_asistencia_registros_updated_at
  before update on public.asistencia_registros
  for each row execute procedure public.set_updated_at();

alter table public.asistencia_registros enable row level security;

-- Cada quien ve su propia marcacion; SUPERADMIN/ADMIN ven la de todos (tablero
-- en vivo y reporte mensual). Nunca hay policy de insert/update/delete: todo
-- escritura pasa por las funciones SECURITY DEFINER de abajo, que corren como
-- dueñas de la tabla (bypass de RLS), igual que update_own_telemetry/
-- self_assign_ticket (Fase 98/115) — asi un tecnico no puede escribir
-- directo una fila ajena ni inventarse su propia hora de ingreso.
drop policy if exists "asistencia_registros_select_propio_o_admin" on public.asistencia_registros;
create policy "asistencia_registros_select_propio_o_admin"
  on public.asistencia_registros for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- ---- Distancia Haversine (metros) — null si falta alguna coordenada. ----
create or replace function public.distancia_metros(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql
immutable
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371000 * acos(
      least(1, greatest(-1,
        cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
        + sin(radians(lat1)) * sin(radians(lat2))
      ))
    )
  end;
$$;

-- ---- Marcar ingreso ----
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

-- ---- Iniciar almuerzo ----
create or replace function public.mark_attendance_inicio_almuerzo()
returns public.asistencia_registros
language plpgsql
security definer set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_row public.asistencia_registros;
begin
  update public.asistencia_registros
  set inicio_almuerzo = now(), estado = 'En Almuerzo'
  where user_id = auth.uid() and fecha = v_hoy and hora_ingreso is not null and inicio_almuerzo is null and hora_salida is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No se puede iniciar el almuerzo (falta marcar ingreso, ya lo iniciaste, o ya marcaste salida).';
  end if;

  return v_row;
end;
$$;

-- ---- Fin de almuerzo ----
create or replace function public.mark_attendance_fin_almuerzo(p_lat numeric, p_lng numeric)
returns public.asistencia_registros
language plpgsql
security definer set search_path = public
as $$
declare
  v_settings public.company_settings;
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_actual public.asistencia_registros;
  v_duracion int;
  v_exceso int;
  v_fuera boolean;
  v_estado public.asistencia_estado;
  v_row public.asistencia_registros;
begin
  select * into v_actual from public.asistencia_registros where user_id = auth.uid() and fecha = v_hoy;
  if v_actual.id is null or v_actual.inicio_almuerzo is null or v_actual.fin_almuerzo is not null then
    raise exception 'No se puede marcar fin de almuerzo (no lo iniciaste, o ya lo marcaste).';
  end if;

  select * into v_settings from public.company_settings where id = 1;
  v_duracion := greatest(0, round(extract(epoch from (now() - v_actual.inicio_almuerzo)) / 60))::int;
  v_exceso := greatest(0, v_duracion - v_settings.almuerzo_min);
  v_fuera := public.distancia_metros(p_lat, p_lng, v_settings.oficina_lat, v_settings.oficina_lng) > v_settings.oficina_radio_m;
  v_estado := case when v_actual.minutos_tardanza > 0 then 'Tardanza' else 'Puntual' end;

  update public.asistencia_registros
  set fin_almuerzo = now(),
      lat_fin_almuerzo = p_lat,
      lng_fin_almuerzo = p_lng,
      fuera_oficina_fin_almuerzo = v_fuera,
      duracion_almuerzo_min = v_duracion,
      exceso_almuerzo_min = v_exceso,
      estado = v_estado
  where id = v_actual.id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---- Marcar salida ----
create or replace function public.mark_attendance_salida(p_lat numeric, p_lng numeric)
returns public.asistencia_registros
language plpgsql
security definer set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_row public.asistencia_registros;
begin
  update public.asistencia_registros
  set hora_salida = now(), lat_salida = p_lat, lng_salida = p_lng, estado = 'Finalizado'
  where user_id = auth.uid() and fecha = v_hoy and hora_ingreso is not null and hora_salida is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No se puede marcar salida (falta marcar ingreso, o ya marcaste salida).';
  end if;

  return v_row;
end;
$$;

revoke all on function public.mark_attendance_ingreso(numeric, numeric) from public;
revoke all on function public.mark_attendance_inicio_almuerzo() from public;
revoke all on function public.mark_attendance_fin_almuerzo(numeric, numeric) from public;
revoke all on function public.mark_attendance_salida(numeric, numeric) from public;
grant execute on function public.mark_attendance_ingreso(numeric, numeric) to authenticated;
grant execute on function public.mark_attendance_inicio_almuerzo() to authenticated;
grant execute on function public.mark_attendance_fin_almuerzo(numeric, numeric) to authenticated;
grant execute on function public.mark_attendance_salida(numeric, numeric) to authenticated;
