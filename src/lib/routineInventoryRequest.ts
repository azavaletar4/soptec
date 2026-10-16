export type RoutineInventoryAction = 'consume' | 'correct' | 'remove' | 'install' | 'withdraw' | 'unlink' | 'approve' | 'reject' | 'receive';
export interface RoutineInventoryRequest {
  p_routine_id: string;
  p_operation_id: string;
  p_action: RoutineInventoryAction;
  p_payload: Record<string, unknown>;
}
type RequestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const routineInventoryKey = (actor: string, routine: string) => `routine-inventory:v1:${actor}:${routine}`;
export function pendingRoutineInventory(storage: RequestStorage, actor: string, routine: string): RoutineInventoryRequest | null {
  const raw = storage.getItem(routineInventoryKey(actor, routine));
  if (!raw) return null;
  const request = JSON.parse(raw) as RoutineInventoryRequest;
  if (request.p_routine_id !== routine || !request.p_operation_id || !request.p_action || !request.p_payload) throw new Error('Operación pendiente inválida; solicita revisión antes de registrar otra.');
  return request;
}
/** Persist before sending; an uncertain response must be resolved with the same UUID. */
export async function executeRoutineInventory(
  storage: RequestStorage, actor: string, routine: string,
  action: RoutineInventoryAction, payload: Record<string, unknown>,
  invoke: (request: RoutineInventoryRequest) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>,
  uuid: () => string = () => crypto.randomUUID(),
) {
  const key = routineInventoryKey(actor, routine);
  const pending = pendingRoutineInventory(storage, actor, routine);
  if (pending && (pending.p_action !== action || JSON.stringify(pending.p_payload) !== JSON.stringify(payload))) {
    throw new Error('Resuelve primero la operación pendiente; no se puede cambiar su contenido.');
  }
  const request = pending ?? { p_routine_id: routine, p_operation_id: uuid(), p_action: action, p_payload: payload };
  storage.setItem(key, JSON.stringify(request));
  const { data, error } = await invoke(request);
  if (error) {
    // Puede ser la recuperación de una respuesta ya confirmada y perdida.
    // Un conflicto de lock no permite olvidar el UUID y consumir otra vez.
    if (error.code === '55P03') {
      throw new Error('Hay otra operación en curso sobre esta rutina. Reintenta la operación pendiente de forma segura.');
    }
    // El error revierte este intento, no un posible COMMIT anterior cuya
    // respuesta se perdió. Una recuperación pendiente conserva su identidad.
    if (!pending && error.code && /^[0-9A-Z]{5}$/.test(error.code)) storage.removeItem(key);
    throw new Error(error.message);
  }
  storage.removeItem(key);
  return data;
}
