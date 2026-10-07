-- SmartRayco — Fase 129: Rutinas comerciales/logisticas ademas de las de
-- Planta Interna (Fase 101). Hasta ahora `category` (peinado_nap/
-- mantenimiento_preventivo/revision_zona/otro) solo cubria trabajo de
-- infraestructura; esto agrega una capa de clasificacion mas amplia
-- (tipo_rutina) + un subtipo especifico dentro de cada grupo, sin tocar
-- `category` (se deja como esta, default 'otro' sigue satisfaciendo el NOT
-- NULL — ya no se expone en el modal de creacion, Fase 101 la sigue usando
-- solo para datos historicos).
--
-- `direccion_destino` cubre el caso sin cliente ni zona/NAP puntual (ej.
-- "Agencia de Transportes Flores", recojos/cobranzas que no son de un
-- cliente de la red). `adicionales_json` guarda que equipos debe llevar el
-- tecnico de su stock cuando la rutina es una visita a un cliente existente
-- (TV Box / Repetidor Mesh) — Fase V1 no descuenta stock automaticamente,
-- solo informa al tecnico (igual alcance que Fase 101: sin materiales
-- todavia en el flujo de rutinas).

create type public.routine_tipo as enum ('servicio_cliente', 'logistica', 'planta_interna');

alter table public.routines
  add column tipo_rutina public.routine_tipo not null default 'planta_interna',
  add column subtipo text,
  add column direccion_destino text,
  add column adicionales_json jsonb not null default '{}'::jsonb;

-- Backfill: las rutinas existentes (todas de infraestructura hasta hoy)
-- quedan en planta_interna con su `category` de siempre como subtipo.
update public.routines set subtipo = category::text where subtipo is null;
