-- A0/A1 LOCAL: no modifica marcaciones existentes. Aplicar antes del frontend.
begin;
drop policy if exists company_settings_update_admin on public.company_settings;
create policy company_settings_update_superadmin on public.company_settings for update to authenticated
using (public.current_user_role() = 'SUPERADMIN') with check (public.current_user_role() = 'SUPERADMIN');
drop policy if exists feriados_write_admin on public.feriados;
create policy feriados_insert_superadmin on public.feriados for insert to authenticated with check (public.current_user_role()='SUPERADMIN');
create policy feriados_update_superadmin on public.feriados for update to authenticated using (public.current_user_role()='SUPERADMIN') with check (public.current_user_role()='SUPERADMIN');
create policy feriados_delete_superadmin on public.feriados for delete to authenticated using (public.current_user_role()='SUPERADMIN');

create table public.asistencia_solicitudes (
 id uuid primary key, user_id uuid not null references public.profiles(id), fecha date not null,
 motivo text not null check(motivo in ('salud','asuntos_personales','emergencia','otros')),
 observacion text check(length(observacion)<=1000), estado text not null default 'pendiente' check(estado in ('pendiente','aprobada','rechazada')),
 version integer not null default 1, created_at timestamptz not null default now(),
 resolved_at timestamptz, resolved_by uuid references public.profiles(id), decision_motivo text,
 check ((estado='pendiente' and resolved_at is null and resolved_by is null) or (estado<>'pendiente' and resolved_at is not null and resolved_by is not null))
);
create unique index asistencia_solicitud_activa on public.asistencia_solicitudes(user_id,fecha) where estado in ('pendiente','aprobada');
create index asistencia_solicitudes_fecha on public.asistencia_solicitudes(fecha,id);
create index asistencia_solicitudes_usuario on public.asistencia_solicitudes(user_id,fecha desc,id);
create table public.asistencia_solicitud_eventos (
 id bigint generated always as identity primary key, solicitud_id uuid not null references public.asistencia_solicitudes(id),
 actor_id uuid not null references public.profiles(id), actor_rol text not null,
 estado_anterior text, estado_nuevo text not null, motivo text, created_at timestamptz not null default now()
);
create index asistencia_eventos_solicitud on public.asistencia_solicitud_eventos(solicitud_id,id);
alter table public.asistencia_solicitudes enable row level security;
alter table public.asistencia_solicitud_eventos enable row level security;
create policy asistencia_solicitudes_lectura on public.asistencia_solicitudes for select to authenticated
using (public.current_user_role()='SUPERADMIN' or (user_id=auth.uid() and public.current_user_role() in ('ADMIN','TECNICO_RED')));
create policy asistencia_eventos_lectura on public.asistencia_solicitud_eventos for select to authenticated
using (exists(select 1 from public.asistencia_solicitudes s where s.id=solicitud_id));
revoke all on public.asistencia_solicitudes, public.asistencia_solicitud_eventos from anon, authenticated;
grant select on public.asistencia_solicitudes, public.asistencia_solicitud_eventos to authenticated;

create function public.reportar_ausencia_hoy(p_operacion_id uuid, p_fecha_esperada date, p_motivo text, p_observacion text default null)
returns public.asistencia_solicitudes language plpgsql security definer set search_path=public as $$
declare r public.asistencia_solicitudes; rol text:=public.current_user_role()::text; hoy date:=(now() at time zone 'America/Lima')::date;
begin
 if rol is null or rol not in ('ADMIN','TECNICO_RED') then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_operacion_id is null or p_fecha_esperada is null or p_motivo is null or p_motivo not in ('salud','asuntos_personales','emergencia','otros') or length(p_observacion)>1000 then raise exception 'Solicitud inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_fecha_esperada::text,0));
 select * into r from public.asistencia_solicitudes where id=p_operacion_id;
 if found then
  if r.user_id<>auth.uid() or r.fecha<>p_fecha_esperada or r.motivo<>p_motivo or r.observacion is distinct from nullif(btrim(p_observacion),'') then raise exception 'Operación reutilizada con datos diferentes'; end if;
  return r;
 end if;
 if p_fecha_esperada<>hoy then raise exception 'Solo se puede reportar el día actual de Perú'; end if;
 insert into public.asistencia_solicitudes(id,user_id,fecha,motivo,observacion) values(p_operacion_id,auth.uid(),hoy,p_motivo,nullif(btrim(p_observacion),'')) returning * into r;
 insert into public.asistencia_solicitud_eventos(solicitud_id,actor_id,actor_rol,estado_nuevo) values(r.id,auth.uid(),rol,'pendiente');
 return r;
end $$;

create function public.resolver_ausencia(p_solicitud_id uuid,p_version_esperada integer,p_decision text,p_motivo text)
returns public.asistencia_solicitudes language plpgsql security definer set search_path=public as $$
declare r public.asistencia_solicitudes;
begin
 if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN puede resolver' using errcode='42501'; end if;
 if p_decision is null or p_decision not in ('aprobada','rechazada') or nullif(btrim(p_motivo),'') is null or length(p_motivo)>1000 then raise exception 'Decisión y motivo requeridos'; end if;
 select * into r from public.asistencia_solicitudes where id=p_solicitud_id;
 if not found then raise exception 'Solicitud inexistente'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.user_id::text||r.fecha::text,0));
 select * into r from public.asistencia_solicitudes where id=p_solicitud_id for update;
 if r.estado<>'pendiente' or r.version is distinct from p_version_esperada then raise exception 'La solicitud ya cambió; actualice la bandeja' using errcode='40001'; end if;
 if p_decision='aprobada' and exists(select 1 from public.asistencia_registros where user_id=r.user_id and fecha=r.fecha and hora_ingreso is not null) then raise exception 'Existe marcación de ingreso; no se puede justificar una ausencia de día completo'; end if;
 update public.asistencia_solicitudes set estado=p_decision,version=version+1,resolved_at=now(),resolved_by=auth.uid(),decision_motivo=btrim(p_motivo) where id=r.id returning * into r;
 insert into public.asistencia_solicitud_eventos(solicitud_id,actor_id,actor_rol,estado_anterior,estado_nuevo,motivo) values(r.id,auth.uid(),'SUPERADMIN','pendiente',p_decision,btrim(p_motivo));
 return r;
end $$;

-- Resumen sin motivos privados para ADMIN; paginación keyset estable por fecha/usuario.
create function public.asistencia_ausencias_resumen(p_desde date,p_hasta date,p_cursor_fecha date default null,p_cursor_usuario uuid default null)
returns table(user_id uuid,fecha date,estado text) language plpgsql security definer set search_path=public as $$
begin
 if public.current_user_role() is null or public.current_user_role() not in ('SUPERADMIN','ADMIN') then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_desde is null or p_hasta is null or p_hasta<p_desde or p_hasta-p_desde>62 or (p_cursor_fecha is null)<>(p_cursor_usuario is null) then raise exception 'Rango o cursor inválido'; end if;
 return query select s.user_id,s.fecha,s.estado from (
  select distinct on (a.fecha,a.user_id) a.user_id,a.fecha,a.estado from public.asistencia_solicitudes a
  where a.fecha between p_desde and p_hasta order by a.fecha,a.user_id,a.created_at desc,a.id desc
 ) s where p_cursor_fecha is null or (s.fecha,s.user_id)>(p_cursor_fecha,p_cursor_usuario)
 order by s.fecha,s.user_id limit 500;
end $$;

-- Protege el historial incluso ante cascadas. Serializa marcación/resolución.
create function public.asistencia_guardar_historial() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then raise exception 'No se permite borrar marcaciones'; end if;
 if public.current_user_role() is null or public.current_user_role() not in ('SUPERADMIN','ADMIN','TECNICO_RED','SOPORTE','FACTURACION') or new.user_id is distinct from auth.uid() then raise exception 'Marcación no autorizada' using errcode='42501'; end if;
 if new.fecha<>(now() at time zone 'America/Lima')::date then raise exception 'No se permite modificar marcaciones históricas'; end if;
 if tg_op='UPDATE' and (old.fecha<>new.fecha or old.user_id<>new.user_id or old.id<>new.id) then raise exception 'Identidad de marcación inmutable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||new.fecha::text,0));
 return new;
end $$;
create trigger asistencia_historial_guard before insert or update or delete on public.asistencia_registros for each row execute function public.asistencia_guardar_historial();

-- Impide que feriados retroactivos cambien el cálculo histórico de faltas.
create function public.asistencia_feriado_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN configura feriados' using errcode='42501'; end if;
 if (tg_op<>'INSERT' and old.fecha<(now() at time zone 'America/Lima')::date) or (tg_op<>'DELETE' and new.fecha<(now() at time zone 'America/Lima')::date) then raise exception 'No se permite cambiar feriados históricos'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger asistencia_feriado_guard before insert or update or delete on public.feriados for each row execute function public.asistencia_feriado_guard();

create table public.asistencia_config_eventos (
 id bigint generated always as identity primary key, actor_id uuid not null references public.profiles(id),
 tabla text not null, accion text not null, anterior jsonb, nuevo jsonb, created_at timestamptz not null default now()
);
alter table public.asistencia_config_eventos enable row level security;
revoke all on public.asistencia_config_eventos from public,anon,authenticated;
grant select on public.asistencia_config_eventos to authenticated;
create policy asistencia_config_auditoria_lectura on public.asistencia_config_eventos for select to authenticated using(public.current_user_role()='SUPERADMIN');
create function public.asistencia_config_auditar() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN configura asistencia' using errcode='42501'; end if;
 insert into public.asistencia_config_eventos(actor_id,tabla,accion,anterior,nuevo)
 values(auth.uid(),tg_table_name,tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger asistencia_settings_auditar after insert or update or delete on public.company_settings for each row execute function public.asistencia_config_auditar();
create trigger asistencia_feriados_auditar after insert or update or delete on public.feriados for each row execute function public.asistencia_config_auditar();
revoke all on function public.asistencia_config_auditar() from public,anon,authenticated;
revoke all on function public.reportar_ausencia_hoy(uuid,date,text,text),public.resolver_ausencia(uuid,integer,text,text),public.asistencia_ausencias_resumen(date,date,date,uuid) from public,anon;
grant execute on function public.reportar_ausencia_hoy(uuid,date,text,text),public.resolver_ausencia(uuid,integer,text,text),public.asistencia_ausencias_resumen(date,date,date,uuid) to authenticated;
revoke all on function public.asistencia_guardar_historial(),public.asistencia_feriado_guard() from public,anon,authenticated;
revoke insert,update,delete,truncate on public.asistencia_registros from anon,authenticated;
revoke execute on function public.mark_attendance_ingreso(numeric,numeric),public.mark_attendance_inicio_almuerzo(),public.mark_attendance_fin_almuerzo(numeric,numeric),public.mark_attendance_salida(numeric,numeric) from public,anon;
commit;
