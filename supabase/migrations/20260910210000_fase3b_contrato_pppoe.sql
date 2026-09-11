-- SmartRayco — Vincular un contrato a su usuario PPPoE en MikroTik.
--
-- Permite saber que usuarios PPPoE ya configurados en el router (Fase 5) no
-- tienen todavia un contrato en SmartRayco, y viceversa. Un mismo secreto
-- PPPoE (device + username) solo puede estar vinculado a un contrato.

alter table public.service_contracts
  add column mikrotik_device_id uuid references public.mikrotik_devices (id),
  add column pppoe_username text;

create unique index idx_service_contracts_pppoe_unique
  on public.service_contracts (mikrotik_device_id, pppoe_username)
  where mikrotik_device_id is not null and pppoe_username is not null;
