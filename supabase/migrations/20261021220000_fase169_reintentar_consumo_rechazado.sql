-- CANDIDATO LOCAL, SIN APLICAR. Fase 169: convierte "Consumos pendientes
-- que impiden cerrar órdenes" en una incidencia administrable real.
--
-- CAUSA RAIZ (confirmada en produccion, caso real Jhordanno Zavaleta /
-- Diego Villanueva Bernabe CTR-2026-00727, operation_id
-- 5ac65134-f2bd-410c-848a-9d336180d8ca): desde Fase 166
-- (20261021190000), assert_no_rejected_materials es un no-op -- un
-- rechazo 'pending' YA NO bloquea el cierre de ninguna orden. El titulo
-- del panel ("...que impiden cerrar ordenes") describe un comportamiento
-- que ya no existe -- confirmado en los hechos: la Alta de este caso
-- real se completo (`completed_at` 2026-10-21 21:19:42 UTC) mientras la
-- fila seguia, y sigue, 'pending'. Ademas, la unica accion administrativa
-- disponible hoy es "Anular" -- no hay forma de resolver el intento
-- cuando el tecnico YA recibio la custodia que le faltaba, sin pedirle
-- que vuelva a intentarlo el mismo desde la App (a veces impractico,
-- ej. tecnico ya no esta en el sitio).
--
-- CORRECCION (una funcion nueva, no reemplaza ninguna existente -- el
-- registro del rechazo, su RLS de lectura y la anulacion administrativa
-- siguen exactamente igual):
--
-- retry_rejected_material_operation(operation_id): solo ADMIN/SUPERADMIN,
-- reintenta EXACTAMENTE el mismo intento (mismo producto/cantidad, nunca
-- editable por el administrador -- si la cantidad esta mal, es el
-- tecnico quien debe corregirla desde la App) debitando la custodia del
-- TECNICO ORIGINAL (nunca la del administrador que ejecuta el reintento
-- -- mismo criterio ya usado para la accion 'correct' en Fase 165 etapa
-- 2: el responsable verificable del consumo es quien hizo el intento
-- real, no quien lo gestiona despues). Reusa el MISMO trigger de saldo
-- (apply_technician_material_custody_event, P1650) insertando
-- directamente en technician_material_custody_events -- si la custodia
-- SIGUE sin alcanzar, falla exactamente igual que antes, sin dejar nada
-- a medias (subtransaccion: todo el kit o nada). Solo aplica a
-- consume/kit de Alta/Averia (accion 'kit' no existe para Rutinas) y
-- SOLO si la orden sigue abierta -- una orden ya completada/cancelada no
-- admite nuevas operaciones de inventario, igual que hoy.
begin;

create or replace function public.retry_rejected_material_operation(p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  actor_role text;
  rejection public.material_inventory_rejections;
  item jsonb; items jsonb;
  target_id uuid; quantity numeric;
  product public.inventory_products%rowtype;
  new_id uuid; result_ids jsonb := '[]';
  job_status text;
begin
  if actor is null then raise exception 'Identidad activa requerida' using errcode='42501'; end if;
  select role::text into actor_role from public.profiles where id=actor and active;
  if actor_role is null or actor_role not in ('ADMIN','SUPERADMIN') then
    raise exception 'Solo administracion puede reintentar un intento pendiente' using errcode='42501';
  end if;

  select * into rejection from public.material_inventory_rejections where operation_id=p_operation_id for update;
  if not found then raise exception 'Intento no encontrado' using errcode='22023'; end if;
  if rejection.status <> 'pending' then raise exception 'El intento ya fue resuelto o anulado' using errcode='22023'; end if;
  if rejection.action not in ('consume','kit') then raise exception 'Solo se puede reintentar un consumo o kit de material' using errcode='22023'; end if;
  if rejection.job_type = 'routine' then raise exception 'El reintento administrativo de Rutinas no esta disponible todavia -- pide al tecnico que reintente desde la App' using errcode='22023'; end if;

  perform public.lock_material_inventory_job(rejection.job_type, rejection.job_id);
  if rejection.job_type='installation' then
    select status::text into job_status from public.installations where id=rejection.job_id;
  else
    select status::text into job_status from public.tickets where id=rejection.job_id;
  end if;
  if rejection.job_type='installation' and job_status not in ('pending','scheduled','in_progress') then
    raise exception 'La orden ya no admite nuevas operaciones de inventario (estado: %)', job_status using errcode='42501';
  end if;
  if rejection.job_type='ticket' and job_status not in ('open','in_progress','rescheduled') then
    raise exception 'La orden ya no admite nuevas operaciones de inventario (estado: %)', job_status using errcode='42501';
  end if;

  items := case when rejection.action='kit' then rejection.payload->'items' else jsonb_build_array(rejection.payload) end;
  if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)<1 then
    raise exception 'Intento sin materiales validos para reintentar' using errcode='22023';
  end if;

  begin
    for item in select value from jsonb_array_elements(items) loop
      target_id := (item->>'productId')::uuid;
      quantity := (item->>'quantity')::numeric;
      select * into product from public.inventory_products where id=target_id for update;
      if not found or not product.is_active or product.is_serialized then
        raise exception 'Producto no admite consumo de material' using errcode='22023';
      end if;
      insert into public.inventory_movements(product_id,movement_type,quantity,reason,installation_id,ticket_id,created_by)
      values(target_id,'egreso',quantity,coalesce(nullif(btrim(rejection.payload->>'reason'),''),'Reintento administrativo de intento pendiente'),
        case when rejection.job_type='installation' then rejection.job_id end,
        case when rejection.job_type='ticket' then rejection.job_id end, actor)
      returning id into new_id;
      result_ids := result_ids || jsonb_build_array(new_id);
      -- Debita la custodia del TECNICO ORIGINAL del intento -- nunca la
      -- del administrador que ejecuta este reintento (mismo criterio que
      -- la accion 'correct', Fase 165 etapa 2).
      insert into public.technician_material_custody_events(technician_id,product_id,event_type,quantity,reason,created_by,source_movement_id)
      values(rejection.actor_id, target_id, 'consumption', quantity,
        coalesce(nullif(btrim(rejection.payload->>'reason'),''),'Reintento administrativo de intento pendiente'), actor, new_id);
    end loop;
  exception when sqlstate 'P1650' then
    -- Subtransaccion: descarta CUALQUIER movimiento/evento ya insertado en
    -- este mismo reintento (nunca deja un kit a medias) y propaga el
    -- mismo mensaje real de saldo insuficiente, sin inventar uno nuevo.
    raise;
  end;

  update public.material_inventory_rejections
  set status='resolved', resolved_at=clock_timestamp(), resolved_by=actor,
    resolution_note=coalesce(resolution_note,'Reintentado por administracion -- custodia ya suficiente, mismo producto/cantidad del intento original')
  where operation_id=p_operation_id;

  return jsonb_build_object('operationId',p_operation_id,'ids',result_ids,'at',now());
end;
$$;
revoke all on function public.retry_rejected_material_operation(uuid) from public,anon;
grant execute on function public.retry_rejected_material_operation(uuid) to authenticated;
commit;
