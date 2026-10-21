-- Revierte 20261021200000... no, revierte
-- 20261021220000_fase169_reintentar_consumo_rechazado.sql.
-- La funcion es nueva (no reemplaza ninguna existente) -- revertir es
-- simplemente eliminarla. No toca material_inventory_rejections,
-- inventory_movements ni technician_material_custody_events -- ninguna
-- fila de datos se pierde al revertir (las ya resueltas por un reintento
-- administrativo quedan exactamente igual, auditable, insert-only).
begin;
drop function if exists public.retry_rejected_material_operation(uuid);
commit;
