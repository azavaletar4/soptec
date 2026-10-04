-- SmartRayco — Fase 95a: agrega los valores de enum nuevos que necesita el
-- censo fotografico + aprobacion de equipos de una averia (Fase 95b/95c).
-- Separado porque Postgres no permite usar un valor de enum nuevo dentro de
-- la misma transaccion en la que se agrego. Las dos lineas de abajo tocan
-- enums DISTINTOS (inventory_unit_status / client_photo_category), asi que
-- pueden ir juntas en esta misma migracion sin problema — ninguna se usa
-- todavia en esta transaccion.
alter type public.inventory_unit_status add value if not exists 'pending_approval';

-- Foto del sticker de serie/MAC del equipo (Fase 95c) — censo fotografico
-- completo de la ficha del cliente, igual que facade/modem_position/nap_box/
-- pon_power (Fase 3c/12b/32).
alter type public.client_photo_category add value if not exists 'equipment_sticker';
