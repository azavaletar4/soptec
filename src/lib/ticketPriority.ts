import type { TicketPriority } from '@/types/domain';

// Mismas 4 prioridades para Averias/Altas/Rutinas (Fase 108) — reusa el
// enum ticket_priority de la BD en las 3 tablas en vez de uno por tipo.
export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};

export const PRIORITY_CLASS: Record<TicketPriority, string> = {
  low: 'bg-slate-500/15 text-slate-600',
  medium: 'bg-sky-500/15 text-sky-700',
  high: 'bg-orange-500/15 text-orange-600',
  urgent: 'bg-red-500/15 text-red-600',
};

/** Fase 132 — icono de color para el banner de alerta preventiva (App de Campo) y cualquier otro lugar que quiera un indicador mas llamativo que el badge de texto. */
export const PRIORITY_ICON: Record<TicketPriority, string> = {
  low: '🔵',
  medium: '🟡',
  high: '🟠',
  urgent: '🔴',
};

export const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];
