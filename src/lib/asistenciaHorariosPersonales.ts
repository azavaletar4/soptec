import type { HorarioPersonal } from '@/types/domain';

/**
 * Helpers de solo presentación para horarios parciales RECURRENTES
 * (Fase A2.1) — el cómputo que de verdad importa (tardanza/falta según el
 * horario real de la persona) lo hace el servidor dentro de
 * mark_attendance_ingreso (ver 20261028010000_asistencia_a2_horarios_personales.sql),
 * nunca el cliente. Esto solo arma textos/badges para que SUPERADMIN y el
 * propio trabajador vean con claridad su horario habitual — nunca inventa
 * una hora que el servidor no tenga configurada.
 */

export const DIA_SEMANA_LABEL: Record<number, string> = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado',
};

/** "Sábado 14:00–18:00 (tarde)". */
export function horarioPersonalTexto(h: Pick<HorarioPersonal, 'dia_semana' | 'hora_ingreso' | 'hora_salida' | 'turno'>): string {
  const turnoLabel = h.turno === 'manana' ? 'mañana' : 'tarde';
  return `${DIA_SEMANA_LABEL[h.dia_semana]} ${h.hora_ingreso.slice(0, 5)}–${h.hora_salida.slice(0, 5)} (${turnoLabel})`;
}

/** El horario personal (si existe) que aplica para un día de la semana dado. */
export function horarioPersonalDeDia(horarios: HorarioPersonal[], diaSemana: number): HorarioPersonal | undefined {
  return horarios.find((h) => h.dia_semana === diaSemana);
}
