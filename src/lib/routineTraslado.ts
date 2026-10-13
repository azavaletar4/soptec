/**
 * Fase 3 OLT — Fase C (continuación): "Traslado de servicio" como subtipo
 * de Rutina ya existente (Fase 129, `tipo_rutina = 'servicio_cliente'`),
 * ver ESTADO_DESARROLLO.md 13an/13ao. Lógica pura compartida entre
 * `RutinasView.vue` (creación/edición, elige el contrato) y
 * `CampoTrabajoDetailView.vue` (cierre en App Campo) — para no
 * reimplementar el mismo criterio dos veces.
 */

export const TRASLADO_SERVICIO_SUBTIPO = 'traslado_servicio';

/** true solo para una rutina de Servicio a Cliente con este subtipo exacto — nunca se infiere de otra forma (título, descripción, etc). */
export function isTrasladoServicioRoutine(tipoRutina: string, subtipo: string | null | undefined): boolean {
  return tipoRutina === 'servicio_cliente' && subtipo === TRASLADO_SERVICIO_SUBTIPO;
}

export interface OntLikeForContract {
  id: string;
  serial: string;
  slot: number;
  port: number;
  status: string;
  contract_id?: string | null;
}

export type CurrentOntResolution =
  | { status: 'none' }
  | { status: 'found'; ont: OntLikeForContract }
  | { status: 'ambiguous'; count: number };

/**
 * Resuelve, para MOSTRAR (nunca para escribir), cuál es la ONT actual de
 * un contrato — mismo criterio de "nunca elegir una al azar" que
 * `resolveOntForZoneSync` (ontZoneSync.ts), pero sin la semántica de
 * update/unchanged de esa función (acá no hay zona destino que comparar,
 * solo se quiere saber qué ONT está hoy vinculada a este contract_id).
 */
export function resolveCurrentOntForContract(
  onts: readonly OntLikeForContract[],
  contractId: string,
): CurrentOntResolution {
  const matches = onts.filter((o) => o.contract_id === contractId);
  if (matches.length === 0) return { status: 'none' };
  if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
  return { status: 'found', ont: matches[0] };
}

export interface TrasladoAnteriorSnapshot {
  direccionAnterior: string | null;
  zonaAnteriorNombre: string | null;
  /** Revisión puntual (punto 1): el nombre de la caja NAP también se congela — el pedido explícito fue "zona/NAP anterior desactualizada". */
  napAnteriorNombre: string | null;
}

/**
 * Revisión puntual (2026-10-13, punto 1): un reintento del cierre —misma
 * sesión o una página nueva tras un fallo parcial— NUNCA debe recalcular
 * "anterior" a partir del contrato actual, porque un intento previo puede
 * ya haber escrito la zona/dirección NUEVA ahí (ej. la zona se guardó
 * bien pero la caja NAP falló después) — repetirlo pisaría la nota
 * correcta del primer intento con una que dice "sin cambio". Por eso el
 * snapshot se calcula UNA sola vez por rutina (la primera vez que se abre
 * esta pantalla, antes de cualquier escritura) y de ahí en más siempre se
 * reutiliza el que ya existe — ver `CampoTrabajoDetailView.vue`, que lo
 * persiste con el mismo mecanismo de borradores ya usado para
 * `closureForm` (`formDrafts.ts`), sobrevive a un cierre de la app y se
 * borra recién cuando el traslado termina de cerrarse con éxito.
 */
export function resolveTrasladoAnteriorSnapshot(
  existing: TrasladoAnteriorSnapshot | null,
  current: TrasladoAnteriorSnapshot,
): TrasladoAnteriorSnapshot {
  return existing ?? current;
}

export interface TrasladoHistorialInput {
  direccionAnterior: string | null;
  zonaAnteriorNombre: string | null;
  napAnteriorNombre: string | null;
  direccionNueva: string | null;
  zonaNuevaNombre: string | null;
  napNuevaNombre: string | null;
  ontAction: 'keep' | 'replaced';
  ontSerialNuevo: string | null;
}

function describeUbicacion(direccion: string | null, zona: string | null, nap: string | null, faltante: string): string {
  if (!direccion && !zona && !nap) return faltante;
  return `${direccion ?? 'dirección no registrada'} (${zona ?? 'zona no registrada'}, NAP: ${nap ?? 'no registrada'})`;
}

/**
 * Nota de historial en texto libre (requisito: "mantener historial de
 * ubicación anterior y nueva", incluida la caja NAP) — reutiliza
 * `closure_notes`, ya existente en `routines`/`work_order_closures`, sin
 * tabla ni columna nueva (ver riesgo documentado en 13an/13ao sobre por
 * qué no se creó una tabla de auditoría aparte para esto todavía).
 */
export function buildTrasladoHistorialNote(input: TrasladoHistorialInput): string {
  const anterior = describeUbicacion(input.direccionAnterior, input.zonaAnteriorNombre, input.napAnteriorNombre, 'sin datos previos registrados');
  const nueva = describeUbicacion(input.direccionNueva, input.zonaNuevaNombre, input.napNuevaNombre, 'sin datos nuevos indicados');
  const ont =
    input.ontAction === 'replaced'
      ? `ONT reemplazada${input.ontSerialNuevo ? ` (nuevo serial: ${input.ontSerialNuevo})` : ''} — vínculo en la OLT pendiente de actualización manual`
      : 'ONT conservada (mismo equipo)';
  return `Traslado de servicio: ${anterior} → ${nueva}. ${ont}.`;
}
