-- CANDIDATO LOCAL, SIN APLICAR. Fase 165, etapa 2 (cierre): corrige 2
-- riesgos reales del flujo administrativo de entrega de materiales
-- (deliver_material_to_technician), probados y confirmados por clic real
-- en el laboratorio aislado el 2026-10-20:
--
-- 1. La entrega NUNCA validaba contra el stock de almacen
--    (inventory_products.current_stock) -- se podia entregar cualquier
--    cantidad, aunque superara por mucho lo que el sistema dice que hay.
--    Limitar solo el formulario no alcanza (un admin con otra pestaña, otro
--    dispositivo, o un reintento de red podria seguir sobre-entregando) --
--    la validacion debe vivir en el servidor, dentro de la misma
--    transaccion que registra la entrega, bloqueando tambien entregas
--    concurrentes del mismo producto a distintos tecnicos.
-- 2. No existia forma de distinguir un reintento real de la MISMA entrega
--    (red inestable, doble envio accidental) de una segunda entrega
--    legitima -- cualquiera de las dos generaba un evento nuevo. Se agrega
--    una clave de operacion (mismo patron ya usado por
--    campo_inventory_operation/routine_inventory_operation desde Fase 162):
--    reintentar con el MISMO operation_id y los MISMOS datos no duplica;
--    una entrega con datos distintos, o con un operation_id distinto,
--    siempre se registra aparte.
--
-- Guarda MD5: aborta solo si la version real en produccion de
-- deliver_material_to_technician(uuid,uuid,numeric,text) difirio de la
-- revisada (confirmado 2026-10-20, sin drift respecto al candidato).
begin;
do $$ begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.deliver_material_to_technician(uuid,uuid,numeric,text)')
  and md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^' || chr(10) || ']*','','g'),'[[:space:]]','','g'))='944cdb4593efcc44f8ebac960663548a') then
  raise exception 'deliver_material_to_technician(uuid,uuid,numeric,text) difiere de la version revisada; detener y comparar';
 end if;
end $$;

-- Ledger de operaciones de entrega -- mismo rol que campo_inventory_operations
-- para el consumo de campo: permite reconocer un reintento exacto (mismos
-- datos, mismo operation_id) sin volver a aplicar el evento de Kardex.
create table public.material_delivery_operations (
  operation_id uuid primary key,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  product_id uuid not null references public.inventory_products(id) on delete restrict,
  quantity numeric not null,
  reason text,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.material_delivery_operations enable row level security;
revoke all on public.material_delivery_operations from public, anon, authenticated;
grant select on public.material_delivery_operations to authenticated;
create policy material_delivery_operations_select on public.material_delivery_operations
  for select to authenticated
  using (public.current_user_role() in ('SUPERADMIN', 'ADMIN'));

-- La version anterior (sin operation_id, sin validar stock) se retira --
-- el frontend se despliega ANTES de esta migracion con la nueva firma (ver
-- docs/FASE165-ETAPA2-PROCEDIMIENTO-ACTIVACION.md), asi que para el momento
-- en que esto se aplique ya nadie llama a la version de 4 argumentos.
drop function public.deliver_material_to_technician(uuid, uuid, numeric, text);

create function public.deliver_material_to_technician(
  p_operation_id uuid, p_technician_id uuid, p_product_id uuid, p_quantity numeric, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare p public.inventory_products; existing public.material_delivery_operations; outstanding numeric;
begin
  if public.current_user_role() not in ('SUPERADMIN', 'ADMIN') then
    raise exception 'Solo administracion puede entregar material a un tecnico';
  end if;
  if p_operation_id is null then raise exception 'Falta el identificador de la operacion'; end if;

  select * into existing from public.material_delivery_operations where operation_id = p_operation_id for update;
  if found then
    if existing.technician_id is distinct from p_technician_id or existing.product_id is distinct from p_product_id
     or existing.quantity is distinct from p_quantity or existing.actor_id is distinct from auth.uid() then
      raise exception 'Identificador de operacion ya utilizado con datos distintos';
    end if;
    return; -- reintento real de la MISMA entrega: ya se aplico, no se repite
  end if;

  if not exists(select 1 from public.profiles where id = p_technician_id and active and role = 'TECNICO_RED') then
    raise exception 'El destinatario debe ser un tecnico de red activo';
  end if;
  -- Bloquea el producto -- serializa tambien entregas CONCURRENTES del
  -- mismo producto a tecnicos distintos, para que la validacion de stock de
  -- mas abajo sea real y no una lectura obsoleta (antes era 'for share').
  select * into p from public.inventory_products where id = p_product_id for update;
  if not found or not p.is_active or p.is_serialized then
    raise exception 'Producto consumible activo requerido';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity, 2) then
    raise exception 'Cantidad positiva con hasta dos decimales requerida';
  end if;

  -- El almacen central NO baja al entregar (solo al consumirse en una orden
  -- real) -- por eso la entrega se valida contra lo que YA esta repartido
  -- entre todos los tecnicos (suma de custodia vigente), no contra un
  -- descuento directo del stock.
  select coalesce(sum(quantity), 0) into outstanding
    from public.technician_material_custody where product_id = p_product_id;
  if outstanding + p_quantity > p.current_stock then
    raise exception 'La entrega supera el stock de almacén disponible (almacén: %, ya entregado a técnicos: %, intentas entregar %)',
      p.current_stock, outstanding, p_quantity using errcode = 'P1652';
  end if;

  insert into public.material_delivery_operations(operation_id, technician_id, product_id, quantity, reason, actor_id)
  values (p_operation_id, p_technician_id, p_product_id, p_quantity, p_reason, auth.uid());
  insert into public.technician_material_custody_events(technician_id, product_id, event_type, quantity, reason)
  values (p_technician_id, p_product_id, 'delivery', p_quantity, coalesce(nullif(btrim(p_reason), ''), 'Entrega a tecnico'));
end $$;
revoke all on function public.deliver_material_to_technician(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.deliver_material_to_technician(uuid, uuid, uuid, numeric, text) to authenticated;
commit;
