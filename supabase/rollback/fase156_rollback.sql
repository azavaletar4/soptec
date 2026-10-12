-- SmartRayco — ROLLBACK de Fase 156 (prevenir puertos NAP fantasma). NO es
-- una migración de avance — vive fuera de supabase/migrations/ a propósito,
-- para que ninguna herramienta la aplique por error junto a las demás.
-- Ejecutar a mano, solo si Fase 156 ya se aplicó y hace falta revertirla.
--
-- Fase 156 solo AGREGÓ objetos nuevos (2 funciones + 2 triggers) — no tocó
-- ninguna definición previa. "Revertir" es simplemente quitarlos: el
-- comportamiento vuelve a ser el de antes de Fase 156 (causa raíz de
-- Fase 155 otra vez activa: eliminar un cliente/contrato puede volver a
-- dejar un puerto NAP "ocupado" sin dueño). No borra ni modifica ningún
-- dato de clients/service_contracts/fo_nap_puertos. Idempotente: se puede
-- re-ejecutar sin error.

drop trigger if exists trg_service_contracts_free_nap_puerto on public.service_contracts;
drop trigger if exists trg_clients_free_nap_puerto on public.clients;
drop function if exists public.free_nap_puerto_on_contract_delete();
drop function if exists public.free_nap_puerto_on_client_delete();
