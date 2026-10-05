-- SmartRayco — Fase 108: prioridad editable en Altas (installations) y
-- Rutinas (routines), igual que Tickets desde Fase 6. Reusa el enum
-- public.ticket_priority (low/medium/high/urgent) tal cual en las 3 tablas
-- en vez de crear uno nuevo por tipo — mismos valores, mismo significado.
--
-- Sin cambios de RLS: las politicas de update de installations/routines ya
-- son column-agnostic (cualquier campo que el rol pueda tocar incluye este
-- nuevo), igual que como priority de tickets nunca tuvo su propia politica
-- aparte — la restriccion "solo admin/soporte cambia prioridad" es de
-- frontend (ver TicketDetailView.vue:handlePriorityChange), no de la BD.

alter table public.installations
  add column priority public.ticket_priority not null default 'medium';

alter table public.routines
  add column priority public.ticket_priority not null default 'medium';
