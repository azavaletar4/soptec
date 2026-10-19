import type { InventoryUnit, InventoryUnitEvent } from '@/types/domain';

export function chooseCustodyTechnician(current: string | null, rows: Array<{ id: string; units: unknown[]; materials: unknown[] }>) {
  if (rows.some(row => row.id === current)) return current;
  return (rows.find(row => row.units.length || row.materials.length) ?? rows[0])?.id ?? null;
}

/** Solo una entrega del ciclo vigente; nunca usa updated_at ni el creador de la unidad. */
export function currentCustodyDelivery(unit: Pick<InventoryUnit, 'id' | 'status' | 'custody_technician_id'>, events: InventoryUnitEvent[]) {
  if (!['with_technician', 'pending_return'].includes(unit.status)) return null;
  const ordered = events.filter(e => e.unit_id === unit.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const event of ordered) {
    if (event.to_status === 'with_technician') return event.assigned_to === unit.custody_technician_id ? event : null;
    if (event.to_status !== 'pending_return' || event.assigned_to !== unit.custody_technician_id) return null;
  }
  return null;
}

export function custodyEquipmentLocation(productId: string, unitId: string) {
  return { name: 'inventario-detalle', params: { id: productId }, query: { unit: unitId, returnTo: '/inventario/custodia' } };
}

/**
 * Explicacion concreta y verificable de por que un consumo quedo marcado
 * sin custodia suficiente — a partir de los mismos numeros ya calculados
 * (nunca una suposicion nueva): sin ninguna entrega, o una entrega que no
 * alcanzaba. Fase 165, etapa 1 — presentacion de Custodia -> Conciliacion.
 */
export function shortfallReasonLabel(row: { quantity: number; availableBefore: number; unit: string }): string {
  if (row.availableBefore <= 0) return 'Sin ninguna entrega registrada antes de este consumo';
  return `Tenía ${row.availableBefore} ${row.unit} en custodia, consumió ${row.quantity}`;
}
