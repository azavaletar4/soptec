-- Fase: ampliación de permisos operativos de ADMIN a la par de SUPERADMIN.
--
-- Alcance verificado en vivo (solo lectura, antes de escribir este archivo)
-- contra la base real (mzupdnjegfwmpajywckd): cada guarda tocada abajo fue
-- leída con pg_get_functiondef/pg_policies antes de reescribirla, para no
-- adivinar el estado actual. Se deja fuera a propósito (sigue exclusivo de
-- SUPERADMIN, NO se toca en este archivo):
--   - trg_profiles_authorization_guard / guard_profile_authorization()
--     (gestión de roles y cuentas — vive solo en la rama
--     fix/profiles-role-security-20261119, ya aplicada en producción; no
--     se reescribe ni se debilita, solo se le agrega auditoría visible).
--   - routes/users.ts (crear/editar/eliminar cuentas de staff, cambiar rol).
--   - Proxmox / credenciales e infraestructura sensible.
--   - guard_final_work_order() / work_order_point_confirmations (cierre
--     administrativo definitivo) — bloquea a TODOS, incluido SUPERADMIN;
--     es una guarda de integridad distinta, no de rol, no se toca.
--
-- Patrón reutilizado en todo el archivo (nunca uno nuevo por tabla): un solo
-- helper `log_admin_audit()` + una sola tabla `admin_audit_log` (igual
-- forma que la ya existente `asistencia_config_eventos`: actor, tabla,
-- acción, entidad, antes/después, motivo opcional) para cerrar los vacíos
-- de auditoría detectados en la revisión. Donde ya existía buena
-- trazabilidad (Kardex de inventario, asistencia_solicitud_eventos,
-- fo_cable_endpoint_unlink_log, work_order_point_confirmations) no se
-- duplica nada nuevo.

-- =====================================================================
-- 1) Auditoría genérica reutilizable — tabla insert-only, nunca editable
--    ni borrable (mismo patrón ya probado en olt_alert_log/
--    fo_cable_endpoint_unlink_log: solo policies de select/insert).
-- =====================================================================

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  -- Nullable a propósito: la mayoría de los disparadores ven el auth.uid()
  -- real de quien ejecuta la acción (RLS normal, incluso con funciones
  -- SECURITY DEFINER — eso cambia el privilegio de ejecución, no el JWT).
  -- La única excepción conocida es el cambio de rol/activación vía
  -- `PATCH /users/:id` (server/src/routes/users.ts), que usa el cliente
  -- service_role del backend y no lleva el JWT del admin actuante — ahí
  -- el actor queda NULL (sabemos QUÉ cambió y CUÁNDO, no QUIÉN desde la
  -- base). Mejora futura fuera de este alcance: que ese endpoint pase el
  -- actor explícito (ej. set_config('request.jwt.claim.sub', ...)).
  actor_id uuid references public.profiles(id),
  actor_role public.user_role,
  tabla text not null,
  accion text not null,
  entidad_id text,
  anterior jsonb,
  nuevo jsonb,
  motivo text,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Auditoría genérica de operaciones administrativas críticas (fase ampliación ADMIN, 2026-11-24). Insert-only: sin policy de update/delete a propósito, igual patrón que olt_alert_log y fo_cable_endpoint_unlink_log.';

create index if not exists admin_audit_log_tabla_created_at_idx on public.admin_audit_log (tabla, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists admin_audit_log_select_staff on public.admin_audit_log;
create policy admin_audit_log_select_staff on public.admin_audit_log
  for select using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- Sin policy de insert directa: solo se escribe vía log_admin_audit()
-- (SECURITY DEFINER) desde los triggers de abajo, nunca desde el cliente.
grant select on public.admin_audit_log to authenticated;

create or replace function public.log_admin_audit(
  p_tabla text, p_accion text, p_entidad_id text,
  p_anterior jsonb, p_nuevo jsonb, p_motivo text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_audit_log(actor_id, actor_role, tabla, accion, entidad_id, anterior, nuevo, motivo)
  values (auth.uid(), public.current_user_role(), p_tabla, p_accion, p_entidad_id, p_anterior, p_nuevo, p_motivo);
end;
$$;

revoke all on function public.log_admin_audit(text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.log_admin_audit(text, text, text, jsonb, jsonb, text) to authenticated;

-- =====================================================================
-- 2) Inventario — desactivar producto (ampliado a ADMIN) + auditoría.
--    Eliminar una unidad serializada YA estaba permitido para ADMIN por
--    la policy `inventory_admin_only` (FOR ALL) — eso no cambia aquí,
--    solo se le agrega la auditoría que faltaba.
-- =====================================================================

create or replace function public.guard_inventory_product_deactivation()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_active = true and new.is_active = false and public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo SUPERADMIN o ADMIN pueden desactivar un producto de inventario';
  end if;
  if old.is_active = true and new.is_active = false then
    perform public.log_admin_audit('inventory_products', 'deactivate', old.id::text, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

create or replace function public.audit_inventory_unit_delete()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_admin_audit('inventory_units', 'delete', old.id::text, to_jsonb(old), null);
  return old;
end;
$$;

drop trigger if exists trg_inventory_units_audit_delete on public.inventory_units;
create trigger trg_inventory_units_audit_delete
  after delete on public.inventory_units
  for each row execute function public.audit_inventory_unit_delete();

-- =====================================================================
-- 3) Facturación — eliminar factura (ampliado a ADMIN) + auditoría.
--    Editar/crear/marcar pagada ya eran compartidas; solo DELETE era
--    exclusiva de SUPERADMIN (fase35_eliminar_facturas_superadmin.sql).
-- =====================================================================

drop policy if exists invoices_delete_superadmin on public.invoices;
create policy invoices_delete_staff on public.invoices
  for delete using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

create or replace function public.audit_invoice_delete()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_admin_audit('invoices', 'delete', old.id::text, to_jsonb(old), null);
  return old;
end;
$$;

drop trigger if exists trg_invoices_audit_delete on public.invoices;
create trigger trg_invoices_audit_delete
  before delete on public.invoices
  for each row execute function public.audit_invoice_delete();

-- =====================================================================
-- 4) Mapa de red — eliminar NAP/MUFA/cable/hilo del mapa en vivo, y
--    desvincular un extremo de cable ya conectado (ambos ampliados a
--    ADMIN). `guard_map_passive_delete` (baja digital/catálogo) ya
--    incluía ADMIN/TECNICO_RED — no se toca, es un mecanismo distinto.
-- =====================================================================

create or replace function public.remove_from_network_map(p_kind text, p_id uuid, p_token text, p_hilo integer default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare s jsonb; at_time timestamptz = clock_timestamp(); fusion_ids uuid[];
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception using errcode='42501',message='Solo SUPERADMIN o ADMIN pueden eliminar elementos del mapa.'; end if;
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
  perform public.log_admin_audit('network_map', p_kind || '_remove', p_id::text, s, null);
  return jsonb_build_object('id',p_id,'kind',p_kind,'hilo',p_hilo,'removedAt',at_time,'fusionIds',to_jsonb(fusion_ids),
    'thread',case when p_kind='hilo' then (select to_jsonb(h) from public.fo_hilo_estados h where cable_id=p_id and hilo_index=p_hilo) end);
end $$;

-- `guard_cable_endpoint_unlink` NO vive en esta rama (solo en la release ya
-- desplegada `release/mapa-control-total-superadmin-20261121`, migración
-- 20261121190726). Se recrea aquí de cero con el mismo comportamiento real
-- verificado en producción, solo ampliando el rol — no se arrastra el
-- resto de esa rama ni se cherry-pickea su historial.
create table if not exists public.fo_cable_endpoint_unlink_log (
  id uuid primary key default gen_random_uuid(),
  cable_id uuid not null,
  extremo text not null,
  previous_olt_id uuid,
  previous_infra_id uuid,
  unlinked_by uuid not null,
  unlinked_at timestamptz not null default now()
);

alter table public.fo_cable_endpoint_unlink_log enable row level security;

drop policy if exists fo_cable_endpoint_unlink_log_select_staff on public.fo_cable_endpoint_unlink_log;
create policy fo_cable_endpoint_unlink_log_select_staff on public.fo_cable_endpoint_unlink_log
  for select using (public.current_user_role() in ('SUPERADMIN', 'ADMIN', 'TECNICO_RED'));

grant select on public.fo_cable_endpoint_unlink_log to authenticated;

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

  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception using errcode = '42501',
      message = 'Solo SUPERADMIN o ADMIN pueden desvincular un extremo ya conectado.';
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

drop trigger if exists trg_fo_cables_endpoint_unlink_guard on public.fo_cables;
create trigger trg_fo_cables_endpoint_unlink_guard
  before update on public.fo_cables
  for each row execute function public.guard_cable_endpoint_unlink();

-- =====================================================================
-- 4b) Clientes y contratos — "Cancelar contratación no instalada"
--    (ampliado a ADMIN). Eliminar un contrato ya era compartido con ADMIN
--    por `service_contracts_staff_only` (FOR ALL) — eso NO cambia aquí,
--    solo esta RPC puntual que tenía su propio candado aparte.
-- =====================================================================

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
  perform 1 from public.profiles where id = auth.uid() and active and role::text in ('SUPERADMIN', 'ADMIN') for share;
  if not found then raise exception 'Requiere SUPERADMIN o ADMIN activo' using errcode = '42501'; end if;
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

-- =====================================================================
-- 5) Altas (Instalaciones) — edición excepcional de una orden ya
--    completed/cancelled, ampliada a ADMIN (antes solo SUPERADMIN podía
--    seguir escribiendo). Averías y Rutinas YA daban esta misma
--    capacidad a ADMIN (tickets_update_staff/routines_update_staff no
--    excluyen a ADMIN por status) — esto solo empareja Instalaciones con
--    ese mismo criterio ya existente. `guard_final_work_order` (cierre
--    administrativo definitivo) sigue bloqueando a TODOS sin excepción,
--    sin cambios.
-- =====================================================================

drop policy if exists installations_update_staff on public.installations;
create policy installations_update_staff on public.installations
  for update
  using (
    (current_user_role() = any (array['SUPERADMIN'::user_role, 'ADMIN'::user_role]))
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
  using (current_user_role() = any (array['SUPERADMIN'::user_role, 'ADMIN'::user_role, 'SOPORTE'::user_role]))
  with check (current_user_role() = any (array['SUPERADMIN'::user_role, 'ADMIN'::user_role, 'SOPORTE'::user_role]));

-- Auditoría de la edición excepcional en sí (antes no quedaba ningún
-- rastro de qué cambió en una orden ya cerrada, más allá de updated_at).
create or replace function public.audit_installation_exception_edit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('completed', 'cancelled') then
    perform public.log_admin_audit('installations', 'exception_edit', old.id::text, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_installations_audit_exception_edit on public.installations;
create trigger trg_installations_audit_exception_edit
  after update on public.installations
  for each row
  when (old.* is distinct from new.*)
  execute function public.audit_installation_exception_edit();

-- =====================================================================
-- 6) Asistencia — configurar horarios personales/feriados, programar y
--    cancelar intercambios de turno, crear y cancelar novedades
--    (vacaciones/descansos/permisos), y resolver ausencias reportadas:
--    todo ampliado de SUPERADMIN exclusivo a SUPERADMIN+ADMIN. Las
--    funciones de solo lectura (*_resumen) YA incluían ADMIN — sin
--    cambios ahí. Se corrige además un registro de auditoría que
--    quedaba mal etiquetado (ver resolver_ausencia).
-- =====================================================================

-- Lectura: si ADMIN ahora configura para todo el personal, necesita ver
-- todas las filas, no solo las propias (antes solo veía lo suyo).
drop policy if exists asistencia_horarios_personales_lectura on public.asistencia_horarios_personales;
create policy asistencia_horarios_personales_lectura on public.asistencia_horarios_personales
  for select using (current_user_role() in ('SUPERADMIN', 'ADMIN') or user_id = auth.uid());

drop policy if exists asistencia_intercambios_lectura on public.asistencia_intercambios;
create policy asistencia_intercambios_lectura on public.asistencia_intercambios
  for select using (
    current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (user_id = auth.uid() and current_user_role() = any (array['ADMIN'::user_role, 'TECNICO_RED'::user_role]))
  );

drop policy if exists asistencia_novedades_lectura on public.asistencia_novedades;
create policy asistencia_novedades_lectura on public.asistencia_novedades
  for select using (current_user_role() in ('SUPERADMIN', 'ADMIN') or user_id = auth.uid());

drop policy if exists asistencia_solicitudes_lectura on public.asistencia_solicitudes;
create policy asistencia_solicitudes_lectura on public.asistencia_solicitudes
  for select using (
    current_user_role() in ('SUPERADMIN', 'ADMIN')
    or (user_id = auth.uid() and current_user_role() = any (array['ADMIN'::user_role, 'TECNICO_RED'::user_role]))
  );

drop policy if exists asistencia_config_auditoria_lectura on public.asistencia_config_eventos;
create policy asistencia_config_auditoria_lectura on public.asistencia_config_eventos
  for select using (current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- Escritura directa de horarios personales (ALL ya cubre insert/update/delete).
drop policy if exists asistencia_horarios_personales_escritura_superadmin on public.asistencia_horarios_personales;
create policy asistencia_horarios_personales_escritura_staff on public.asistencia_horarios_personales
  for all using (current_user_role() in ('SUPERADMIN', 'ADMIN'));

create or replace function public.asistencia_config_auditar()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN configuran asistencia' using errcode='42501'; end if;
  insert into public.asistencia_config_eventos(actor_id,tabla,accion,anterior,nuevo)
  values(auth.uid(),tg_table_name,tg_op,case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function public.asistencia_feriado_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN configuran feriados' using errcode='42501'; end if;
  if (tg_op<>'INSERT' and old.fecha<(now() at time zone 'America/Lima')::date) or (tg_op<>'DELETE' and new.fecha<(now() at time zone 'America/Lima')::date) then raise exception 'No se permite cambiar feriados históricos'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function public.asistencia_horario_personal_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rol text;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN configuran horarios personales' using errcode = '42501'; end if;
  if tg_op = 'DELETE' then return old; end if;
  select role into v_rol from public.profiles where id = new.user_id and active;
  if v_rol is null then raise exception 'Colaborador inexistente o inactivo'; end if;
  if v_rol = 'SUPERADMIN' then raise exception 'SUPERADMIN está exento de asistencia; no aplica' using errcode = '42501'; end if;
  if v_rol not in ('ADMIN','TECNICO_RED') then raise exception 'Rol sin obligación de asistencia'; end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.resolver_ausencia(p_solicitud_id uuid, p_version_esperada integer, p_decision text, p_motivo text)
returns asistencia_solicitudes
language plpgsql security definer set search_path = public as $$
declare r public.asistencia_solicitudes; v_rol public.user_role;
begin
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN pueden resolver' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('aprobada','rechazada') or nullif(btrim(p_motivo),'') is null or length(p_motivo)>1000 then raise exception 'Decisión y motivo requeridos'; end if;
  select * into r from public.asistencia_solicitudes where id=p_solicitud_id;
  if not found then raise exception 'Solicitud inexistente'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.user_id::text||r.fecha::text,0));
  select * into r from public.asistencia_solicitudes where id=p_solicitud_id for update;
  if r.estado<>'pendiente' or r.version is distinct from p_version_esperada then raise exception 'La solicitud ya cambió; actualice la bandeja' using errcode='40001'; end if;
  if p_decision='aprobada' and exists(select 1 from public.asistencia_registros where user_id=r.user_id and fecha=r.fecha and hora_ingreso is not null) then raise exception 'Existe marcación de ingreso; no se puede justificar una ausencia de día completo'; end if;
  update public.asistencia_solicitudes set estado=p_decision,version=version+1,resolved_at=now(),resolved_by=auth.uid(),decision_motivo=btrim(p_motivo) where id=r.id returning * into r;
  -- Antes quedaba el texto literal 'SUPERADMIN' sin importar quién resolvía
  -- (bug de auditoría: con ADMIN habilitado, el registro mentía sobre el
  -- actor real). Se usa el rol real de quien ejecuta la acción.
  insert into public.asistencia_solicitud_eventos(solicitud_id,actor_id,actor_rol,estado_anterior,estado_nuevo,motivo) values(r.id,auth.uid(),v_rol::text,'pendiente',p_decision,btrim(p_motivo));
  return r;
end $$;

create or replace function public.asistencia_novedad_crear(p_operacion_id uuid, p_user_id uuid, p_tipo text, p_fecha_inicio date, p_fecha_fin date, p_turno text default null, p_hora_inicio time default null, p_hora_fin time default null, p_motivo text default null)
returns asistencia_novedades
language plpgsql security definer set search_path = public as $$
declare r public.asistencia_novedades; hoy date := (now() at time zone 'America/Lima')::date; v_rol text;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN configuran novedades' using errcode = '42501'; end if;
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
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN cancelan novedades' using errcode = '42501'; end if;
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
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN programan intercambios' using errcode='42501'; end if;
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
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then raise exception 'Solo SUPERADMIN o ADMIN cancelan intercambios' using errcode='42501'; end if;
  if nullif(btrim(p_motivo),'') is null or length(p_motivo)>500 then raise exception 'Escriba un motivo de cancelación (máximo 500 caracteres)'; end if;
  select * into r from public.asistencia_intercambios where id=p_id;
  if not found then raise exception 'Intercambio inexistente'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.user_id::text||'novedad',0));
  select * into r from public.asistencia_intercambios where id=p_id for update;
  if r.estado<>'activo' or least(r.fecha_descanso,r.fecha_trabajo)<=(now() at time zone 'America/Lima')::date then raise exception 'No se puede cancelar: el intercambio ya comenzó o fue cancelado'; end if;
  update public.asistencia_intercambios set estado='cancelado',cancelled_by=auth.uid(),cancelled_at=now(),cancel_motivo=btrim(p_motivo) where id=p_id returning * into r;
  return r;
end $$;

-- =====================================================================
-- 7) Auditoría de cambios de rol/activación de cuentas de staff —
--    QUIÉN puede hacerlo sigue exclusivo de SUPERADMIN
--    (trg_profiles_authorization_guard, sin tocar); esto solo agrega el
--    rastro que faltaba de qué cambió, cuándo y quién lo hizo.
-- =====================================================================

create or replace function public.audit_profile_role_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role is distinct from new.role or old.active is distinct from new.active then
    perform public.log_admin_audit('profiles', 'role_or_active_change', new.id::text, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_audit_role_change on public.profiles;
create trigger trg_profiles_audit_role_change
  after update on public.profiles
  for each row
  when (old.role is distinct from new.role or old.active is distinct from new.active)
  execute function public.audit_profile_role_change();
