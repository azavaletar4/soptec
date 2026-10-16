import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldInventoryContext, FieldInventoryPage, FieldInventoryView, FieldJobType } from '../types/fieldInventory';

/** Lectura por orden; la autorizacion y la proyeccion pertenecen a SQL, no al navegador. */
export async function readOrderInventory<T>(db: SupabaseClient, actorId: string, jobType: FieldJobType, jobId: string,
  view: FieldInventoryView, isCurrent: () => boolean = () => true) {
  const items: T[] = [];
  let context: FieldInventoryContext | null = null;
  for (let page = 0; page <= 10000; page++) {
    const { data, error } = await db.rpc('inventory_order_read', {
      p_job_type: jobType, p_job_id: jobId, p_view: view, p_page: page,
    });
    if (error) throw Object.assign(new Error(error.message), { status: error.code === '42501' ? 403 : error.code === 'PGRST301' ? 401 : 500 });
    const result = data as FieldInventoryPage<T>;
    if (!isCurrent() || !result || result.context?.actorId !== actorId || result.context.jobType !== jobType || result.context.jobId !== jobId ||
      (context && JSON.stringify(context) !== JSON.stringify(result.context)) || !Array.isArray(result.items) || result.items.length > 100) {
      throw Object.assign(new Error('La sesion o el contexto de la orden cambiaron.'), { status: 403 });
    }
    context = result.context;
    items.push(...result.items);
    if (result.next === null) return { context, items };
    if (result.next !== page + 1) throw Error('Paginacion de inventario invalida.');
  }
  throw Error('No se pudo completar la consulta de la orden.');
}
