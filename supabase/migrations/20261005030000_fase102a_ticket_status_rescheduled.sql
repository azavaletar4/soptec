-- SmartRayco — Fase 102a: agrega 'rescheduled' al enum ticket_status
-- (cliente ausente / re-agendamiento prioritario). Separado de la Fase 102b
-- porque Postgres no permite usar un valor de enum nuevo dentro de la misma
-- transaccion en que se agrego (mismo motivo que la Fase 95a).
alter type public.ticket_status add value if not exists 'rescheduled';
