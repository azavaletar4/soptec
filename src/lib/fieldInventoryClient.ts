import type { FieldInventoryContext, FieldInventoryPage, FieldInventoryUnit, FieldInventoryView } from '../types/fieldInventory';

type Get = (path: string) => Promise<unknown>;
const sameContext = (a: FieldInventoryContext, b: FieldInventoryContext) =>
  (['jobType', 'jobId', 'actorId', 'clientId', 'contractId'] as const).every(key => a?.[key] === b[key]);
export function createFieldInventoryClient(get: Get, isCurrent: (context: FieldInventoryContext) => boolean = () => true) {
  async function read<T>(context: FieldInventoryContext, view: FieldInventoryView, parameters: Record<string, string> = {}) {
    let page = 0;
    const items: T[] = [];
    let warning: string | undefined;
    do {
      const query = new URLSearchParams({ ...parameters, page: String(page) });
      const result = await get(`/api/campo-inventory/${context.jobType}/${encodeURIComponent(context.jobId)}/${view}?${query}`) as FieldInventoryPage<T>;
      if (!result || !sameContext(result.context, context) || !isCurrent(context)) throw Error('La orden o su asignación cambió. Actualiza la pantalla antes de continuar.');
      items.push(...result.items);
      warning = result.warning ?? warning;
      if (result.next === null) break;
      if (result.next !== page + 1 || result.next > 10000) throw Error('No se pudo completar la lectura del inventario.');
      page = result.next;
    } while (page <= 10000);
    return { items, warning };
  }
  async function performUnitAction<T>(context: FieldInventoryContext, unitId: string, action: 'unassign' | 'unlink', existingWrite: (verified: FieldInventoryContext) => Promise<T>) {
    const result = await read<FieldInventoryUnit>(context, 'unit-context', { unitId, action });
    if (result.items.length !== 1 || result.items[0]?.id !== unitId) throw Error('El equipo no corresponde a la orden.');
    // Delegar una sola vez. No agregar job_id al evento: alteraría la escritura existente.
    return existingWrite(context);
  }
  return { read, performUnitAction };
}
