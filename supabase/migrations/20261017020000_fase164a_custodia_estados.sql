-- Fase 164a: propuesta LOCAL. No aplicar sin autorizacion explicita.
-- Nuevos valores de inventory_unit_status para custodia de tecnicos
-- (equipo serializado entregado a un tecnico, aun no instalado en un
-- cliente). Separado del resto de Fase 164 porque Postgres no permite
-- usar un valor de enum nuevo dentro de la misma transaccion en que se
-- agrego (mismo motivo que Fase 51/95a).
alter type public.inventory_unit_status add value if not exists 'with_technician';
alter type public.inventory_unit_status add value if not exists 'pending_return';
