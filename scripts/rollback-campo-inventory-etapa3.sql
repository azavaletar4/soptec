-- NO EJECUTADO. Solo tras restaurar consumidores anteriores y conciliar pendientes.
-- Conserva todos los recibos, movimientos y eventos; no restaura saldos.
begin;
revoke execute on function public.campo_inventory_operation(uuid,text,uuid,text,jsonb) from authenticated;
commit;
