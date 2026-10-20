/**
 * Un rechazo persistido NO es un recibo de consumo confirmado -- pero SI es
 * una respuesta real y definitiva del servidor (nunca una duda de red: para
 * llegar aqui, invoke() ya tuvo que responder sin error). Por eso
 * onRejected() marca la intención pendiente como "rechazo confirmado" en vez
 * de dejarla indistinguible de una operación realmente incierta -- así una
 * cantidad corregida puede intentarse de nuevo sin esperar a "confirmar" la
 * que ya se sabe que no se aplicó. La fila de material_inventory_rejections
 * en el servidor sigue intacta (pendiente de reintento o de anulación
 * administrativa) hasta que se resuelva explícitamente.
 */
export function checkMaterialInventoryOutcome(
  data: unknown,
  callbacks: { onCancelled: () => void; onRejected: () => void },
  expectedOperationId: string,
) {
  if (!data || typeof data !== 'object') return;
  const result = data as { materialRejected?: boolean; materialCancelled?: boolean; message?: string; operationId?: string };
  if ((result.materialRejected || result.materialCancelled) && result.operationId !== expectedOperationId)
    throw new Error('No se pudo verificar el intento de material. Conserva la operación pendiente.');
  if (result.materialCancelled) {
    callbacks.onCancelled();
    throw new Error(result.message || 'Administración anuló el intento equivocado. Revisa los materiales.');
  }
  if (result.materialRejected) {
    callbacks.onRejected();
    throw new Error(result.message || 'El material no se registró por falta de custodia. Corrige la cantidad e intenta de nuevo, o pide a administración que revise este intento antes de cerrar la orden.');
  }
}

/** Prevalidacion antes de fotos/contratos; los triggers siguen siendo la guarda definitiva. */
export async function checkMaterialClosure(invoke: () => PromiseLike<{ error: { code?: string; message: string } | null }>) {
  const { error } = await invoke();
  // Compatible con el servidor previo a la activacion. Cualquier otro fallo se informa.
  if (error && error.code !== 'PGRST202') throw new Error(error.message);
}
