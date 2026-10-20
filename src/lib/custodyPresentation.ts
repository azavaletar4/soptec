import type { MyInventoryCustody } from '@/types/domain';

/** Display-only totals: group by the registered unit, never convert units. */
export function custodyPresentation(data: MyInventoryCustody) {
  const materials = new Map<string, number>();
  for (const row of data.materials) {
    const quantity = row.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) return null;
    if (quantity === 0) continue;
    const unit = row.product.unit.trim() || '(unidad no registrada)';
    const total = (materials.get(unit) ?? 0) + quantity;
    if (!Number.isFinite(total)) return null;
    materials.set(unit, total);
  }
  return {
    availableEquipment: data.units.filter(unit => unit.status === 'with_technician').length,
    pendingEquipment: data.units.filter(unit => unit.status === 'pending_return').length,
    materials: [...materials].map(([unit, quantity]) => ({ unit, quantity })),
  };
}

export const custodyQuantity = (quantity: number) =>
  new Intl.NumberFormat('es-PE', { maximumFractionDigits: 6 }).format(quantity);
