-- SmartRayco — Fase 119: permitir dia de emision 1-31 (antes 1-28).
--
-- El constraint original (Fase 2) limitaba billing_day a 1-28 para evitar
-- fechas invalidas en meses cortos (ej. 31 de febrero no existe) — pero esa
-- es exactamente la limitacion que molestaba: un cliente que paga el 30 o 31
-- no podia configurarse asi. invoiceGenerationService.ts (dueDateForPeriod/
-- Math.min(billingDay, daysInMonth)) ya resuelve esto correctamente desde
-- antes: si el mes tiene menos dias que billing_day, emite el ultimo dia de
-- ese mes — con Date.UTC(year, month+1, 0), que considera bisiestos solo.
-- Solo faltaba permitir guardar el valor.

alter table public.service_contracts drop constraint if exists service_contracts_billing_day_check;
alter table public.service_contracts add constraint service_contracts_billing_day_check
  check (billing_day >= 1 and billing_day <= 31);
