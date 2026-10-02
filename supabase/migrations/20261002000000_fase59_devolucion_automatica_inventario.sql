-- SmartRayco — Fase 59: devolucion automatica de inventario al eliminar o
-- cancelar una instalacion, y al eliminar un ticket.
--
-- Bug reportado: installation_id/ticket_id en inventory_movements e
-- installation_id en inventory_units tienen "on delete set null" (Fase 11b/
-- 11c) — al eliminar la instalacion/ticket, la referencia se limpia sola,
-- pero NADA revierte el egreso ni devuelve las unidades asignadas a bodega.
-- El comentario de la Fase 26 ("eliminar tickets devolviendo a bodega los
-- materiales") describia esta intencion pero nunca se implemento el
-- trigger — esta fase lo agrega de verdad, y lo extiende a instalaciones
-- (eliminadas Y canceladas).
--
-- Mismo criterio que el Kardex (Fase 11/58): nunca se borra ni edita una
-- fila existente, se inserta el movimiento/evento opuesto (reverses_movement_id,
-- Fase 58) — asi current_stock se recalcula solo via los triggers que ya
-- existen (apply_inventory_movement / apply_inventory_unit_event), sin
-- tocarlo a mano y sin perder el historial.
--
-- Idempotente: cada funcion de reversa se puede llamar mas de una vez sobre
-- la misma instalacion/ticket sin duplicar nada (solo revierte lo que no
-- tenga ya una reversa).

-- ---- Egresos de consumibles (inventory_movements), por instalacion o ticket ----
create or replace function public.reverse_egreso_movements(p_installation_id uuid, p_ticket_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
begin
  for r in
    select m.*
    from public.inventory_movements m
    where m.movement_type = 'egreso'
      and (
        (p_installation_id is not null and m.installation_id = p_installation_id)
        or (p_ticket_id is not null and m.ticket_id = p_ticket_id)
      )
      and not exists (select 1 from public.inventory_movements r2 where r2.reverses_movement_id = m.id)
  loop
    insert into public.inventory_movements (product_id, movement_type, quantity, reason, reverses_movement_id)
    values (r.product_id, 'ingreso', r.quantity, p_reason, r.id);
  end loop;
end;
$$;

-- ---- Unidades serializadas asignadas (inventory_units), por instalacion ----
-- (los tickets nunca asignan unidades serializadas, solo consumibles).
create or replace function public.reverse_assigned_units_by_installation(p_installation_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
begin
  for r in
    select u.id
    from public.inventory_units u
    where u.installation_id = p_installation_id
      and u.status = 'assigned'
  loop
    insert into public.inventory_unit_events (unit_id, to_status, reason)
    values (r.id, 'in_stock', p_reason);
  end loop;
end;
$$;

-- ---- Trigger: instalacion ELIMINADA ----
create or replace function public.reverse_inventory_on_installation_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
  v_reason text;
begin
  select contract_number into v_code from public.service_contracts where id = old.contract_id;
  v_reason := format('Devolución automática por eliminación de instalación #%s', coalesce(v_code, old.id::text));
  perform public.reverse_egreso_movements(old.id, null, v_reason);
  perform public.reverse_assigned_units_by_installation(old.id, v_reason);
  return old;
end;
$$;

drop trigger if exists trg_installations_reverse_on_delete on public.installations;
create trigger trg_installations_reverse_on_delete
  before delete on public.installations
  for each row execute procedure public.reverse_inventory_on_installation_delete();

-- ---- Trigger: instalacion CANCELADA ----
-- Nunca se puede cancelar una instalacion 'completed' desde el frontend
-- (InstalacionesView.vue solo muestra "Cancelar" para pending/scheduled), asi
-- que esto nunca choca con el candado de Fase 46 (equipo de una instalacion
-- 'completed' solo lo mueve un admin) — si algun dia se permite cancelar una
-- completada, revisar esa interaccion de nuevo.
create or replace function public.reverse_inventory_on_installation_cancel()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
  v_reason text;
begin
  select contract_number into v_code from public.service_contracts where id = new.contract_id;
  v_reason := format('Devolución automática por cancelación de instalación #%s', coalesce(v_code, new.id::text));
  perform public.reverse_egreso_movements(new.id, null, v_reason);
  perform public.reverse_assigned_units_by_installation(new.id, v_reason);
  return new;
end;
$$;

drop trigger if exists trg_installations_reverse_on_cancel on public.installations;
create trigger trg_installations_reverse_on_cancel
  after update on public.installations
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute procedure public.reverse_inventory_on_installation_cancel();

-- ---- Trigger: ticket ELIMINADO ----
create or replace function public.reverse_inventory_on_ticket_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_reason text;
begin
  v_reason := format('Devolución automática por eliminación de ticket #%s', coalesce(old.ticket_number, old.id::text));
  perform public.reverse_egreso_movements(null, old.id, v_reason);
  return old;
end;
$$;

drop trigger if exists trg_tickets_reverse_on_delete on public.tickets;
create trigger trg_tickets_reverse_on_delete
  before delete on public.tickets
  for each row execute procedure public.reverse_inventory_on_ticket_delete();

-- ---- Correccion retroactiva (seguro): instalaciones YA canceladas hoy que
-- quedaron con egresos/unidades sin revertir de antes de que existiera este
-- trigger. Idempotente (reverse_* ya se saltan lo que tenga reversa). No
-- cubre instalaciones/tickets que ya fueron ELIMINADOS en el pasado — esos
-- perdieron el installation_id/ticket_id al momento del delete (on delete
-- set null), asi que ya no hay forma de identificar con certeza cuales
-- movimientos les pertenecian. Ver la consulta de auditoria (solo lectura,
-- no se ejecuta sola) al final de este archivo antes de intentar corregir
-- eso a mano.
do $$
declare
  inst record;
  v_code text;
  v_reason text;
begin
  for inst in select id, contract_id from public.installations where status = 'cancelled' loop
    select contract_number into v_code from public.service_contracts where id = inst.contract_id;
    v_reason := format('Devolución automática (corrección retroactiva) por cancelación de instalación #%s', coalesce(v_code, inst.id::text));
    perform public.reverse_egreso_movements(inst.id, null, v_reason);
    perform public.reverse_assigned_units_by_installation(inst.id, v_reason);
  end loop;
end
$$;

-- ---- Auditoria manual (solo lectura) para instalaciones/tickets ya
-- ELIMINADOS en el pasado, cuyo installation_id/ticket_id ya es null. Busca
-- egresos sin reversa cuyo "reason" menciona una instalacion/ticket (texto
-- libre que dejaba registerUsage/handleAssignUnit, heuristico — revisar caso
-- por caso antes de registrar un ingreso manual, no correr a ciegas):
--
-- select id, product_id, quantity, reason, created_at
-- from public.inventory_movements
-- where movement_type = 'egreso'
--   and installation_id is null
--   and ticket_id is null
--   and reason ilike 'Instalación%'
--   and not exists (select 1 from public.inventory_movements r where r.reverses_movement_id = inventory_movements.id)
-- order by created_at desc;
