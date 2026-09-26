-- SmartRayco — Fase 41: prioridad por servicio, en reemplazo del codigo de
-- cliente dentro de la pestaña "General" de la ficha del servicio (el codigo
-- de cliente de la Fase 39 se mudo a su propia pestaña "Contrato").

alter table public.service_contracts
  add column if not exists priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low'));

comment on column public.service_contracts.priority is
  'Prioridad de atencion de ESTE servicio (Fase 41): high/medium/low, mostrada como Alta/Media/Baja.';
