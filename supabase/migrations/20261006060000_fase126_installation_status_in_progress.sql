-- SmartRayco — Fase 126: agrega 'in_progress' al enum installation_status.
-- Hasta ahora una Alta solo tenia pending/scheduled/completed/cancelled — no
-- existia un estado intermedio "el tecnico ya esta en la casa atendiendola",
-- a diferencia de un ticket (open -> in_progress -> resolved). Esto habilita
-- el mismo boton "Iniciar Orden" de la App de Campo (Fase 124) tambien para
-- Altas. Migracion separada (no se usa el valor nuevo aqui) porque Postgres
-- no permite usar un valor de enum dentro de la misma transaccion en que se
-- agrego (mismo motivo que la Fase 102a/95a).
alter type public.installation_status add value if not exists 'in_progress';
