-- Fase 12: codigo de cliente
-- - client_code en clients: codigo unico que identifica al cliente, se
--   asigna manualmente (no autogenerado, a diferencia de contract_number).

alter table public.clients add column client_code text;

create unique index idx_clients_client_code_unique
  on public.clients (client_code)
  where client_code is not null;
