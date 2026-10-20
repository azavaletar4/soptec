/**
 * Fase 165, etapa 2 — lectura de solo UX en App de Campo: cuanto material
 * tiene el tecnico logueado en custodia (my_inventory_custody().materials),
 * para mostrar "Disponible: X" y topar la cantidad del input. La
 * proteccion real vive en el servidor (campo_inventory_operation /
 * routine_inventory_operation) — esto nunca sustituye esa validacion,
 * solo evita que el tecnico escriba de mas sin saberlo.
 */
export interface MaterialCustodyBalance {
  product: { id: string };
  quantity: number;
}

export type MaterialCustodyLoadState = 'loading' | 'ready' | 'error' | 'unavailable';

/** Desconocido no equivale a cero; undefined tambien omite el max del input. */
export function confirmedMaterialQuantity(materials: MaterialCustodyBalance[], productId: string, state: MaterialCustodyLoadState): number | undefined {
  return state === 'ready' ? availableMaterialQuantity(materials, productId) : undefined;
}

export function materialCustodyLabel(quantity: number | undefined, unit: string, state: MaterialCustodyLoadState): string {
  if (quantity !== undefined && state === 'ready') return `Tu custodia: ${quantity} ${unit}`;
  if (state === 'loading') return 'Consultando tu custodia…';
  if (state === 'error') return 'No se pudo consultar tu custodia';
  return 'Custodia personal no disponible para este perfil';
}

/** Cantidad disponible de un producto puntual — 0 si no esta en custodia (nunca se inventa un numero). */
export function availableMaterialQuantity(materials: MaterialCustodyBalance[], productId: string): number {
  return materials.find((m) => m.product.id === productId)?.quantity ?? 0;
}
