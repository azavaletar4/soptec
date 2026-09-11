-- SmartRayco — Puntaje de desempeño por ticket.
--
-- Puntos que se le asignan a un ticket junto con el tecnico designado
-- (asignado_to ya existe desde la Fase 6), para poder sumar despues cuanto
-- puntaje acumula cada tecnico. Nullable: un ticket puede no tener puntaje
-- todavia (por ejemplo, recien creado y sin asignar).

alter table public.tickets add column points integer;
