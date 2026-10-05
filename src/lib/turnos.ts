/**
 * Turnos fijos de 2 horas (Fase 104) — mismo rango horario que el
 * Cronograma de Campo (08:00-18:00, Fase 101-B), para que un turno elegido
 * al crear un ticket caiga siempre en un bloque exacto del tablero.
 */
export interface Turno {
  value: string;
  label: string;
  start: string;
  end: string;
}

export const TURNOS: Turno[] = [
  { value: '08:00-10:00', label: 'Mañana 08:00 - 10:00', start: '08:00', end: '10:00' },
  { value: '10:00-12:00', label: 'Mañana 10:00 - 12:00', start: '10:00', end: '12:00' },
  { value: '12:00-14:00', label: 'Mediodía 12:00 - 14:00', start: '12:00', end: '14:00' },
  { value: '14:00-16:00', label: 'Tarde 14:00 - 16:00', start: '14:00', end: '16:00' },
  { value: '16:00-18:00', label: 'Tarde 16:00 - 18:00', start: '16:00', end: '18:00' },
];

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO local (sin Z) para una fecha + hora "HH:mm" — mismo formato que usa el resto de la app para scheduled_start_at/end_at. */
export function dateTimeToIso(dateStr: string, time: string): string {
  return new Date(`${dateStr}T${time}:00`).toISOString();
}
