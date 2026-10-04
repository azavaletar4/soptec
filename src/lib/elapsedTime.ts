/**
 * Formatea el tiempo transcurrido desde un timestamp ISO como "MM:SS" (los
 * minutos pueden pasar de 59 si el ticket lleva horas en progreso).
 *
 * OJO: el esquema de `tickets` no tiene una columna dedicada tipo
 * "started_at" — se usa `updated_at` como proxy de "cuando entro a en
 * progreso", porque una vez asignado el tecnico ya no puede tocar nada mas
 * del ticket salvo el estado (Fase 88/89 le bloquearon prioridad y cierre).
 * Un admin editando el ticket mientras esta en progreso reiniciaria el
 * cronometro visualmente — aceptable para un indicador operativo, no para
 * facturacion.
 */
export function formatElapsedTime(sinceIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(sinceIso).getTime());
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
