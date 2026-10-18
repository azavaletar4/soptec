import type { ReconciliationRow } from './inventoryReconciliation';

/**
 * Presentación pura sobre `reconcileInventory` ya calculado — nunca reclasifica
 * ni decide si algo está instalado; solo decide qué mostrar primero en la
 * pantalla de revisión. 'installed'/'custody' son vínculos documentales
 * coherentes y nunca necesitan revisión por sí solos. 'unknown' TAMPOCO —
 * por construcción de `reconcileInventory`, 'unknown' significa que no hay
 * ningún vínculo, duplicado, coincidencia de serie (exacta o por posible
 * error de digitación) ni dato residual: un equipo "En almacén" sin ninguna
 * señal contradictoria es el caso normal esperado, no una discrepancia
 * (mismo criterio ya usado para `pendienteVinculacion` en
 * `ontZoneDiscrepancy.ts`) — mostrarlo como pendiente generaba falsos
 * positivos masivos sin evidencia real que revisar.
 */
export function needsReview(row: ReconciliationRow): boolean {
  return row.classification === 'possible';
}

export const REVIEW_TIER_LABELS = {
  1: 'En almacén con indicios de estar instalado',
  2: 'Serie o MAC duplicada entre unidades',
  3: 'Ubicación sin verificar',
  4: 'Vínculos registrados por confirmar',
} as const;
export type ReviewTier = keyof typeof REVIEW_TIER_LABELS;

const isDuplicate = (row: ReconciliationRow) => row.reasons.some((r) => r.includes('repetida'));
/** Un contract_id sin client_id/installation_id/ticket_id casi siempre es un
 * remanente de un movimiento anterior ya revertido (devolución a bodega que no
 * limpió ese campo) — nunca un indicio de que el equipo esté instalado. */
const isOrphanContract = (row: ReconciliationRow) => !!row.unit.contract_id && !row.unit.client_id && !row.unit.installation_id && !row.unit.ticket_id;

/** Prioridad visual, en el mismo orden pedido: almacén con indicios > duplicados > sin verificar > otros vínculos por confirmar. */
export function reviewTier(row: ReconciliationRow): ReviewTier {
  const u = row.unit;
  // contract_id NO cuenta como indicio de ubicación por sí solo: solo es señal
  // confiable junto con client_id (que ya cubre su propia rama abajo) — un
  // contract_id huérfano se revisa aparte, en la prioridad más baja. Un
  // candidato de posible error de digitación sí es un indicio real a priorizar,
  // aunque sea conservador y nunca pruebe que es el mismo equipo.
  const hasLocationSignal = row.serialMatches > 0 || row.ticketSerialMatches > 0 || !!u.client_id || !!u.installation_id || !!u.ticket_id || !!row.typoCandidate;
  if (u.status === 'in_stock' && row.classification === 'possible' && hasLocationSignal) return 1;
  if (isDuplicate(row)) return 2;
  if (row.classification === 'unknown') return 3;
  return 4;
}

export function reviewReasonLabel(row: ReconciliationRow): string {
  if (row.typoCandidate) {
    return row.typoCandidate.ambiguous
      ? `Serie similar a varios cierres distintos (posible error de digitación) — ambiguo, requiere revisión manual`
      : `Serie similar a la de un cierre verificado (posible error de digitación): ${row.typoCandidate.unitSerial} vs. ${row.typoCandidate.sourceSerial}`;
  }
  if (isOrphanContract(row)) return 'Contrato registrado sin cliente vinculado — probable dato remanente de un movimiento revertido, no indica instalación';
  return REVIEW_TIER_LABELS[reviewTier(row)];
}

/** Ordena solo dentro de lo que necesita revisión; no reordena ni oculta nada en la consulta completa. */
export function sortByReviewPriority(rows: ReconciliationRow[]): ReconciliationRow[] {
  return [...rows].sort((a, b) => {
    const aReview = needsReview(a), bReview = needsReview(b);
    if (aReview && !bReview) return -1;
    if (!aReview && bReview) return 1;
    if (!aReview && !bReview) return 0;
    return reviewTier(a) - reviewTier(b);
  });
}
