/** Solo el módulo administrativo; no usar esta guarda en operaciones de Campo. */
export const INVENTORY_ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];

export function canAccessAdministrativeInventory(role: string | null | undefined): boolean {
  return typeof role === 'string' && INVENTORY_ADMIN_ROLES.includes(role);
}

export class InventoryAccessError extends Error {
  readonly code = 'INVENTORY_ADMIN_REQUIRED';
  constructor() {
    super('Solo Administración puede acceder al inventario general.');
    this.name = 'InventoryAccessError';
  }
}

export function assertAdministrativeInventoryAccess(role: string | null | undefined): void {
  if (!canAccessAdministrativeInventory(role)) throw new InventoryAccessError();
}
