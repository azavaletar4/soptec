import { supabase } from '@/lib/supabase';
import type { JobType } from '@/types/domain';

export const FINAL_ORDER_MESSAGE = 'Cierre administrativo definitivo: no se puede modificar ni reabrir esta orden. Crea una nueva orden para una incidencia nueva.';

/**
 * Rechazo DEFINITIVO (la orden ya fue confirmada administrativamente) — a
 * diferencia de un fallo transitorio (red, sesión, 5xx), reintentar este
 * envío nunca va a funcionar. La cola offline (offlineQueue.ts) distingue
 * este tipo por `instanceof` en vez de comparar el texto del mensaje, para
 * no depender de que nadie mantenga el mensaje sincronizado en dos archivos.
 */
export class WorkOrderFinalError extends Error {
  constructor() {
    super(FINAL_ORDER_MESSAGE);
    this.name = 'WorkOrderFinalError';
  }
}

export async function workOrderIsFinal(jobType: JobType, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('work_order_is_final', { p_job_type: jobType, p_job_id: jobId });
  if (error) throw error;
  if (typeof data !== 'boolean') throw new Error('No se pudo verificar el cierre administrativo.');
  return data;
}

export async function assertWorkOrderMutable(jobType: JobType, jobId: string) {
  if (await workOrderIsFinal(jobType, jobId)) throw new WorkOrderFinalError();
}
