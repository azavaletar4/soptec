-- Fase 27a: agrega la categoria de ticket "Reconexion / Traslado" (no
-- existia ninguna). Separada en su propio archivo porque Postgres no deja
-- usar un valor de enum nuevo en la misma transaccion en que se agrega
-- (error 55P04) — la funcion de ranking que lo usa va en la Fase 27b,
-- despues de que esto quede confirmado.

alter type public.ticket_category add value if not exists 'reconnection_relocation';
