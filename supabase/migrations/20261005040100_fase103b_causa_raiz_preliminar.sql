-- SmartRayco — Fase 103b: "Causa técnica encontrada en campo" (root cause).
--
-- 1) motivo_averia_detalle: texto libre que acompaña a motivo_averia='other'
--    cuando ninguna opcion fija describe lo que el tecnico encontro.
-- 2) motivo_preliminar: sospecha inicial que ADMIN/SOPORTE puede dejar al
--    crear el ticket (opcional) — el cierre en la App de Campo la usa para
--    pre-llenar el selector del tecnico, que sigue siendo 100% editable.
--
-- motivo_averia (el campo final, elegido por el tecnico al cerrar) ya
-- funciona como "causa raiz" para reportes estadisticos (Fase 49) — no hizo
-- falta renombrar la columna, solo asegurar que quede poblada y agregar el
-- desglose en ReportesView.vue (ver store reports.ts).

alter table public.tickets add column if not exists motivo_averia_detalle text;
alter table public.tickets add column if not exists motivo_preliminar public.ticket_motivo_averia;

comment on column public.tickets.motivo_averia is
  'Causa raiz (root cause) de la averia, elegida por el tecnico al cerrar el ticket — alimenta el reporte "Averias por causa" y el ranking de puntos (Fase 27/49).';
comment on column public.tickets.motivo_averia_detalle is
  'Texto libre cuando motivo_averia = ''other'' (ninguna opcion fija describe la causa encontrada).';
comment on column public.tickets.motivo_preliminar is
  'Sospecha inicial de ADMIN/SOPORTE al crear el ticket (opcional) — pre-llena el selector del tecnico en el cierre, que puede cambiarla libremente.';
