-- Fase 30: configuracion administrable de responsables visibles en el
-- selector de Caja Chica (nunca una lista de nombres en el codigo) +
-- categorias separadas por tipo ingreso/egreso. Decisiones del propietario
-- registradas en DECISIONES_FINANCIERAS.md ("Decisiones Fase 30", 27/11/2026).
-- Esquema real verificado de solo lectura antes de escribir esta migracion
-- (scripts/inventory-auth-lab/runtime/finance-phase28-private/secure/
-- fase28-fase30-schema-verificacion-20261127-private.json): 8 categorias
-- reales (no 5, incluye "Instalacion" agregada despues de Fase 43), los 9
-- perfiles nombrados por el propietario existen con ese full_name exacto,
-- sin homonimos, y admin_audit_log/log_admin_audit ya existen tal como se
-- usan en otras fases (log_admin_audit es SECURITY DEFINER, confirmado).
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- =========================================================
-- Categorias por tipo: conserva las 8 filas y sus relaciones existentes
-- (categoria_id en caja_chica_movimientos no se toca). Por defecto
-- 'egreso' (7 de las 8 ya lo son); "Cobros de clientes" es la unica
-- categoria automatica de ingreso.
-- =========================================================
alter table public.caja_chica_categorias
  add column tipo text not null default 'egreso' check (tipo in ('ingreso','egreso'));
update public.caja_chica_categorias set tipo='ingreso' where nombre='Cobros de clientes';

-- =========================================================
-- Responsables visibles en Caja Chica: tabla propia, auditada, nunca una
-- lista fija en el codigo. Ausencia de fila = visible (regla "personal
-- nuevo visible por defecto" de DECISIONES_FINANCIERAS.md) — solo se
-- guardan las excepciones que un ADMIN/SUPERADMIN decide ocultar.
-- =========================================================
create table public.caja_chica_responsables_visibles (
  profile_id  uuid primary key references public.profiles (id),
  visible     boolean not null,
  updated_by  uuid not null references public.profiles (id),
  updated_at  timestamptz not null default now(),
  reason      text not null check (length(btrim(reason)) between 5 and 500)
);
comment on table public.caja_chica_responsables_visibles is 'Fase 30: excepciones de visibilidad del selector de "Responsable" en Caja Chica. Solo filtra ese selector — nunca modifica rol, cuenta ni permisos del perfil en ningun otro modulo.';

alter table public.caja_chica_responsables_visibles enable row level security;
create policy "caja_chica_responsables_visibles_admin_only"
  on public.caja_chica_responsables_visibles for all to authenticated
  using (public.current_user_role() in ('SUPERADMIN','ADMIN'))
  with check (public.current_user_role() in ('SUPERADMIN','ADMIN'));
revoke all on public.caja_chica_responsables_visibles from public,anon,service_role;

-- Lectura fusionada: profiles (staff real, mismo criterio que
-- profiles_select_staff_for_assignment de Fase 6: role<>CLIENTE, activo)
-- + las excepciones guardadas. coalesce(visible,true) = sin fila, visible.
create function public.caja_responsables_config() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true);
begin
 return (select coalesce(jsonb_agg(jsonb_build_object(
   'profileId',p.id,'fullName',coalesce(p.full_name,p.email),'role',p.role::text,
   'visible',coalesce(v.visible,true),'updatedAt',v.updated_at,'reason',v.reason
  ) order by p.full_name),'[]'::jsonb)
  from public.profiles p left join public.caja_chica_responsables_visibles v on v.profile_id=p.id
  where p.role::text<>'CLIENTE' and p.active);
end $$;
revoke all on function public.caja_responsables_config() from public,anon,service_role;
grant execute on function public.caja_responsables_config() to authenticated;

-- Escritura auditada e idempotente por operation_id (mismo patron que
-- caja_owner_withdraw/caja_close_day): activa/desactiva a un responsable
-- del selector, sin tocar su rol ni su acceso en ningun otro modulo.
create function public.caja_set_responsable_visible(p_operation_id uuid, p_profile_id uuid, p_visible boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.finance_require_actor(true); prior public.admin_audit_log%rowtype; payload jsonb; previous_visible boolean; result jsonb;
begin
 if p_operation_id is null or p_profile_id is null or p_visible is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
  raise exception 'Operación, responsable, visibilidad y motivo requeridos';
 end if;
 if not exists(select 1 from public.profiles where id=p_profile_id and role::text<>'CLIENTE' and active) then
  raise exception 'Responsable no encontrado o inactivo';
 end if;
 payload:=jsonb_build_object('kind','set_responsable_visible','profileId',p_profile_id,'visible',p_visible,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,30));
 select * into prior from public.admin_audit_log where tabla='caja_chica_responsables_visibles' and accion='set_visible' and entidad_id=p_operation_id::text;
 if found then
  if prior.actor_id<>actor or prior.nuevo->'payload'<>payload then raise exception 'Clave usada por otro cambio'; end if;
  return prior.nuevo->'result';
 end if;
 select visible into previous_visible from public.caja_chica_responsables_visibles where profile_id=p_profile_id;
 insert into public.caja_chica_responsables_visibles(profile_id,visible,updated_by,updated_at,reason)
  values(p_profile_id,p_visible,actor,now(),p_reason)
  on conflict(profile_id) do update set visible=excluded.visible,updated_by=excluded.updated_by,updated_at=now(),reason=excluded.reason;
 result:=jsonb_build_object('profileId',p_profile_id,'visible',p_visible);
 perform public.log_admin_audit('caja_chica_responsables_visibles','set_visible',p_operation_id::text,
  jsonb_build_object('visible',coalesce(previous_visible,true)), jsonb_build_object('payload',payload,'result',result), p_reason);
 return result;
end $$;
revoke all on function public.caja_set_responsable_visible(uuid,uuid,boolean,text) from public,anon,service_role;
grant execute on function public.caja_set_responsable_visible(uuid,uuid,boolean,text) to authenticated;

-- =========================================================
-- Semilla UNICA de la decision exacta del propietario (27/11/2026,
-- DECISIONES_FINANCIERAS.md "Decisiones Fase 30"). Los profile_id de abajo
-- son los 9 reales, confirmados por lectura directa de producción antes de
-- escribir esta migración (sin homónimos) — es la única vez que esta
-- migración referencia identidades puntuales; el mecanismo permanente de
-- aquí en adelante es la tabla/RPC de arriba, administrable sin tocar
-- código. El "where exists" hace la semilla segura de reintentar y segura
-- de correr en un entorno donde esos perfiles no existan (p. ej. pruebas
-- aisladas): si un id no está en profiles, esa fila simplemente no se
-- inserta, sin fallar el resto de la migración.
-- =========================================================
insert into public.caja_chica_responsables_visibles(profile_id,visible,updated_by,reason)
select v.profile_id, false, v.updated_by, v.reason
from (values
 ('c85ecc15-422f-4445-a0ad-aa43016e7ace'::uuid, '10f2fedc-b407-465c-af16-3c64d4364eb6'::uuid, 'Fase 30: decisión inicial del propietario (27/11/2026) — cuenta de prueba, oculta del selector de Caja Chica'),
 ('c39ac24c-dc35-498c-902d-c3974db453c3'::uuid, '10f2fedc-b407-465c-af16-3c64d4364eb6'::uuid, 'Fase 30: decisión inicial del propietario (27/11/2026) — oculta del selector de Caja Chica'),
 ('a7b2f136-a5a7-432e-9445-2402862c7df8'::uuid, '10f2fedc-b407-465c-af16-3c64d4364eb6'::uuid, 'Fase 30: decisión inicial del propietario (27/11/2026) — oculta del selector de Caja Chica'),
 ('1f14a783-cf28-4641-a059-b5d571a9d8f2'::uuid, '10f2fedc-b407-465c-af16-3c64d4364eb6'::uuid, 'Fase 30: decisión inicial del propietario (27/11/2026) — oculta del selector de Caja Chica'),
 ('d8574a9e-3929-4c26-b21e-e37ab10b6248'::uuid, '10f2fedc-b407-465c-af16-3c64d4364eb6'::uuid, 'Fase 30: decisión inicial del propietario (27/11/2026) — oculta del selector de Caja Chica')
) as v(profile_id,updated_by,reason)
where exists(select 1 from public.profiles p where p.id=v.profile_id)
  and exists(select 1 from public.profiles p where p.id=v.updated_by)
on conflict (profile_id) do nothing;
-- alex raico, Alhely Lozano y ANGIE LAGUNA no necesitan fila: la ausencia
-- de fila ya es "visible" por defecto (regla permanente de arriba).
-- "Alex Prueba" (nombrada por el propietario para excluir) NO se encontró
-- en profiles.full_name al verificar producción el 27/11/2026 (ni exacto ni
-- case-insensitive) — no se adivina su identidad; queda pendiente de que el
-- propietario confirme el nombre/correo exacto para agregarla después desde
-- el propio panel de Configuración (nunca requiere una migración nueva).

commit;
