-- SmartRayco — Fase 11e: fecha de compra en productos de inventario.

alter table public.inventory_products
  add column if not exists purchase_date date;
