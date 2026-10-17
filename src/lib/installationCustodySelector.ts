import type { FieldInventoryContext, FieldInventoryUnit } from '../types/fieldInventory';

export function isInstallableOwnCustody(unit: FieldInventoryUnit, actorId: string, productId: string) {
  return unit.product_id === productId && unit.status === 'with_technician'
    && unit.custody_technician_id === actorId && !!actorId
    && unit.client_id == null && unit.contract_id == null && unit.installation_id == null
    && unit.ticket_id == null && unit.routine_id == null;
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
