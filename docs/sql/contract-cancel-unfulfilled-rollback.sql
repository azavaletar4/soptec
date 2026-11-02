-- PROPUESTA LOCAL: revierte solo definiciones, no estados ni datos históricos.
-- No borra contract_unfulfilled_cancellations (es historial, mismo criterio
-- que el Kardex) — solo retira la función que escribe en ella.
begin;
drop function if exists public.contract_cancel_unfulfilled(uuid, timestamptz, text, boolean);
commit;
