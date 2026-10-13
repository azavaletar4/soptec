/**
 * Incidencia real (Alta de Violeta Garcia Silva, 2026-10-13): cerrar un
 * trabajo en App de Campo (`performClosureSubmit` en campo.ts) sube fotos,
 * firma, materiales/equipos ya asignados antes, y al final actualiza el
 * código de cliente (cintillo Drop) y marca el trabajo como completado —
 * todo en llamadas separadas, sin una transacción que las una. Si el
 * código de cliente ya pertenece a OTRO contrato (UNIQUE), el cierre
 * fallaba DESPUÉS de haber subido fotos/firma — y como el formulario
 * conserva el borrador con las mismas fotos, cada reintento las volvía a
 * subir (1 fila nueva por categoría de equipo, un archivo de firma nuevo
 * cada vez — nunca se tocó materiales/inventario, eso ya corre en un paso
 * separado y anterior). Estas funciones son la parte pura/testeable de la
 * corrección: detectar ese error específico y decidir qué saltarse en un
 * reintento, sin tocar Supabase/Storage directamente.
 */

/** Código SQLSTATE de Postgres para violación de restricción UNIQUE (23505). */
export function isUniqueViolation(e: unknown, constraintNameHint?: string): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: unknown }).code;
  if (code !== '23505') return false;
  if (!constraintNameHint) return true;
  const message = (e as { message?: unknown }).message;
  return typeof message === 'string' && message.includes(constraintNameHint);
}

/**
 * Qué categorías de `work_order_photos` ya quedaron guardadas en un
 * intento anterior de este mismo cierre — para saltarlas en el reintento
 * en vez de volver a subirlas (patrón ya probado, Fase ~105-139).
 */
export function photosAlreadyUploaded(
  existing: readonly { category: string; storage_path: string }[],
): Map<string, string> {
  return new Map(existing.map((p) => [p.category, p.storage_path]));
}

/**
 * Qué `equipment_type` ya tienen al menos una foto en `client_equipment_photos`
 * para este trabajo (antes de ESTE intento) — se usa para no volver a subir
 * la misma foto de equipo en un reintento. No bloquea 2 equipos del MISMO
 * tipo adjuntados dentro del mismo intento (ese snapshot se toma una sola
 * vez, antes del loop) — solo evita que un reintento repita lo que un
 * intento anterior ya subió.
 */
export function equipmentTypesAlreadyUploaded(existing: readonly { equipment_type: string }[]): Set<string> {
  return new Set(existing.map((e) => e.equipment_type));
}

/**
 * Evita que 2 cierres del MISMO trabajo corran en paralelo (ej. el botón
 * manual y el auto-sync de la cola offline disparándose casi al mismo
 * tiempo). Factory en vez de un Set a nivel de módulo para que cada
 * prueba use su propia instancia, sin estado compartido entre tests.
 */
export function createJobClosureGuard() {
  const inFlight = new Set<string>();
  const key = (jobType: string, jobId: string) => `${jobType}:${jobId}`;
  return {
    /** true = se puede proceder (y queda marcado "en vuelo"); false = ya hay uno corriendo para este trabajo. */
    tryEnter(jobType: string, jobId: string): boolean {
      const k = key(jobType, jobId);
      if (inFlight.has(k)) return false;
      inFlight.add(k);
      return true;
    },
    exit(jobType: string, jobId: string): void {
      inFlight.delete(key(jobType, jobId));
    },
  };
}
