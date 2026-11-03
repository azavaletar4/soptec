-- Rollback de 20261104000000_olt_sync_new_onts_detected.sql
-- La migracion es puramente aditiva (2 columnas nuevas en una tabla ya
-- existente, ambas con DEFAULT seguro) -- este rollback solo deshace
-- exactamente eso. No borra ninguna fila de olt_sync_cache ni toca
-- olt_onts/ninguna otra tabla.
begin;
alter table public.olt_sync_cache
  drop column if exists new_onts_detected,
  drop column if exists new_onts_checked_at;
commit;
