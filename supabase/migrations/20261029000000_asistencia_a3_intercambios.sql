-- A3 local: pareja indivisible; sin UPDATE de marcaciones ni migraciones previas.
begin;
create table public.asistencia_intercambios (
 id uuid primary key,
 user_id uuid not null references public.profiles(id),
 fecha_descanso date not null,
 fecha_trabajo date not null,
 hora_ingreso time not null,
 hora_salida time not null,
 estado text not null default 'activo' check(estado in ('activo','cancelado')),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 cancelled_by uuid references public.profiles(id), cancelled_at timestamptz, cancel_motivo text,
 check(fecha_descanso<>fecha_trabajo), check(hora_salida>hora_ingreso),
 check((estado='activo' and cancelled_by is null and cancelled_at is null and cancel_motivo is null)
 or (estado='cancelado' and cancelled_by is not null and cancelled_at is not null and length(btrim(cancel_motivo))>0))
);
create index asistencia_intercambios_usuario on public.asistencia_intercambios(user_id,fecha_descanso,fecha_trabajo);
alter table public.asistencia_intercambios enable row level security;
create policy asistencia_intercambios_lectura on public.asistencia_intercambios for select to authenticated
using(public.current_user_role()='SUPERADMIN' or (user_id=auth.uid() and public.current_user_role() in ('ADMIN','TECNICO_RED')));
revoke all on public.asistencia_intercambios from public,anon,authenticated;
grant select on public.asistencia_intercambios to authenticated;
create trigger asistencia_intercambios_auditar after insert or update on public.asistencia_intercambios
for each row execute function public.asistencia_config_auditar();

create function public.asistencia_intercambio_crear(p_operacion_id uuid,p_user_id uuid,p_fecha_descanso date,p_fecha_trabajo date,p_hora_ingreso time,p_hora_salida time)
returns public.asistencia_intercambios language plpgsql security definer set search_path=public as $$
declare r public.asistencia_intercambios; rol text; hoy date:=(now() at time zone 'America/Lima')::date;
begin
 if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN programa intercambios' using errcode='42501'; end if;
 if p_operacion_id is null or p_user_id is null or p_fecha_descanso is null or p_fecha_trabajo is null or p_hora_ingreso is null or p_hora_salida is null then raise exception 'Complete trabajador, fechas y horario'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||least(p_fecha_descanso,p_fecha_trabajo)::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||greatest(p_fecha_descanso,p_fecha_trabajo)::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||'novedad',0));
 -- Serializa la clasificación del calendario contra altas/bajas de feriados.
 lock table public.feriados in share mode;
 select * into r from public.asistencia_intercambios where id=p_operacion_id;
 if found then
  if (r.user_id,r.fecha_descanso,r.fecha_trabajo,r.hora_ingreso,r.hora_salida) is distinct from (p_user_id,p_fecha_descanso,p_fecha_trabajo,p_hora_ingreso,p_hora_salida) then raise exception 'Operación reutilizada con datos diferentes'; end if;
  return r;
 end if;
 select role into rol from public.profiles where id=p_user_id and active;
 if rol is null or rol not in ('ADMIN','TECNICO_RED') then raise exception 'Seleccione un colaborador activo ADMIN o TECNICO_RED; SUPERADMIN está exento'; end if;
 if least(p_fecha_descanso,p_fecha_trabajo)<hoy or p_fecha_descanso=p_fecha_trabajo or p_hora_salida<=p_hora_ingreso then raise exception 'Fechas u horario inválidos; no se permiten días pasados'; end if;
 if extract(dow from p_fecha_descanso)=0 or exists(select 1 from public.feriados where fecha=p_fecha_descanso) then raise exception 'El descanso debe reemplazar un día normalmente laborable'; end if;
 if extract(dow from p_fecha_trabajo)<>0 and not exists(select 1 from public.feriados where fecha=p_fecha_trabajo) then raise exception 'La compensación debe ser un domingo o feriado normalmente libre'; end if;
 if p_fecha_descanso=hoy and (now() at time zone 'America/Lima')::time >= coalesce(
   (select hora_ingreso from public.asistencia_horarios_personales where user_id=p_user_id and dia_semana=extract(dow from hoy)),
   (select case when extract(dow from hoy)=1 then lunes_hora_ingreso else resto_hora_ingreso end from public.company_settings where id=1)
 ) then raise exception 'La jornada que desea dar libre ya comenzó; programe otro día'; end if;
 if p_fecha_trabajo=hoy and (now() at time zone 'America/Lima')::time>=p_hora_ingreso then raise exception 'La jornada compensatoria ya comenzó'; end if;
 if exists(select 1 from public.asistencia_registros where user_id=p_user_id and fecha in (p_fecha_descanso,p_fecha_trabajo))
 or exists(select 1 from public.asistencia_solicitudes where user_id=p_user_id and fecha in (p_fecha_descanso,p_fecha_trabajo)) then raise exception 'Ya hay marcaciones o solicitudes en esas fechas'; end if;
 if exists(select 1 from public.asistencia_intercambios where user_id=p_user_id and estado='activo' and
 (fecha_descanso in (p_fecha_descanso,p_fecha_trabajo) or fecha_trabajo in (p_fecha_descanso,p_fecha_trabajo))) then raise exception 'Ya existe un intercambio para alguna de esas fechas'; end if;
 if exists(select 1 from public.asistencia_novedades where user_id=p_user_id and estado='activa' and
 (p_fecha_descanso between fecha_inicio and fecha_fin or p_fecha_trabajo between fecha_inicio and fecha_fin)) then raise exception 'Hay vacaciones, descanso o permiso en alguna de esas fechas'; end if;
 insert into public.asistencia_intercambios(id,user_id,fecha_descanso,fecha_trabajo,hora_ingreso,hora_salida,created_by)
 values(p_operacion_id,p_user_id,p_fecha_descanso,p_fecha_trabajo,p_hora_ingreso,p_hora_salida,auth.uid()) returning * into r;
 return r;
end $$;

-- Sin edición parcial: cancelar la pareja antes de que empiece cualquiera de sus días.
create function public.asistencia_intercambio_cancelar(p_id uuid,p_motivo text)
returns public.asistencia_intercambios language plpgsql security definer set search_path=public as $$
declare r public.asistencia_intercambios;
begin
 if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN cancela intercambios' using errcode='42501'; end if;
 if nullif(btrim(p_motivo),'') is null or length(p_motivo)>500 then raise exception 'Escriba un motivo de cancelación (máximo 500 caracteres)'; end if;
 select * into r from public.asistencia_intercambios where id=p_id;
 if not found then raise exception 'Intercambio inexistente'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.user_id::text||'novedad',0));
 select * into r from public.asistencia_intercambios where id=p_id for update;
 if r.estado<>'activo' or least(r.fecha_descanso,r.fecha_trabajo)<=(now() at time zone 'America/Lima')::date then raise exception 'No se puede cancelar: el intercambio ya comenzó o fue cancelado'; end if;
 update public.asistencia_intercambios set estado='cancelado',cancelled_by=auth.uid(),cancelled_at=now(),cancel_motivo=btrim(p_motivo) where id=p_id returning * into r;
 return r;
end $$;

-- Resumen administrativo sin datos privados ni identidad del autorizador.
create function public.asistencia_intercambios_resumen(p_desde date,p_hasta date,p_cursor_fecha date default null,p_cursor_usuario uuid default null)
returns table(user_id uuid,fecha date,tipo text,hora_ingreso time,hora_salida time,fecha_vinculada date)
language plpgsql security definer set search_path=public as $$
begin
 if public.current_user_role() is null or public.current_user_role() not in ('SUPERADMIN','ADMIN') then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_desde is null or p_hasta is null or p_hasta<p_desde or p_hasta-p_desde>62 or (p_cursor_fecha is null)<>(p_cursor_usuario is null) then raise exception 'Rango o cursor inválido'; end if;
 return query select i.user_id,d.fecha,d.tipo,i.hora_ingreso,i.hora_salida,d.vinculada
 from public.asistencia_intercambios i cross join lateral
 (values(i.fecha_descanso,'descanso'::text,i.fecha_trabajo),(i.fecha_trabajo,'trabajo'::text,i.fecha_descanso)) d(fecha,tipo,vinculada)
 where i.estado='activo' and d.fecha between p_desde and p_hasta
 and (p_cursor_fecha is null or (d.fecha,i.user_id)>(p_cursor_fecha,p_cursor_usuario))
 order by d.fecha,i.user_id limit 500;
end $$;

-- A2 conserva su RPC; este guard impide crear posteriormente una novedad contradictoria.
create function public.asistencia_a3_conflicto_novedad() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||'novedad',0));
 if new.estado='activa' and exists(select 1 from public.asistencia_intercambios i where i.user_id=new.user_id and i.estado='activo' and
 (i.fecha_descanso between new.fecha_inicio and new.fecha_fin or i.fecha_trabajo between new.fecha_inicio and new.fecha_fin)) then raise exception 'La novedad se superpone con un intercambio autorizado'; end if;
 return new;
end $$;
create trigger asistencia_a3_novedades_guard before insert or update on public.asistencia_novedades for each row execute function public.asistencia_a3_conflicto_novedad();

create function public.asistencia_a3_solicitud_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||new.fecha::text,0));
 if exists(select 1 from public.asistencia_intercambios where user_id=new.user_id and estado='activo' and fecha_descanso=new.fecha) then
 raise exception 'Ese día ya tiene descanso autorizado por intercambio'; end if;
 return new;
end $$;
create trigger asistencia_a3_solicitud_guard before insert or update on public.asistencia_solicitudes for each row execute function public.asistencia_a3_solicitud_guard();
revoke all on function public.asistencia_a3_solicitud_guard() from public,anon,authenticated;

create function public.asistencia_a3_conflicto_feriado() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.asistencia_intercambios i where i.estado='activo' and
 ((tg_op<>'INSERT' and old.fecha in (i.fecha_descanso,i.fecha_trabajo)) or (tg_op<>'DELETE' and new.fecha in (i.fecha_descanso,i.fecha_trabajo)))) then
 raise exception 'La fecha pertenece a un intercambio autorizado; conserve su calendario'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger asistencia_a3_feriados_guard before insert or update or delete on public.feriados for each row execute function public.asistencia_a3_conflicto_feriado();
revoke all on function public.asistencia_a3_conflicto_novedad(),public.asistencia_a3_conflicto_feriado() from public,anon,authenticated;
revoke all on function public.asistencia_intercambio_crear(uuid,uuid,date,date,time,time),public.asistencia_intercambio_cancelar(uuid,text),public.asistencia_intercambios_resumen(date,date,date,uuid) from public,anon;
grant execute on function public.asistencia_intercambio_crear(uuid,uuid,date,date,time,time),public.asistencia_intercambio_cancelar(uuid,text),public.asistencia_intercambios_resumen(date,date,date,uuid) to authenticated;

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
  v_intercambio public.asistencia_intercambios;
begin
  select * into v_settings from public.company_settings where id = 1;
  v_lima_now := now() at time zone 'America/Lima';
  v_hoy := v_lima_now::date;
  v_dow := extract(dow from v_hoy); -- 0 = domingo ... 6 = sabado

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || v_hoy::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || 'novedad', 0));
  select * into v_intercambio from public.asistencia_intercambios
    where user_id=auth.uid() and estado='activo' and v_hoy in (fecha_descanso,fecha_trabajo);
  if v_intercambio.fecha_descanso = v_hoy then
    raise exception 'Hoy tienes descanso autorizado por intercambio.';
  end if;
  if v_dow = 0 and v_intercambio.id is null then
    raise exception 'Hoy es domingo — no es un dia laborable.';
  end if;
  if v_intercambio.id is null and exists (select 1 from public.feriados where fecha = v_hoy) then
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

  if v_intercambio.id is not null then
    v_hora_limite := v_intercambio.hora_ingreso;
  elsif v_novedad.id is not null and v_novedad.tipo = 'media_jornada' then
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
