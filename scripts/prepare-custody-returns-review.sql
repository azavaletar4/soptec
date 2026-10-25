-- CANDIDATO PARA REVISION. NO APLICADO. Requiere autorizacion de base de datos.
-- Conserva firmas, permisos y tablas existentes; bloqueo por saldo serializa solicitudes del mismo material.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function public.request_material_return(p_product_id uuid, p_quantity numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare current_qty numeric; req_id uuid;
begin
  if public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Solo el tecnico puede solicitar la devolucion de su propio material';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Escribe el motivo de la devolucion';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Cantidad positiva requerida';
  end if;
  select quantity into current_qty from public.technician_material_custody
    where technician_id = auth.uid() and product_id = p_product_id for update;
  if coalesce(current_qty, 0) < p_quantity then
    raise exception 'No tienes esa cantidad en custodia (tienes %)', coalesce(current_qty, 0);
  end if;
  if exists (select 1 from public.technician_material_return_requests
    where technician_id = auth.uid() and product_id = p_product_id and status = 'pending') then
    raise exception 'Ya tienes una solicitud pendiente para este material';
  end if;
  insert into public.technician_material_return_requests(technician_id, product_id, quantity, reason)
  values (auth.uid(), p_product_id, p_quantity, btrim(p_reason))
  returning id into req_id;
  return req_id;
end $$;
create or replace function public.my_inventory_custody()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); units jsonb; materials jsonb; requests jsonb;
begin
  if uid is null or public.current_user_role() is distinct from 'TECNICO_RED' then
    raise exception 'Exclusivo del propio tecnico';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'serial_number', u.serial_number, 'mac_address', u.mac_address,
    'status', u.status, 'product', jsonb_build_object('id', p.id, 'name', p.name)
  ) order by u.updated_at desc), '[]') into units
  from public.inventory_units u join public.inventory_products p on p.id = u.product_id
  where u.custody_technician_id = uid and u.status in ('with_technician', 'pending_return');
  select coalesce(jsonb_agg(jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit), 'quantity', c.quantity
  ) order by p.name), '[]') into materials
  from public.technician_material_custody c join public.inventory_products p on p.id = c.product_id
  where c.technician_id = uid and c.quantity > 0;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'product', jsonb_build_object('id', p.id, 'name', p.name), 'quantity', r.quantity,
    'status', r.status, 'requested_at', r.requested_at
  ) order by r.requested_at desc), '[]') into requests
  from public.technician_material_return_requests r join public.inventory_products p on p.id = r.product_id
  where r.technician_id = uid;
  return jsonb_build_object('units', units, 'materials', materials, 'pendingReturnRequests', requests);
end $$;
commit;
