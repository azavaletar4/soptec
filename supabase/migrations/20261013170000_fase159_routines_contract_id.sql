-- Fase 159 (Fase 3 OLT — Fase C, "Traslado de servicio" en Rutinas).
--
-- Hallazgo confirmado por SQL de solo lectura contra produccion
-- (information_schema.columns): la tabla routines NO tiene ninguna
-- columna que identifique un contrato/servicio especifico. Una rutina de
-- "Traslado de servicio" necesita saber EXACTAMENTE cual de los
-- servicios del cliente se traslada — un cliente puede tener mas de un
-- servicio (Fase 37, service_contracts), y sin este dato la sincronizacion
-- de zona/NAP/ONT de Fase 158 no tiene como elegir el contrato correcto
-- (nunca se debe inferir por client_id solo, ver ESTADO_DESARROLLO.md
-- 13am/13an y CLAUDE.md, migracion OLT, regla permanente 10).
--
-- Columna NULLABLE: ninguna rutina existente se ve afectada, ningun otro
-- subtipo la usa. Mismo patron FK ya usado para esta misma necesidad en
-- olt_onts/inventory_units/descuentos_compensacion (Fase 37,
-- 20260930040000_fase37_servicios_independientes.sql).
--
-- NO APLICADA TODAVIA — requiere autorizacion explicita del usuario antes
-- de correr contra Supabase de produccion (CLAUDE.md, regla 16).

alter table public.routines
  add column if not exists contract_id uuid references public.service_contracts (id) on delete set null;

create index if not exists idx_routines_contract on public.routines (contract_id) where contract_id is not null;

comment on column public.routines.contract_id is
  'Fase 159: contrato/servicio especifico que se traslada (subtipo = traslado_servicio, tipo_rutina = servicio_cliente). Null en el resto de rutinas — no afecta subtipos existentes.';
