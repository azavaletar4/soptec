-- SmartRayco — ROLLBACK de Fase 158 (sincronizar NAP + zona de ONT en una
-- sola transaccion). NO es una migración de avance — vive fuera de
-- supabase/migrations/ a propósito, para que ninguna herramienta la
-- aplique por error junto a las demás. Ejecutar a mano, solo si Fase 158
-- ya se aplicó y hace falta revertirla.
--
-- Fase 158 solo AGREGÓ una función nueva (assign_contract_nap_sync_ont_zone)
-- — no modificó assign_contract_nap ni assign_provisioning_nap (Fase 2).
-- "Revertir" es simplemente quitarla: ClientServiceDetailView.vue volvería
-- a sincronizar NAP y zona de la ONT en 2 pasos separados (el estado de
-- antes de Fase 158, con el gap ya documentado en 13ac/13ad). No borra ni
-- modifica ningún dato de service_contracts/fo_nap_puertos/olt_onts.
-- Idempotente: se puede re-ejecutar sin error.

drop function if exists public.assign_contract_nap_sync_ont_zone(uuid, uuid, uuid);
