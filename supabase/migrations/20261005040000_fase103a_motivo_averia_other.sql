-- SmartRayco — Fase 103a: agrega 'other' al enum ticket_motivo_averia
-- (el tecnico puede escribir una causa libre si ninguna opcion calza).
-- Separado de la Fase 103b por la misma restriccion de Postgres que las
-- Fases 95a/102a: un valor de enum nuevo no se puede usar en la misma
-- transaccion en que se agrego.
alter type public.ticket_motivo_averia add value if not exists 'other';
