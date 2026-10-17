import type { InventoryMovement, InventoryProduct, InventoryUnit } from './domain';

export type FieldJobType = 'installation' | 'ticket' | 'routine';
export interface FieldInventoryContext {
  jobType: FieldJobType;
  jobId: string;
  actorId: string;
  clientId: string | null;
  contractId: string | null;
}
export type FieldInventoryProduct = Pick<InventoryProduct, 'id' | 'name' | 'unit' | 'is_active' | 'is_serialized' | 'current_stock'> & {
  inventory_categories: { slug: string } | null;
};
export type FieldInventoryUnit = Pick<InventoryUnit, 'id' | 'product_id' | 'serial_number' | 'mac_address' | 'status' | 'client_id' | 'contract_id' | 'installation_id' | 'ticket_id' | 'notes'> & {
  custody_technician_id?: string | null;
  routine_id?: string | null;
  product: { id: string; name: string; unit: string; inventory_categories: { slug: string } | null } | null;
};
export type FieldInventoryMovement = Pick<InventoryMovement, 'id' | 'product_id' | 'movement_type' | 'quantity' | 'reason' | 'ticket_id' | 'installation_id' | 'created_at' | 'reverses_movement_id' | 'product'>;
export type FieldInventoryView = 'products' | 'materials' | 'assigned' | 'pending' | 'available' | 'unit-context' | 'linked' | 'events' | 'contracts';
export interface FieldInventoryPage<T> {
  context: FieldInventoryContext;
  items: T[];
  next: number | null;
  warning?: string;
}
