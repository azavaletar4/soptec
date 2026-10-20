import type { FieldInventoryContext, FieldInventoryUnit } from '../types/fieldInventory';
import type { MyInventoryCustody } from '../types/domain';

export function isInstallableOwnCustody(unit: FieldInventoryUnit, actorId: string, productId: string) {
  return unit.product_id === productId && unit.status === 'with_technician'
    && unit.custody_technician_id === actorId && !!actorId
    && unit.client_id == null && unit.contract_id == null && unit.installation_id == null
    && unit.ticket_id == null && unit.routine_id == null;
}

/**
 * Altas: que modelos serializados mostrar en el selector de "Equipos
 * asignados" -- solo los que el tecnico autenticado tiene realmente
 * disponibles en su propia custodia (my_inventory_custody().units, ya
 * cargado para materiales). Mismo criterio que el servidor usa para
 * 'available' en instalaciones (status='with_technician', sin orden/
 * cliente vinculado): 'pending_return' se excluye a proposito -- el
 * tecnico ya pidio devolverlo, no deberia instalarlo. Solo UX: la
 * seleccion de series/MAC sigue pasando por isInstallableOwnCustody y
 * la RPC vuelve a validar todo bajo bloqueo antes de asignar.
 */
export function installableEquipmentModelIds(units: MyInventoryCustody['units']): Set<string> {
  return new Set(units.filter(u => u.status === 'with_technician').map(u => u.product.id));
}

/** Sin persistencia. Cada lectura invalida la anterior; sesión/producto/contexto viejos no publican datos. */
export function createInstallationCustodySelector(options: {
  read: (context: FieldInventoryContext, productId: string) => Promise<FieldInventoryUnit[]>;
  isCurrent: (context: FieldInventoryContext, productId: string) => boolean;
  clear: () => void; publish: (units: FieldInventoryUnit[]) => void;
  loading: (value: boolean) => void; error: (error: unknown) => void;
}) {
  let generation = 0;
  function invalidate() { generation++; options.clear(); options.loading(false); }
  function accept(context: FieldInventoryContext, productId: string, units: FieldInventoryUnit[]) {
    invalidate();
    if (context.jobType !== 'installation' || !options.isCurrent(context, productId)) return false;
    options.publish(units.filter(unit => isInstallableOwnCustody(unit, context.actorId, productId)));
    return true;
  }
  async function load(context: FieldInventoryContext, productId: string) {
    invalidate(); const request = generation;
    if (context.jobType !== 'installation' || !productId || !options.isCurrent(context, productId)) return false;
    options.loading(true);
    try {
      const units = await options.read(context, productId);
      if (request !== generation || !options.isCurrent(context, productId)) return false;
      options.publish(units.filter(unit => isInstallableOwnCustody(unit, context.actorId, productId)));
      return true;
    } catch (error) {
      if (request === generation && options.isCurrent(context, productId)) { options.clear(); options.error(error); }
      return false;
    } finally { if (request === generation) options.loading(false); }
  }
  return { load, invalidate, accept };
}
