export interface Intercambio {
  id: string; user_id: string; fecha_descanso: string; fecha_trabajo: string;
  hora_ingreso: string; hora_salida: string; estado: 'activo' | 'cancelado';
  created_by: string; created_at: string; cancelled_at: string | null; cancel_motivo: string | null;
}
export interface IntercambioDia {
  user_id: string; fecha: string; tipo: 'descanso' | 'trabajo';
  hora_ingreso: string; hora_salida: string; fecha_vinculada: string;
}

export function intercambioDeDia(rows: IntercambioDia[], userId: string, fecha: string) {
  return rows.find(r => r.user_id === userId && r.fecha === fecha);
}

/** Añade domingos/feriados compensatorios y retira el descanso, incluso entre meses. */
export function diasLaborablesConIntercambios(base: string[], rows: IntercambioDia[], userId: string, desde: string, hasta: string): string[] {
  const dias = new Set(base);
  for (const r of rows.filter(r => r.user_id === userId && r.fecha >= desde && r.fecha <= hasta)) {
    if (r.tipo === 'descanso') dias.delete(r.fecha); else dias.add(r.fecha);
  }
  return [...dias].sort();
}

export async function fetchIntercambios(): Promise<Intercambio[]> {
  const { supabase } = await import('@/lib/supabase');
  const rows: Intercambio[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('asistencia_intercambios').select('*').order('id').range(offset, offset + 499);
    if (error) throw error;
    const page = (data ?? []) as Intercambio[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export async function fetchIntercambiosResumen(desde: string, hasta: string): Promise<IntercambioDia[]> {
  const { supabase } = await import('@/lib/supabase');
  const rows: IntercambioDia[] = [];
  let cursor: IntercambioDia | undefined;
  for (;;) {
    const { data, error } = await supabase.rpc('asistencia_intercambios_resumen', {
      p_desde: desde, p_hasta: hasta, p_cursor_fecha: cursor?.fecha ?? null, p_cursor_usuario: cursor?.user_id ?? null,
    });
    if (error) throw error;
    const page = (data ?? []) as IntercambioDia[];
    rows.push(...page);
    if (page.length < 500) return rows;
    const last = page[page.length - 1]!;
    if (last.fecha === cursor?.fecha && last.user_id === cursor?.user_id) throw new Error('La paginación no avanzó');
    cursor = last;
  }
}
