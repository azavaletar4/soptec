-- Fase 38b: corrige el upsert de fotos de cliente (ClientPhotosStore.uploadPhoto)
--
-- El indice creado en la Fase 38 (idx_client_photos_contract_category) es
-- PARCIAL: `unique index ... where contract_id is not null`. Postgres solo
-- acepta un indice parcial como arbitro de ON CONFLICT si el propio ON
-- CONFLICT declara el mismo predicado WHERE. supabase-js genera
-- `ON CONFLICT (contract_id, category)` sin WHERE, asi que nunca encuentra
-- arbitro y el insert falla con:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Se reemplaza por un UNIQUE constraint normal (no parcial). Un unique
-- constraint trata cada NULL como distinto de cualquier otro valor (incluido
-- otro NULL), asi que las fotos sin contract_id todavia (clientes
-- multi-servicio sin reasignar, ver Fase 37) siguen sin chocar entre si.

drop index if exists public.idx_client_photos_contract_category;

alter table public.client_photos
  add constraint client_photos_contract_category_key unique (contract_id, category);
