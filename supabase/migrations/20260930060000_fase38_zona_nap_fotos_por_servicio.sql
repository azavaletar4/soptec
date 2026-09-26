-- SmartRayco — Fase 38: zona, caja NAP y fotos de instalacion pasan a ser
-- por SERVICIO, no por cliente (continua la Fase 37 — ver ese archivo para
-- el mismo patron: columnas nullable + backfill no ambiguo + auditoria para
-- los casos que el staff debe revisar a mano).
--
-- Antes: clients.zone_id (Fase 2), fo_nap_puertos.client_id (Fase 8) y
-- client_photos.client_id+unique(client_id,category) (Fase 3c) suponian un
-- unico servicio por cliente. Con clientes multi-servicio, asignar la zona/
-- NAP/fotos del segundo servicio pisaba al primero — en particular
-- fo_nap_puertos: assignClientToNap() liberaba CUALQUIER puerto que el
-- cliente ya tuviera antes de asignar el nuevo (bug real, confirmado con el
-- caso de Oscar Rodriguez).

-- =========================================================
-- 1) Zona propia de cada servicio
-- =========================================================

alter table public.service_contracts
  add column if not exists zone_id uuid references public.zones (id);

comment on column public.service_contracts.zone_id is
  'Zona de ESTA instalacion. clients.zone_id queda como dato heredado/de referencia, ya no se edita desde la Fase 38.';

update public.service_contracts sc
set zone_id = c.zone_id
from public.clients c
where sc.client_id = c.id
  and sc.zone_id is null
  and c.zone_id is not null;

create index if not exists idx_service_contracts_zone on public.service_contracts (zone_id) where zone_id is not null;

-- =========================================================
-- 2) Puerto de caja NAP por servicio
-- =========================================================

alter table public.fo_nap_puertos
  add column if not exists contract_id uuid references public.service_contracts (id) on delete set null;

create index if not exists idx_fo_nap_puertos_contract on public.fo_nap_puertos (contract_id) where contract_id is not null;

-- Backfill no ambiguo: puertos ya asignados a un cliente con EXACTAMENTE un
-- contrato en todo su historial.
update public.fo_nap_puertos p
set contract_id = sc.id
from public.service_contracts sc
where p.client_id = sc.client_id
  and p.contract_id is null
  and p.client_id is not null
  and (select count(*) from public.service_contracts sc2 where sc2.client_id = p.client_id) = 1;

-- =========================================================
-- 3) Fotos de instalacion por servicio
-- =========================================================

alter table public.client_photos
  add column if not exists contract_id uuid references public.service_contracts (id) on delete cascade;

update public.client_photos cp
set contract_id = sc.id
from public.service_contracts sc
where cp.client_id = sc.client_id
  and cp.contract_id is null
  and (select count(*) from public.service_contracts sc2 where sc2.client_id = cp.client_id) = 1;

-- El unique anterior era (client_id, category): un solo slot de "fachada"
-- por CLIENTE. Pasa a ser por CONTRATO — cada servicio tiene su propio slot
-- de cada categoria. Las fotos que no se pudieron backfillear (cliente
-- multi-servicio, ver auditoria) quedan con contract_id null y sin
-- constraint de unicidad propia hasta que alguien las reasigne a mano.
--
-- Busca el constraint por columnas en vez de asumir el nombre autogenerado
-- (mismo criterio que la Fase 34), para no fallar en silencio si Postgres lo
-- nombro distinto a lo esperado.
do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'client_photos' and con.contype = 'u'
       and con.conkey = (
         select array_agg(att.attnum order by att.attnum)
           from pg_attribute att
          where att.attrelid = rel.oid and att.attname in ('client_id', 'category')
       )
  loop
    execute format('alter table public.client_photos drop constraint %I', r.conname);
  end loop;
end $$;

create unique index if not exists idx_client_photos_contract_category
  on public.client_photos (contract_id, category)
  where contract_id is not null;

-- =========================================================
-- Auditoria (NO se ejecuta aca): clientes con 2+ contratos donde algun
-- puerto NAP o foto quedo sin contract_id — agregar a la consulta ya
-- documentada en la Fase 37 (server/scripts/audit-fase37-servicios.ts).
--
-- select c.id, c.first_name, c.last_name, c.document_number,
--        (select count(*) from public.fo_nap_puertos p where p.client_id = c.id and p.contract_id is null) as puertos_sin_contrato,
--        (select count(*) from public.client_photos cp where cp.client_id = c.id and cp.contract_id is null) as fotos_sin_contrato
-- from public.clients c
-- where (select count(*) from public.service_contracts sc where sc.client_id = c.id) > 1
-- order by c.last_name;
