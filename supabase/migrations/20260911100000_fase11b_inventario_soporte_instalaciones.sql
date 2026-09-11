-- SmartRayco — Fase 11b: vincula el Kardex de inventario con Soporte
-- (tickets) e Instalaciones. Permite registrar "materiales usados" en un
-- ticket o instalacion, generando un egreso real en inventory_movements
-- (el trigger de la Fase 11, apply_inventory_movement, ya se encarga de
-- descontar current_stock y calcular el saldo acumulado — no se duplica
-- esa logica aqui, solo se agrega la trazabilidad de origen).

alter table public.inventory_movements
  add column if not exists ticket_id uuid references public.tickets (id) on delete set null,
  add column if not exists installation_id uuid references public.installations (id) on delete set null;

create index if not exists idx_inventory_movements_ticket on public.inventory_movements (ticket_id) where ticket_id is not null;
create index if not exists idx_inventory_movements_installation on public.inventory_movements (installation_id) where installation_id is not null;
