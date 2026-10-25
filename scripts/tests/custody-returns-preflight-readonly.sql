-- PREPARADO; utilizar antes/despues solo tras autorizacion de acceso.
-- Cualquier incidencia requiere revision; no corregir registros automaticamente.
begin isolation level repeatable read read only;
-- Las RPC se probaron con READ COMMITTED; esta consulta es un snapshot de solo lectura.
select current_setting('default_transaction_isolation') as rpc_default_isolation;
select rolname, rolconfig from pg_roles where rolname in ('authenticator','authenticated');
select setdatabase,setrole,setconfig from pg_db_role_setting;
select oid::regprocedure as signature, pg_get_functiondef(oid) as definition,
       pg_get_userbyid(proowner) as owner, proacl, proconfig, prosecdef
from pg_proc where oid in (
  'public.request_material_return(uuid,numeric,text)'::regprocedure,
  'public.my_inventory_custody()'::regprocedure,
  'public.confirm_material_return(uuid,boolean,text)'::regprocedure,
  'public.receive_unit_return(uuid,text,text)'::regprocedure,
  'public.apply_technician_material_custody_event()'::regprocedure);
select technician_id, product_id, count(*) as pending_count, sum(quantity) as pending_quantity
from public.technician_material_return_requests where status='pending'
group by technician_id,product_id having count(*)>1;
select r.technician_id,r.product_id,sum(r.quantity) as pending_quantity,coalesce(c.quantity,0) as custody
from public.technician_material_return_requests r
left join public.technician_material_custody c using(technician_id,product_id)
where r.status='pending' group by r.technician_id,r.product_id,c.quantity
having sum(r.quantity)>coalesce(c.quantity,0);
select * from public.technician_material_custody where quantity<0;
select p.id,p.current_stock,coalesce(sum(c.quantity),0) as custody
from public.inventory_products p left join public.technician_material_custody c on c.product_id=p.id
where not p.is_serialized group by p.id,p.current_stock
having p.current_stock<coalesce(sum(c.quantity),0);
commit;
