-- SmartRayco — Fase 39: el codigo de cliente es por SERVICIO, no por titular.
--
-- Pedido explicito: "el codigo de cliente es unico por contrato no por
-- usuario, el usuario puede tener varios codigos de cliente pero solo 1
-- DNI". clients.client_code (Fase 12) asumia lo contrario (un solo codigo
-- por titular) — mismo patron de bug que zona/NAP/fotos en las Fases 37/38.
--
-- clients.client_code queda en la base como dato heredado (no se borra, no
-- se vuelve a editar desde la app) — el codigo real vive desde ahora en
-- service_contracts.client_code.

alter table public.service_contracts
  add column if not exists client_code text;

comment on column public.service_contracts.client_code is
  'Codigo de cliente de ESTE servicio (uno por linea). clients.client_code queda como dato heredado de la Fase 12, ya no se edita.';

-- Backfill NO ambiguo: solo clientes con un unico contrato en todo su
-- historial — copiar el mismo client_code a 2+ contratos violaria el unique
-- nuevo (abajo) y no hay forma de adivinar cual de las lineas se queda con
-- el codigo original, asi que esos casos quedan en null para que el staff
-- les asigne codigo nuevo a mano desde la ficha de cada servicio.
update public.service_contracts sc
set client_code = c.client_code
from public.clients c
where sc.client_id = c.id
  and sc.client_code is null
  and c.client_code is not null
  and (select count(*) from public.service_contracts sc2 where sc2.client_id = c.id) = 1;

create unique index if not exists idx_service_contracts_client_code_unique
  on public.service_contracts (client_code)
  where client_code is not null;
