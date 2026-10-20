import type { FieldInventoryContext } from '../types/fieldInventory';
import { checkMaterialInventoryOutcome } from './materialInventoryOutcome';

export type FieldInventoryAction = 'consume' | 'kit' | 'correct' | 'reverse' | 'assign' | 'unassign' | 'stage' | 'return' | 'unlink' | 'approve' | 'reject';
export interface FieldInventoryRequest {
  p_operation_id: string; p_job_type: string; p_job_id: string;
  p_action: FieldInventoryAction; p_payload: Record<string, unknown>;
}
export interface FieldInventoryReceipt {
  operationId: string; jobType: string; jobId: string; action: string; ids: string[]; at: string;
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Invoke = (request: FieldInventoryRequest) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const keyFor = (c: FieldInventoryContext, namespace: string) => `${namespace}:${c.actorId}:${c.jobType}:${c.jobId}`;
const rejectedKeyFor = (key: string) => `${key}:rejected`;
const actions = ['consume','kit','correct','reverse','assign','unassign','stage','return','unlink','approve','reject'];
export function pendingFieldInventory(storage: Store, context: FieldInventoryContext, namespace = 'campo-inventory:v1'): FieldInventoryRequest | null {
  const raw = storage.getItem(keyFor(context, namespace));
  if (!raw) return null;
  const request = JSON.parse(raw) as FieldInventoryRequest;
  if (request.p_job_type !== context.jobType || request.p_job_id !== context.jobId || !request.p_operation_id ||
      !actions.includes(request.p_action) || !request.p_payload || typeof request.p_payload !== 'object') {
    throw Error('La operación pendiente requiere revisión; no se enviará otra.');
  }
  return request;
}
/** Persistir antes del envío; también los errores conservan la intención hasta resolverla. */
export async function executeFieldInventory(storage: Store, context: FieldInventoryContext,
  action: FieldInventoryAction, payload: Record<string, unknown>, invoke: Invoke,
  uuid: () => string = () => crypto.randomUUID(),
  namespace = 'campo-inventory:v1',
) {
  const key = keyFor(context, namespace), rejectedKey = rejectedKeyFor(key);
  const pending = pendingFieldInventory(storage, context, namespace);
  const isConfirmedRejection = !!pending && storage.getItem(rejectedKey) === pending.p_operation_id;
  const samePending = !!pending && pending.p_action === action && JSON.stringify(pending.p_payload) === JSON.stringify(payload);
  // Un rechazo YA CONFIRMADO (nunca una duda de red, ver materialInventoryOutcome.ts)
  // admite corregir la cantidad/items con la MISMA clave -- el servidor
  // (execute_tracked_material_inventory) acepta ese cambio puntual porque
  // la operacion original jamas aplico nada. Solo una pendiente todavia
  // incierta sigue bloqueando una intencion distinta.
  const canCorrect = !!pending && isConfirmedRejection && pending.p_action === action;
  if (pending && !samePending && !canCorrect) {
    throw Error('Hay una operación pendiente. Confírmala antes de registrar otra.');
  }
  const request = samePending ? pending
    : canCorrect ? { ...pending, p_payload: payload }
    : { p_operation_id: uuid(), p_job_type: context.jobType, p_job_id: context.jobId, p_action: action, p_payload: payload };
  storage.setItem(key, JSON.stringify(request));
  if (!samePending) storage.removeItem(rejectedKey); // se reintenta (igual o corregido): el resultado vuelve a estar por confirmar
  const { data, error } = await invoke(request);
  if (error) {
    // Un primer intento con SQLSTATE confirma rollback. Un intento ya incierto
    // nunca se descarta: pudo confirmarse antes de una revocación o cierre.
    if (!pending && error.code && /^[0-9A-Z]{5}$/.test(error.code) && storage.getItem(key) === JSON.stringify(request)) storage.removeItem(key);
    if (error.code === '55P03') {
      throw Error('Hay otra operación en curso. Puedes reintentarlo de forma segura. Si hay una operación pendiente, usa «Confirmar operación de inventario pendiente».');
    }
    throw Error(error.message);
  }
  checkMaterialInventoryOutcome(data, {
    onCancelled: () => { storage.removeItem(key); storage.removeItem(rejectedKey); },
    onRejected: () => { if (storage.getItem(key) === JSON.stringify(request)) storage.setItem(rejectedKey, request.p_operation_id); },
  }, request.p_operation_id);
  const receipt = data as FieldInventoryReceipt;
  if (!receipt || receipt.operationId !== request.p_operation_id || receipt.jobType !== context.jobType ||
      receipt.jobId !== context.jobId || receipt.action !== action || !Array.isArray(receipt.ids) || !receipt.at) {
    throw Error('No se pudo confirmar el resultado; conserva la operación pendiente.');
  }
  if (storage.getItem(key) === JSON.stringify(request)) { storage.removeItem(key); storage.removeItem(rejectedKey); }
  return receipt;
}
