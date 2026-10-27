import type { AsistenciaNovedad, NovedadResumen, NovedadTipo } from '@/types/domain';

/**
 * Helpers de A2 (vacaciones/descanso/permiso por horas/media jornada) — la
 * fuente de verdad (rangos, solapamientos, roles) la valida siempre el
 * servidor (asistencia_novedad_crear/cancelar, ver migración). Esto solo
 * arma presentación y el cómputo derivado de falta/tardanza en el cliente,
 * igual que asistenciaAusencias.ts para A1.
 */

export const NOVEDAD_TIPO_LABEL: Record<NovedadTipo, string> = {
  vacaciones: 'Vacaciones',
  descanso_programado: 'Descanso programado',
  permiso_horas: 'Permiso por horas',
  media_jornada: 'Media jornada',
};

export const NOVEDAD_BADGE_CLASS: Record<NovedadTipo, string> = {
  vacaciones: 'bg-sky-500/15 text-sky-700',
  descanso_programado: 'bg-indigo-500/15 text-indigo-700',
  permiso_horas: 'bg-amber-500/15 text-amber-700',
  media_jornada: 'bg-teal-500/15 text-teal-700',
};

/** Texto corto para una fila (tablero/lista personal), ej. "Media jornada — mañana" o "Permiso 09:00–11:00". */
export function novedadTexto(n: Pick<AsistenciaNovedad | NovedadResumen, 'tipo' | 'turno' | 'hora_inicio' | 'hora_fin'>): string {
  const base = NOVEDAD_TIPO_LABEL[n.tipo];
  if (n.tipo === 'media_jornada' && n.turno) return `${base} — ${n.turno === 'manana' ? 'mañana' : 'tarde'}`;
  if (n.tipo === 'permiso_horas' && n.hora_inicio && n.hora_fin) return `${base} ${n.hora_inicio.slice(0, 5)}–${n.hora_fin.slice(0, 5)}`;
  return base;
}

/** Tipos que eximen el día completo de falta/tardanza (vacaciones, descanso,
 *  media jornada) — un permiso por horas NO exime el día completo, solo
 *  suprime la tardanza dentro de su ventana (ver tardanzaSuprimidaPorPermiso). */
export function novedadEximeDiaCompleto(tipo: NovedadTipo): boolean {
  return tipo === 'vacaciones' || tipo === 'descanso_programado' || tipo === 'media_jornada';
}

/** true si alguna novedad (propia o del resumen multiusuario) cubre esa fecha con un tipo que exime el día completo. */
export function diaAutorizado(fecha: string, novedades: Pick<NovedadResumen, 'fecha' | 'tipo'>[]): boolean {
  return novedades.some((n) => n.fecha === fecha && novedadEximeDiaCompleto(n.tipo));
}

/**
 * true si un ingreso real cae dentro de la ventana de un permiso por horas de
 * ese mismo día — la tardanza calculada por el servidor (mark_attendance_ingreso)
 * sigue siendo el hecho técnico real (nunca se reescribe), pero no se muestra
 * ni se cuenta como tardanza indebida en el tablero/reporte.
 */
export function tardanzaSuprimidaPorPermiso(horaIngresoIso: string, novedadesDelDia: Pick<NovedadResumen, 'fecha' | 'tipo' | 'hora_fin'>[]): boolean {
  const fechaIngreso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(horaIngresoIso));
  const horaLima = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(horaIngresoIso));
  return novedadesDelDia.some((n) => n.tipo === 'permiso_horas' && n.fecha === fechaIngreso && !!n.hora_fin && horaLima <= n.hora_fin.slice(0, 5));
}

export async function fetchNovedadesResumen(desde: string, hasta: string): Promise<NovedadResumen[]> {
  const { supabase } = await import('@/lib/supabase');
  const rows: NovedadResumen[] = [];
  let cursor: NovedadResumen | undefined;
  for (;;) {
    const { data, error } = await supabase.rpc('asistencia_novedades_resumen', {
      p_desde: desde, p_hasta: hasta, p_cursor_fecha: cursor?.fecha ?? null, p_cursor_usuario: cursor?.user_id ?? null,
    });
    if (error) throw error; // Nunca devolver un rango parcial.
    const page = (data ?? []) as NovedadResumen[];
    rows.push(...page);
    if (page.length < 500) return rows;
    const last = page[page.length - 1]!;
    if (last.fecha === cursor?.fecha && last.user_id === cursor?.user_id) throw new Error('La paginación no avanzó');
    cursor = last;
  }
}
