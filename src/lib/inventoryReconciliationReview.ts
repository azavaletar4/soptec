import type { ReconciliationRow } from './inventoryReconciliation';

/**
 * Presentación pura sobre `reconcileInventory` ya calculado — nunca reclasifica
 * ni decide si algo está instalado; solo decide qué mostrar primero en la
 * pantalla de revisión. 'installed'/'custody' son vínculos documentales
 * coherentes y nunca necesitan revisión por sí solos.
 */
export function needsReview(row: ReconciliationRow): boolean {
  return row.classification === 'possible' || row.classification === 'unknown';
}

export const REVIEW_TIER_LABELS = {
  1: 'En almacén con indicios de estar instalado',
  2: 'Serie o MAC duplicada entre unidades',
  3: 'Ubicación sin verificar',
  4: 'Vínculos registrados por confirmar',
} as const;
export type ReviewTier = keyof typeof REVIEW_TIER_LABELS;

const isDuplicate = (row: ReconciliationRow) => row.reasons.some((r) => r.includes('repetida'));

/** Prioridad visual, en el mismo orden pedido: almacén con indicios > duplicados > sin verificar > otros vínculos por confirmar. */
export function reviewTier(row: ReconciliationRow): ReviewTier {
  const u = row.unit;
  const hasLocationSignal = row.serialMatches > 0 || row.ticketSerialMatches > 0 || !!u.client_id || !!u.contract_id || !!u.installation_id || !!u.ticket_id;
  if (u.status === 'in_stock' && row.classification === 'possible' && hasLocationSignal) return 1;
  if (isDuplicate(row)) return 2;
  if (row.classification === 'unknown') return 3;
  return 4;
}

export function reviewReasonLabel(row: ReconciliationRow): string {
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
