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

export interface TrasladoHistorialInput {
  direccionAnterior: string | null;
  zonaAnteriorNombre: string | null;
  direccionNueva: string | null;
  zonaNuevaNombre: string | null;
  ontAction: 'keep' | 'replaced';
  ontSerialNuevo: string | null;
}

/**
 * Nota de historial en texto libre (requisito: "mantener historial de
 * ubicación anterior y nueva") — reutiliza `closure_notes`, ya existente
 * en `routines`/`work_order_closures`, sin tabla ni columna nueva (ver
 * riesgo documentado en 13an/13ao sobre por qué no se creó una tabla de
 * auditoría aparte para esto todavía).
 */
export function buildTrasladoHistorialNote(input: TrasladoHistorialInput): string {
  const anterior =
    input.direccionAnterior || input.zonaAnteriorNombre
      ? `${input.direccionAnterior ?? 'dirección no registrada'} (${input.zonaAnteriorNombre ?? 'zona no registrada'})`
      : 'sin datos previos registrados';
  const nueva = `${input.direccionNueva ?? 'dirección no indicada'} (${input.zonaNuevaNombre ?? 'zona no indicada'})`;
  const ont =
    input.ontAction === 'replaced'
      ? `ONT reemplazada${input.ontSerialNuevo ? ` (nuevo serial: ${input.ontSerialNuevo})` : ''} — vínculo en la OLT pendiente de actualización manual`
      : 'ONT conservada (mismo equipo)';
  return `Traslado de servicio: ${anterior} → ${nueva}. ${ont}.`;
}
