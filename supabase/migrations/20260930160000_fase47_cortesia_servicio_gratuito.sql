-- SmartRayco — Fase 47: servicio gratuito / cortesia
--
-- Contexto: algunos clientes tienen el servicio sin costo (modem de oficina,
-- familiares o trabajadores con beneficio). Antes esto se registraba a mano
-- cada mes como un "pago de S/0" en Facturacion (ver FacturacionView.vue),
-- sin dejar rastro de por que esa factura entro en S/0 ni bloqueo de que
-- alguien la sume por error a lo realmente cobrado.
--
-- Ahora se marca UNA vez en el contrato (is_courtesy + motivo). La factura
-- que corresponda a ese servicio se crea directamente en estado 'exonerada'
-- (S/0, no pasa por "pendiente de cobro" ni por "Registrar pago") — tanto si
-- la crea el generador automatico (invoiceGenerationService.ts, hoy
-- desactivado por defecto) como si la crea el staff a mano en
-- Facturacion.vue (el formulario ya reconoce el contrato como cortesia).

alter table public.service_contracts
  add column if not exists is_courtesy boolean not null default false,
  add column if not exists courtesy_reason text;

comment on column public.service_contracts.is_courtesy is
  'Servicio gratuito (ej. modem de oficina, familiar/trabajador con beneficio) — sus facturas nacen en estado exonerada.';
comment on column public.service_contracts.courtesy_reason is
  'Motivo del servicio gratuito, texto libre (ej. "Modem de oficina").';

-- Nuevo estado de factura: "exonerada" — igual que 'cancelled', no cuenta
-- como pendiente de cobro ni como cobrado; se muestra aparte en los reportes
-- para distinguir "no se cobro porque es cortesia" de "no se cobro porque se
-- anulo la factura". El trigger set_invoice_amount_due (Fase 33b) ya calcula
-- amount_due=0 correctamente para estas filas porque su amount siempre es 0
-- (no hace falta tocar ese trigger).
alter type public.invoice_status add value if not exists 'exonerada';
