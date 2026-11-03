-- Rollback de 20261103000000_olt_ont_external_link.sql
-- La migracion es puramente aditiva (tabla nueva + indice nuevo, ningun
-- objeto existente se modifica) -- este rollback solo deshace exactamente
-- eso, sin tocar olt_onts salvo quitarle el indice.
begin;
drop index if exists public.olt_onts_contract_id_active_key;
drop table if exists public.olt_ont_link_audit;
commit;
