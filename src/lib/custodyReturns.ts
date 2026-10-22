import type { MyInventoryCustody } from '@/types/domain';

export function materialReturnError(data: MyInventoryCustody, productId: string, quantity: number | null): string | null {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return 'Indica una cantidad positiva.';
  if (data.pendingReturnRequests.some(r => r.product.id === productId && r.status === 'pending')) return 'Ya tienes una solicitud pendiente para este material.';
  const available = Number(data.materials.find(m => m.product.id === productId)?.quantity ?? 0);
  if (quantity > available) return 'La cantidad supera tu custodia disponible.';
  return null;
}
