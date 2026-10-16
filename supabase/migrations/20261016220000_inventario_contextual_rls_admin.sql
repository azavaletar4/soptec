-- LOCAL: cierre administrativo. Aplicar solo tras validar todos los consumidores.
-- No aplicar en Cloud con la autorizacion de instalacion Fase 162 ya finalizada.
begin;

create function public.inventory_order_read(
 p_job_type text,p_job_id uuid,p_view text,p_page integer default 0,
 p_product_id uuid default null,p_unit_id uuid default null,p_action text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare
 actor uuid:=auth.uid(); staff text; job_status text; client uuid; contract uuid;
 job_column text; rows jsonb:='[]'; context jsonb; warning text; offset_rows integer;
begin
 if actor is null or p_job_id is null or p_job_type is null
 or p_job_type not in ('installation','ticket','routine')
 or p_view is null or p_view not in ('products','materials','assigned','pending','available','unit-context','linked','events','contracts')
 or p_page is null or p_page<0 or p_page>10000 then
  raise exception 'Consulta de inventario invalida' using errcode='22023';
 end if;
 select role::text into staff from public.profiles where id=actor and active for share nowait;
 if staff is null or staff not in ('ADMIN','SUPERADMIN','TECNICO_RED','SOPORTE')
 or (staff='SOPORTE' and p_job_type='installation') then
  raise exception 'Acceso no autorizado a esta orden' using errcode='42501';
 end if;
 if p_job_type='installation' then
  select status::text,client_id,contract_id into job_status,client,contract
   from public.installations where id=p_job_id for share nowait;
  job_column:='installation_id';
 elsif p_job_type='ticket' then
  select status::text,client_id,contract_id into job_status,client,contract
   from public.tickets where id=p_job_id for share nowait;
  job_column:='ticket_id';
 else
  select status::text,client_id,contract_id into job_status,client,contract
   from public.routines where id=p_job_id for share nowait;
  job_column:='routine_id';
 end if;
 if not found then raise exception 'Orden no autorizada' using errcode='42501'; end if;
 if staff='TECNICO_RED' then
  perform 1 from public.job_assignees where job_type=p_job_type and job_id=p_job_id
   and technician_id=actor and role in ('leader','support') for share nowait;
  if not found then raise exception 'Asignacion no vigente' using errcode='42501'; end if;
  if not (case p_job_type
    when 'installation' then job_status in ('pending','scheduled','in_progress')
    when 'ticket' then job_status in ('open','in_progress','rescheduled')
    else job_status in ('pending','scheduled','in_progress') end)
   and not (p_view in ('materials','assigned','pending','linked','events') and
    case when p_job_type='ticket' then job_status in ('resolved','closed') else job_status='completed' end) then
   raise exception 'Estado de orden no autorizado' using errcode='42501';
  end if;
 end if;
 -- Oficina solo revisa lo registrado, nunca obtiene el catalogo/stock general.
 if staff='SOPORTE' and p_view not in ('materials','pending','assigned','linked','events') then
  raise exception 'Consulta exclusiva de la operacion de Campo' using errcode='42501';
 end if;
 if contract is not null then
  perform 1 from public.service_contracts where id=contract and client_id=client for share nowait;
  if not found then raise exception 'Contrato no corresponde a la orden' using errcode='42501'; end if;
 end if;
 if p_view in ('linked','events','contracts') and p_job_type<>'routine' then
  raise exception 'Consulta no valida para esta orden' using errcode='22023';
 end if;
 context:=jsonb_build_object('jobType',p_job_type,'jobId',p_job_id,'actorId',actor,'clientId',client,'contractId',contract);
 offset_rows:=p_page*100;
 if p_view='products' then
  select coalesce(jsonb_agg(x.dto),'[]') into rows from (
   select jsonb_build_object('id',p.id,'name',p.name,'unit',p.unit,'is_active',p.is_active,
    'is_serialized',p.is_serialized,'current_stock',p.current_stock,
    'inventory_categories',case when c.id is null then null else jsonb_build_object('slug',c.slug) end) dto
   from public.inventory_products p left join public.inventory_categories c on c.id=p.category_id
   where p.is_active order by p.id limit 101 offset offset_rows
  )x;
 elsif p_view='materials' then
  execute format($q$select coalesce(jsonb_agg(x.dto),'[]') from (
   select jsonb_build_object('id',m.id,'product_id',m.product_id,'movement_type',m.movement_type,
    'quantity',m.quantity,'reason',m.reason,'ticket_id',m.ticket_id,'installation_id',m.installation_id,
    'routine_id',m.routine_id,'created_at',m.created_at,'reverses_movement_id',m.reverses_movement_id,
    'product',jsonb_build_object('id',p.id,'name',p.name,'unit',p.unit)) dto
   from public.inventory_movements m join public.inventory_products p on p.id=m.product_id
   where m.%I=$1 order by m.created_at,m.id limit 101 offset $2)x$q$,job_column)
   into rows using p_job_id,offset_rows;
 elsif p_view='contracts' then
  select coalesce(jsonb_agg(x.dto),'[]') into rows from (
   select jsonb_build_object('id',c.id,'contract_number',c.contract_number) dto
   from public.service_contracts c where c.client_id=client and (contract is null or c.id=contract)
   order by c.id limit 101 offset offset_rows)x;
 elsif p_view='events' then
  select coalesce(jsonb_agg(x.dto),'[]') into rows from (
   select jsonb_build_object('id',e.id,'from_status',e.from_status,'to_status',e.to_status,
    'reason',e.reason,'created_at',e.created_at,
    'unit',jsonb_build_object('serial_number',u.serial_number,'mac_address',u.mac_address)) dto
   from public.inventory_unit_events e join public.inventory_units u on u.id=e.unit_id
   where e.routine_id=p_job_id order by e.created_at,e.id limit 101 offset offset_rows)x;
 else
  if p_view='available' and p_product_id is null then
   raise exception 'Selecciona un producto' using errcode='22023';
  end if;
  if p_view='unit-context' and (p_unit_id is null or p_action is null or p_action not in ('unassign','unlink')
    or (p_action='unassign') is distinct from (p_job_type='installation')) then
   raise exception 'La operacion no corresponde a esta orden' using errcode='22023';
  end if;
  execute format($q$select coalesce(jsonb_agg(x.dto),'[]') from (
   select (jsonb_build_object('id',u.id,'product_id',u.product_id,'serial_number',u.serial_number,
    'mac_address',u.mac_address,'status',u.status,'client_id',u.client_id,'contract_id',u.contract_id,
    'installation_id',u.installation_id,'ticket_id',u.ticket_id,'routine_id',u.routine_id,
    'product',jsonb_build_object('id',p.id,'name',p.name,'unit',p.unit,
     'inventory_categories',case when c.id is null then null else jsonb_build_object('slug',c.slug) end))
    -- notas administrativas: la clave no se incluye para tecnico/oficina, no solo el valor en null.
    || case when $9 in ('ADMIN','SUPERADMIN') then jsonb_build_object('notes',u.notes) else '{}'::jsonb end) dto
   from public.inventory_units u join public.inventory_products p on p.id=u.product_id
    left join public.inventory_categories c on c.id=p.category_id
   where case
    when $1='available' then p.is_active and p.is_serialized and u.product_id=$2 and u.status='in_stock'
     and u.client_id is null and u.contract_id is null and u.installation_id is null and u.ticket_id is null and u.routine_id is null
    when $1='unit-context' then u.id=$3 and u.%I=$4 and u.client_id is not distinct from $5
     and (u.contract_id is null or u.contract_id=$6)
     and u.status=case when $7='unassign' then 'assigned' else 'pending_approval' end::public.inventory_unit_status
    when $1='linked' then u.routine_id=$4 and u.client_id is not distinct from $5 and (u.contract_id is null or $6 is null or u.contract_id=$6)
    when $1='pending' or $8='installation' or $9='SOPORTE' then
     u.%I=$4 and u.client_id is not distinct from $5 and (u.contract_id is null or u.contract_id=$6)
     and ($1<>'pending' or u.status='pending_approval')
    when $6 is not null then u.client_id=$5 and u.contract_id=$6 and u.status='assigned'
    when $8='routine' then u.client_id=$5 and u.status='assigned' and
     (exists(select 1 from public.service_contracts c where c.id=u.contract_id and c.client_id=$5) or u.routine_id=$4)
    else u.%I=$4 and u.client_id is not distinct from $5 and u.contract_id is null and u.status='assigned'
   end order by u.id limit 101 offset $10)x$q$,job_column,job_column,job_column)
   into rows using p_view,p_product_id,p_unit_id,p_job_id,client,contract,p_action,p_job_type,staff,offset_rows;
  if p_view='unit-context' and jsonb_array_length(rows)=0 then
   raise exception 'El equipo no corresponde a esta orden' using errcode='42501';
  end if;
  if p_view='assigned' and p_job_type='ticket' and contract is null then
   warning:='Esta orden no tiene contrato vinculado. Solo se muestran equipos vinculados directamente a ella; solicita revision de los equipos historicos.';
  end if;
 end if;
 return jsonb_build_object('context',context,'items',case when jsonb_array_length(rows)>100 then rows-100 else rows end,
  'next',case when jsonb_array_length(rows)>100 then p_page+1 else null end)
  ||case when warning is null then '{}'::jsonb else jsonb_build_object('warning',warning) end;
end $$;
revoke all on function public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text) to authenticated;

-- Oficina: reusar eventos/triggers y recibos privados; no acceso general a tablas.
create function public.inventory_ticket_review(p_operation_id uuid,p_job_type text,p_job_id uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor uuid:=auth.uid(); staff text; t public.tickets; u public.inventory_units;
 receipt public.campo_inventory_operations; event_id uuid; v_result jsonb;
begin
 if actor is null or p_operation_id is null or p_job_id is null or p_job_type is distinct from 'ticket'
  or p_action is null or p_action not in ('approve','reject') or p_payload is null or jsonb_typeof(p_payload)<>'object'
  or not(p_payload ? 'unitId') or p_payload-'unitId'<>'{}'::jsonb then
  raise exception 'Solicitud de revision invalida' using errcode='22023';
 end if;
 select role::text into staff from public.profiles where id=actor and active for share nowait;
 if staff is null or staff not in ('ADMIN','SUPERADMIN','SOPORTE') then
  raise exception 'Revision exclusiva de oficina' using errcode='42501';
 end if;
 select * into t from public.tickets where id=p_job_id for update;
 if not found then raise exception 'Averia no autorizada' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into receipt from public.campo_inventory_operations where id=p_operation_id;
 if found then
  if receipt.actor_id<>actor or receipt.job_type<>'ticket' or receipt.job_id<>p_job_id
   or receipt.action<>('office_'||p_action) or receipt.payload<>p_payload
   or receipt.client_id is distinct from t.client_id or receipt.contract_id is distinct from t.contract_id then
   raise exception 'Recibo no corresponde a esta solicitud' using errcode='42501';
  end if;
  return receipt.result;
 end if;
 select * into u from public.inventory_units where id=(p_payload->>'unitId')::uuid for update;
 if not found or u.status<>'pending_approval' or u.ticket_id is distinct from t.id
  or u.client_id is null or u.client_id is distinct from t.client_id
  or (u.contract_id is not null and u.contract_id is distinct from t.contract_id) then
  raise exception 'Equipo no pendiente de esta averia' using errcode='42501';
 end if;
 insert into public.campo_inventory_operations(id,actor_id,job_type,job_id,client_id,contract_id,action,payload)
 values(p_operation_id,actor,'ticket',t.id,t.client_id,t.contract_id,'office_'||p_action,p_payload);
 if p_action='approve' then
  insert into public.inventory_unit_events(unit_id,to_status,client_id,contract_id,installation_id,ticket_id,reason)
   values(u.id,'assigned',u.client_id,u.contract_id,u.installation_id,u.ticket_id,'Aprobado por administracion') returning id into event_id;
 else
  insert into public.inventory_unit_events(unit_id,to_status,reason)
   values(u.id,'in_stock','Rechazado por administracion al revisar la averia') returning id into event_id;
 end if;
 v_result:=jsonb_build_object('operationId',p_operation_id,'jobType','ticket','jobId',t.id,'action',p_action,'ids',jsonb_build_array(event_id),'at',clock_timestamp());
 update public.campo_inventory_operations set result=v_result where id=p_operation_id;
 return v_result;
end $$;
revoke all on function public.inventory_ticket_review(uuid,text,uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.inventory_ticket_review(uuid,text,uuid,text,jsonb) to authenticated;

create or replace function public.inventory_get_albums()
returns table(album_slug text,album_name text,icon text,color text,sort_order integer,item_count bigint,low_stock bigint,total_value numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
#variable_conflict use_column
begin
 if public.current_user_role() is null or public.current_user_role() not in ('ADMIN','SUPERADMIN') then
  raise exception 'Inventario administrativo exclusivo de ADMIN y SUPERADMIN' using errcode='42501';
 end if;
 return query select a.album_slug,a.album_name,a.icon,a.color,a.sort_order,a.item_count::bigint,a.low_stock::bigint,a.total_value::numeric from (select
    c.slug,
    c.name,
    c.icon,
    c.color,
    c.sort_order,
    coalesce(count(distinct p.id) filter (where p.id is not null and not p.is_serialized), 0)
      + coalesce(sum(u_counts.in_stock_count) filter (where p.is_serialized), 0) as item_count,
    coalesce(count(*) filter (where not p.is_serialized and p.current_stock <= p.min_stock), 0) as low_stock,
    coalesce(sum(case when p.is_serialized
      then u_counts.in_stock_count * p.price
      else p.current_stock * p.price end), 0) as total_value
  from public.inventory_categories c
  left join public.inventory_products p on p.category_id = c.id and p.is_active
  left join lateral (
    select count(*) as in_stock_count
    from public.inventory_units iu
    where iu.product_id = p.id and iu.status = 'in_stock'
  ) u_counts on p.is_serialized
  where c.is_active
  group by c.slug, c.name, c.icon, c.color, c.sort_order

  union all

  -- Álbum virtual "Equipos por Recoger": recojo pendiente por baja de
  -- servicio/falta de pago/migracion (Fase 51), aun no se sabe en que estado
  -- llega. A proposito no es una fila de inventory_categories (Fase 44).
  select
    'por_recoger',
    'Equipos por Recoger',
    '🔄',
    'rose',
    98,
    count(*),
    0::bigint,
    coalesce(sum(p.price), 0)
  from public.inventory_units iu
  join public.inventory_products p on p.id = iu.product_id
  where iu.status = 'en_recupero'

  union all

  -- Álbum virtual "Averiados / En Reparación": equipo que fallo estando con
  -- el cliente, ya recibido en bodega para reparar, o dado de baja.
  select
    'averiados',
    'Averiados / En Reparación',
    '🛠️',
    'amber',
    99,
    count(*),
    0::bigint,
    coalesce(sum(p.price), 0)
  from public.inventory_units iu
  join public.inventory_products p on p.id = iu.product_id
  where iu.status in ('damaged', 'in_repair', 'retired')

  order by sort_order) a(album_slug,album_name,icon,color,sort_order,item_count,low_stock,total_value);
end $$;
revoke all on function public.inventory_get_albums() from public,anon,service_role;
grant execute on function public.inventory_get_albums() to authenticated;
do $$
declare relation text; policy_name text;
begin
 foreach relation in array array['inventory_products','inventory_categories','inventory_units','inventory_movements','inventory_unit_events'] loop
  for policy_name in select policyname from pg_policies where schemaname='public' and tablename=relation loop
   execute format('drop policy %I on public.%I',policy_name,relation);
  end loop;
  execute format('alter table public.%I enable row level security',relation);
  execute format('create policy inventory_admin_only on public.%I for all to authenticated using (public.current_user_role() in (''ADMIN'',''SUPERADMIN'')) with check (public.current_user_role() in (''ADMIN'',''SUPERADMIN''))',relation);
 end loop;
end $$;
commit;
