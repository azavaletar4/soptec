-- SmartRayco — Fase 28: asocia cada caja NAP (infra_elementos) a una zona de
-- cobertura, para poder ver el llenado de clientes por NAP dentro de la
-- pantalla de Zonas (regla de negocio: max 16 clientes por NAP, max 16 NAPs
-- por zona — ver types/domain.ts NAP_CLIENT_LIMIT / ZONE_NAP_LIMIT).

alter table public.infra_elementos
  add column if not exists zone_id uuid references public.zones (id) on delete set null;

create index if not exists idx_infra_elementos_zone_id on public.infra_elementos (zone_id);
