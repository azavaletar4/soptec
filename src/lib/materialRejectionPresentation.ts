/**
 * Fase 169: convierte "Consumos pendientes que impiden cerrar órdenes"
 * (InventarioCustodiaView.vue) en una incidencia administrable real.
 * Puro/testeable -- solo interpreta datos ya leídos, nunca consulta ni
 * escribe nada.
 */

/** Estados de orden que ya NO admiten nuevas operaciones de inventario
 * (mismo criterio que execute_tracked_material_inventory/retry_rejected_material_operation
 * en el servidor -- nunca se asume, se replica el mismo conjunto real). */
const OPEN_INSTALLATION_STATUSES = new Set(['pending', 'scheduled', 'in_progress']);
const OPEN_TICKET_STATUSES = new Set(['open', 'in_progress', 'rescheduled']);
const OPEN_ROUTINE_STATUSES = new Set(['pending', 'scheduled', 'in_progress']);

export function isJobOpenForRetry(jobType: 'installation' | 'ticket' | 'routine', status: string | null | undefined): boolean {
  if (!status) return false;
  if (jobType === 'installation') return OPEN_INSTALLATION_STATUSES.has(status);
  if (jobType === 'ticket') return OPEN_TICKET_STATUSES.has(status);
  return OPEN_ROUTINE_STATUSES.has(status);
}

export interface RejectionPayloadItem {
  productId: string;
  quantity: number;
}

/**
 * El payload de un rechazo varía según la acción: 'kit' trae varios
 * materiales (items[]); 'consume' trae uno solo (productId/quantity) al
 * nivel raíz; 'correct' trae movementId (no productId) -- no se puede
 * resolver el producto sin otra consulta, se devuelve vacío en vez de
 * inventar un dato.
 */
export function parseRejectionItems(action: string, payload: Record<string, unknown>): RejectionPayloadItem[] {
  if (action === 'kit') {
    const items = payload.items;
    if (!Array.isArray(items)) return [];
    return items
      .filter((it): it is { productId: unknown; quantity: unknown } => !!it && typeof it === 'object')
      .map((it) => ({ productId: String((it as Record<string, unknown>).productId ?? ''), quantity: Number((it as Record<string, unknown>).quantity) }))
      .filter((it) => it.productId && Number.isFinite(it.quantity) && it.quantity > 0);
  }
  if (action === 'consume') {
    const productId = payload.productId;
    const quantity = Number(payload.quantity);
    if (typeof productId === 'string' && productId && Number.isFinite(quantity) && quantity > 0) {
      return [{ productId, quantity }];
    }
  }
  return [];
}
