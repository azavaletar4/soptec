
export type AusenciaEstado = 'pendiente' | 'aprobada' | 'rechazada';
export interface AusenciaResumen { user_id: string; fecha: string; estado: AusenciaEstado }
export interface Ausencia extends AusenciaResumen {
  id: string; motivo: string; observacion: string | null; version: number;
  created_at: string; decision_motivo: string | null; resolved_at: string | null;
  profile?: { full_name: string | null; email: string } | null;
  /** Quien resolvio (aprobo/rechazo) — solo se pide/llena cuando se lee como SUPERADMIN. */
  resolver?: { full_name: string | null; email: string } | null;
}

/**
 * Comentario que viaja al aprobar si SUPERADMIN no escribio uno propio — el
 * backend (resolver_ausencia) exige un p_motivo no vacio para CUALQUIER
 * decision (RPC sin distincion aprobada/rechazada, ver migracion A0/A1), asi
 * que esto cumple esa regla de auditoria sin forzar a escribir nada para un
 * caso simple. Rechazar NUNCA usa este default — siempre pide un motivo real.
 */
export const DECISION_MOTIVO_APROBAR_DEFAULT = 'Aprobado sin observaciones adicionales';

/** Texto efectivo que se enviaria al backend para una decision dada. */
export function decisionMotivoEfectivo(decision: 'aprobada' | 'rechazada', escrito: string): string {
  const limpio = escrito.trim();
  if (limpio) return limpio;
  return decision === 'aprobada' ? DECISION_MOTIVO_APROBAR_DEFAULT : '';
}
export const AUSENCIA_LABEL: Record<AusenciaEstado, string> = {
  pendiente: 'Pendiente de justificar', aprobada: 'Ausencia justificada', rechazada: 'Justificación rechazada',
};

/** Version corta para el widget personal (movil) — la bandeja admin sigue usando AUSENCIA_LABEL. */
export const AUSENCIA_LABEL_CORTO: Record<AusenciaEstado, string> = {
  pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada',
};

/** Mismo patron de color que ESTADO_BADGE_CLASS (asistenciaReglas.ts) para .badge. */
export const AUSENCIA_BADGE_CLASS: Record<AusenciaEstado, string> = {
  pendiente: 'bg-amber-500/15 text-amber-700', aprobada: 'bg-green-500/15 text-green-600', rechazada: 'bg-red-500/15 text-red-600',
};

/** Exención confirmada por el propietario; no cambia ni borra hechos históricos. */
export function exentoDeAsistencia(role: string | null): boolean {
  return role === 'SUPERADMIN';
}

export async function fetchAusenciasResumen(desde: string, hasta: string): Promise<AusenciaResumen[]> {
  const { supabase } = await import('@/lib/supabase');
  const rows: AusenciaResumen[] = [];
  let cursor: AusenciaResumen | undefined;
  for (;;) {
    const { data, error } = await supabase.rpc('asistencia_ausencias_resumen', {
      p_desde: desde, p_hasta: hasta, p_cursor_fecha: cursor?.fecha ?? null, p_cursor_usuario: cursor?.user_id ?? null,
    });
    if (error) throw error; // Nunca devolver un rango parcial.
    const page = (data ?? []) as AusenciaResumen[];
    rows.push(...page);
    if (page.length < 500) return rows;
    const last = page[page.length - 1]!;
    if (last.fecha === cursor?.fecha && last.user_id === cursor?.user_id) throw new Error('La paginación no avanzó');
    cursor = last;
  }
}

export function cuentaFalta(ingreso: boolean, estado: AusenciaEstado | undefined, dia: string, hoy: string, laborable: boolean, obligatorio: boolean): boolean {
  return obligatorio && laborable && dia < hoy && !ingreso && estado !== 'pendiente' && estado !== 'aprobada';
}
