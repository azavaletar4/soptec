-- SmartRayco — Corrige invoices.client_id/contract_id sin "on delete cascade"
-- (inconsistente con tickets/service_contracts, que si cascadean al borrar
-- un cliente). Bug real: borrar un cliente con facturas fallaba con
-- "violates foreign key constraint invoices_client_id_fkey".

alter table public.invoices drop constraint invoices_client_id_fkey;
alter table public.invoices
  add constraint invoices_client_id_fkey
  foreign key (client_id) references public.clients (id) on delete cascade;

alter table public.invoices drop constraint invoices_contract_id_fkey;
alter table public.invoices
  add constraint invoices_contract_id_fkey
  foreign key (contract_id) references public.service_contracts (id) on delete cascade;
