-- SmartRayco — ROLLBACK de "ampliación de permisos operativos de ADMIN"
-- (20261124120000_admin_operational_parity.sql). NO es una migración de
-- avance — vive fuera de supabase/migrations/ a propósito, para que
-- ninguna herramienta la aplique por error junto a las demás. Ejecutar a
-- mano, solo si esa migración ya se aplicó y hace falta revertirla.
--
-- Restaura EXACTAMENTE las definiciones de rol tal como estaban
-- inmediatamente antes (verificadas en vivo contra producción antes de
-- escribir la migración de avance) — texto literal, no una aproximación.
-- Idempotente: se puede re-ejecutar sin error.
--
-- A PROPÓSITO no borra ninguna tabla ni fila de auditoría
-- (admin_audit_log, fo_cable_endpoint_unlink_log): revertir PERMISOS
-- nunca debe destruir HISTORIAL ya escrito. Con los roles restaurados,
-- ADMIN simplemente deja de poder disparar esos triggers de auditoría de
-- nuevo — no hace falta tocarlos ni las tablas que escriben.

-- 1) Inventario — desactivar producto, de nuevo exclusivo SUPERADMIN.
create or replace function public.guard_inventory_product_deactivation()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_active = true and new.is_active = false and public.current_user_role() <> 'SUPERADMIN' then
    raise exception 'Solo el Super Admin tiene permisos para eliminar o alterar registros de inventario';
  end if;
  return new;
end;
$$;

-- 2) Facturación — eliminar factura, de nuevo exclusivo SUPERADMIN.
drop policy if exists invoices_delete_staff on public.invoices;
create policy invoices_delete_superadmin on public.invoices
  for delete using (current_user_role() = 'SUPERADMIN'::user_role);

-- 2b) Clientes y contratos — "Cancelar contratación no instalada", de
-- nuevo exclusiva SUPERADMIN (versión real vigente en producción).
create or replace function public.contract_cancel_unfulfilled(p_contract_id uuid, p_updated_at timestamp with time zone, p_reason text, p_confirm boolean)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
set lock_timeout to '3s'
as $$
declare
  parent uuid; c public.service_contracts%rowtype; next_status public.client_status;
  v_reason text; v_installation_id uuid; previous_context text;
  v_previous_contract_status public.contract_status;
begin
  perform 1 from public.profiles where id = auth.uid() and active and role::text = 'SUPERADMIN' for share;
  if not found then raise exception 'Requiere SUPERADMIN activo' using errcode = '42501'; end if;
  if p_confirm is distinct from true then raise exception 'Confirme la cancelación' using errcode = 'PNI00'; end if;
  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 5 then raise exception 'Ingrese un motivo (mínimo 5 caracteres)' using errcode = 'PNI01'; end if;

  select client_id into parent from public.service_contracts where id = p_contract_id;
  if parent is null then raise exception 'Contrato no encontrado' using errcode = 'PNI02'; end if;
  perform 1 from public.clients where id = parent for update;
  perform 1 from public.service_contracts where client_id = parent order by id for update;
  select * into c from public.service_contracts where id = p_contract_id;
  if not found or c.client_id <> parent then raise exception 'Contrato cambiado; recargue' using errcode = 'PNI03'; end if;

  if c.status = 'cancelled' then
    return jsonb_build_object('contract', to_jsonb(c), 'clientId', parent, 'alreadyCancelled', true);
  end if;
  if p_updated_at is null or c.updated_at is distinct from p_updated_at then
    raise exception 'Contrato cambiado; recargue antes de confirmar' using errcode = 'PNI03';
  end if;

  perform 1 from public.installations where client_id = parent order by id for update;

  if exists (select 1 from public.installations where contract_id = c.id and status::text in ('pending','scheduled','in_progress')) then
    raise exception 'Hay una Alta abierta de esta línea; resuélvala antes de cancelar' using errcode = 'PNI10';
  end if;
  if exists (select 1 from public.installations where contract_id = c.id and status = 'completed') then
    raise exception 'Esta línea ya tuvo una instalación completada; use la baja administrativa existente' using errcode = 'PNI11';
  end if;
  if exists (select 1 from public.invoices where contract_id = c.id) then
    raise exception 'Esta línea ya tiene facturación asociada; use la baja administrativa existente' using errcode = 'PNI12';
  end if;
  if exists (select 1 from public.olt_onts where contract_id = c.id) then
    raise exception 'Esta línea ya tiene un equipo de red (ONT) vinculado; use la baja administrativa existente' using errcode = 'PNI13';
  end if;
  if exists (select 1 from public.inventory_units where contract_id = c.id and status = 'assigned') then
    raise exception 'Hay equipo/material asignado sin devolver a bodega; resuelva el inventario antes de cancelar' using errcode = 'PNI14';
  end if;
  if exists (select 1 from public.tickets where contract_id = c.id and status::text in ('open','in_progress','rescheduled')) then
    raise exception 'Hay un ticket de soporte abierto para esta línea; resuélvalo antes de cancelar' using errcode = 'PNI15';
  end if;
  if exists (select 1 from public.routines where contract_id = c.id and status::text in ('pending','scheduled','in_progress')) then
    raise exception 'Hay una rutina abierta para esta línea; resuélvala antes de cancelar' using errcode = 'PNI16';
  end if;

  select id into v_installation_id from public.installations where contract_id = c.id order by created_at desc limit 1;
  v_previous_contract_status := c.status;

  previous_context := current_setting('app.client_retirement_id', true);
  perform set_config('app.client_retirement_id', parent::text, true);
  update public.service_contracts set status = 'cancelled' where id = c.id returning * into c;

  if exists (select 1 from public.service_contracts where client_id = parent and status = 'active') then next_status := 'active';
  elsif exists (select 1 from public.service_contracts where client_id = parent and status = 'suspended') then next_status := 'suspended';
  elsif exists (select 1 from public.installations where client_id = parent and status = 'completed') then next_status := 'retired';
  else next_status := 'prospect';
  end if;

  insert into public.contract_unfulfilled_cancellations
    (contract_id, client_id, installation_id, previous_contract_status, previous_client_status, new_client_status, reason)
  values (c.id, parent, v_installation_id, v_previous_contract_status, (select status from public.clients where id = parent), next_status, v_reason);

  update public.clients set status = next_status where id = parent and status is distinct from next_status;
  perform set_config('app.client_retirement_id', coalesce(previous_context, ''), true);

  return jsonb_build_object('contract', to_jsonb(c), 'clientId', parent, 'clientStatus', next_status, 'alreadyCancelled', false);
end $$;

-- 3) Mapa de red — eliminar elemento del mapa en vivo, de nuevo exclusivo SUPERADMIN.
create or replace function public.remove_from_network_map(p_kind text, p_id uuid, p_token text, p_hilo integer default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s jsonb; at_time timestamptz = clock_timestamp(); fusion_ids uuid[];
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception using errcode='42501',message='Solo SUPERADMIN puede eliminar elementos del mapa.'; end if;
  perform set_config('lock_timeout','2s',true);
  lock table public.infra_elementos,public.fo_cables,public.fo_hilo_estados,public.fo_fusiones,public.fo_nap_puertos,public.routines in share row exclusive mode;
  s=public.map_removal_snapshot(p_kind,p_id,p_hilo);
  if p_token is distinct from md5(s::text) then raise exception using errcode='40001',message='Las relaciones cambiaron. Revisa de nuevo el resumen antes de confirmar.'; end if;
  select coalesce(array_agg((f->>'id')::uuid),'{}') into fusion_ids from jsonb_array_elements(s->'fusiones') f;
  update public.fo_fusiones set map_removed_at=at_time where id=any(fusion_ids) and map_removed_at is null;
  if p_kind='infra' then
    update public.infra_elementos set map_removed_at=at_time where id=p_id;
    update public.fo_cables set origen_olt_id=null, origen_infra_id=null where origen_infra_id=p_id;
    update public.fo_cables set destino_olt_id=null, destino_infra_id=null where destino_infra_id=p_id;
  elsif p_kind='cable' then
    update public.fo_cables set map_removed_at=at_time where id=p_id;
  else
    insert into public.fo_hilo_estados(cable_id,hilo_index,map_removed_at) values(p_id,p_hilo,at_time)
      on conflict(cable_id,hilo_index) do update set map_removed_at=excluded.map_removed_at;
  end if;
  return jsonb_build_object('id',p_id,'kind',p_kind,'hilo',p_hilo,'removedAt',at_time,'fusionIds',to_jsonb(fusion_ids),
    'thread',case when p_kind='hilo' then (select to_jsonb(h) from public.fo_hilo_estados h where cable_id=p_id and hilo_index=p_hilo) end);
end $$;

-- Desvincular extremo de cable, de nuevo exclusivo SUPERADMIN (versión
-- real desplegada en producción vía release/mapa-control-total-superadmin-20261121).
create or replace function public.guard_cable_endpoint_unlink()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  unlinking_origen boolean;
  unlinking_destino boolean;
begin
  unlinking_origen := (old.origen_olt_id is not null or old.origen_infra_id is not null)
    and new.origen_olt_id is null and new.origen_infra_id is null;
  unlinking_destino := (old.destino_olt_id is not null or old.destino_infra_id is not null)
    and new.destino_olt_id is null and new.destino_infra_id is null;

  if not (unlinking_origen or unlinking_destino) then
    return new;
  end if;

  if public.current_user_role() is distinct from 'SUPERADMIN' then
    raise exception using errcode = '42501',
      message = 'Solo SUPERADMIN puede desvincular un extremo ya conectado.';
  end if;

  if unlinking_origen then
    insert into public.fo_cable_endpoint_unlink_log(cable_id, extremo, previous_olt_id, previous_infra_id, unlinked_by)
      values (new.id, 'origen', old.origen_olt_id, old.origen_infra_id, auth.uid());
  end if;
  if unlinking_destino then
    insert into public.fo_cable_endpoint_unlink_log(cable_id, extremo, previous_olt_id, previous_infra_id, unlinked_by)
      values (new.id, 'destino', old.destino_olt_id, old.destino_infra_id, auth.uid());
  end if;
  return new;
end $$;

-- 4) Altas — edición excepcional de instalación cerrada, de nuevo exclusiva
-- SUPERADMIN (versión real vigente en producción, verificada en vivo
-- antes de escribir la migración de avance).
drop policy if exists installations_update_staff on public.installations;
create policy installations_update_staff on public.installations
  for update
  using (
    (current_user_role() = 'SUPERADMIN'::user_role)
    or (
      (current_user_role() = 'ADMIN'::user_role)
      and (status <> all (array['completed'::installation_status, 'cancelled'::installation_status]))
    )
    or (
      (current_user_role() = 'TECNICO_RED'::user_role)
      and (status <> all (array['completed'::installation_status, 'cancelled'::installation_status]))
      and (exists (select 1 from job_assignees ja where ja.job_type = 'installation'::text and ja.job_id = installations.id and ja.technician_id = auth.uid()))
    )
  )
  with check (
    (current_user_role() = any (array['SUPERADMIN'::user_role, 'ADMIN'::user_role]))
    or (
      (current_user_role() = 'TECNICO_RED'::user_role)
      and (exists (select 1 from job_assignees ja where ja.job_type = 'installation'::text and ja.job_id = installations.id and ja.technician_id = auth.uid()))
    )
  );

drop policy if exists job_assignees_write_dispatch on public.job_assignees;
create policy job_assignees_write_dispatch on public.job_assignees
  for all
  using (
    (current_user_role() = 'SUPERADMIN'::user_role)
    or (
      (current_user_role() = any (array['ADMIN'::user_role, 'SOPORTE'::user_role]))
      and (not ((job_type = 'installation'::text) and (exists (select 1 from installations i where i.id = job_assignees.job_id and i.status = any (array['completed'::installation_status, 'cancelled'::installation_status])))))
    )
  )
  with check (
    (current_user_role() = 'SUPERADMIN'::user_role)
    or (
      (current_user_role() = any (array['ADMIN'::user_role, 'SOPORTE'::user_role]))
      and (not ((job_type = 'installation'::text) and (exists (select 1 from installations i where i.id = job_assignees.job_id and i.status = any (array['completed'::installation_status, 'cancelled'::installation_status])))))
    )
  );

-- 5) Asistencia — de nuevo exclusivo SUPERADMIN en los 8 puntos ampliados
-- (versión real vigente en producción).
drop policy if exists asistencia_horarios_personales_lectura on public.asistencia_horarios_personales;
create policy asistencia_horarios_personales_lectura on public.asistencia_horarios_personales
  for select using ((current_user_role() = 'SUPERADMIN'::user_role) or (user_id = auth.uid()));

drop policy if exists asistencia_intercambios_lectura on public.asistencia_intercambios;
create policy asistencia_intercambios_lectura on public.asistencia_intercambios
  for select using (
    (current_user_role() = 'SUPERADMIN'::user_role)
    or ((user_id = auth.uid()) and (current_user_role() = any (array['ADMIN'::user_role, 'TECNICO_RED'::user_role])))
  );

drop policy if exists asistencia_novedades_lectura on public.asistencia_novedades;
create policy asistencia_novedades_lectura on public.asistencia_novedades
  for select using ((current_user_role() = 'SUPERADMIN'::user_role) or (user_id = auth.uid()));

drop policy if exists asistencia_solicitudes_lectura on public.asistencia_solicitudes;
create policy asistencia_solicitudes_lectura on public.asistencia_solicitudes
  for select using (
    (current_user_role() = 'SUPERADMIN'::user_role)
    or ((user_id = auth.uid()) and (current_user_role() = any (array['ADMIN'::user_role, 'TECNICO_RED'::user_role])))
  );

drop policy if exists asistencia_config_auditoria_lectura on public.asistencia_config_eventos;
create policy asistencia_config_auditoria_lectura on public.asistencia_config_eventos
  for select using (current_user_role() = 'SUPERADMIN'::user_role);

drop policy if exists asistencia_horarios_personales_escritura_staff on public.asistencia_horarios_personales;
create policy asistencia_horarios_personales_escritura_superadmin on public.asistencia_horarios_personales
  for all using (current_user_role() = 'SUPERADMIN'::user_role);

create or replace function public.asistencia_config_auditar()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN configura asistencia' using errcode='42501'; end if;
  insert into public.asistencia_config_eventos(actor_id,tabla,accion,anterior,nuevo)
  values(auth.uid(),tg_table_name,tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function public.asistencia_feriado_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN configura feriados' using errcode='42501'; end if;
  if (tg_op<>'INSERT' and old.fecha<(now() at time zone 'America/Lima')::date) or (tg_op<>'DELETE' and new.fecha<(now() at time zone 'America/Lima')::date) then raise exception 'No se permite cambiar feriados históricos'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function public.asistencia_horario_personal_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
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

-- resolver_ausencia: versión real vigente en producción, texto literal
-- (incluye el bug de auditoría pre-existente, restaurado a propósito
-- porque un rollback revierte exactamente, no "corrige" nada nuevo).
create or replace function public.resolver_ausencia(p_solicitud_id uuid, p_version_esperada integer, p_decision text, p_motivo text)
returns asistencia_solicitudes
language plpgsql security definer set search_path = public as $$
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

create or replace function public.asistencia_novedad_crear(p_operacion_id uuid, p_user_id uuid, p_tipo text, p_fecha_inicio date, p_fecha_fin date, p_turno text default null, p_hora_inicio time default null, p_hora_fin time default null, p_motivo text default null)
returns asistencia_novedades
language plpgsql security definer set search_path = public as $$
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

create or replace function public.asistencia_novedad_cancelar(p_novedad_id uuid, p_version_esperada integer, p_motivo text)
returns asistencia_novedades
language plpgsql security definer set search_path = public as $$
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

create or replace function public.asistencia_intercambio_crear(p_operacion_id uuid, p_user_id uuid, p_fecha_descanso date, p_fecha_trabajo date, p_hora_ingreso time, p_hora_salida time)
returns asistencia_intercambios
language plpgsql security definer set search_path = public as $$
declare r public.asistencia_intercambios; rol text; hoy date:=(now() at time zone 'America/Lima')::date;
begin
  if public.current_user_role() is distinct from 'SUPERADMIN' then raise exception 'Solo SUPERADMIN programa intercambios' using errcode='42501'; end if;
  if p_operacion_id is null or p_user_id is null or p_fecha_descanso is null or p_fecha_trabajo is null or p_hora_ingreso is null or p_hora_salida is null then raise exception 'Complete trabajador, fechas y horario'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||least(p_fecha_descanso,p_fecha_trabajo)::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||greatest(p_fecha_descanso,p_fecha_trabajo)::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||'novedad',0));
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

create or replace function public.asistencia_intercambio_cancelar(p_id uuid, p_motivo text)
returns asistencia_intercambios
language plpgsql security definer set search_path = public as $$
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

-- Nota: admin_audit_log, log_admin_audit(), fo_cable_endpoint_unlink_log y
-- los triggers de auditoría nuevos (audit_inventory_unit_delete,
-- audit_invoice_delete, audit_installation_exception_edit,
-- audit_profile_role_change) se DEJAN intactos a propósito — con los
-- roles de arriba restaurados, ADMIN simplemente deja de poder disparar
-- la mayoría de nuevo; borrar la tabla destruiría auditoría ya escrita.
