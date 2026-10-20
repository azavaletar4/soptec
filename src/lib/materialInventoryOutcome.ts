/** Un rechazo persistido NO es un recibo de consumo confirmado. */
export function checkMaterialInventoryOutcome(data: unknown, clearCancelled: () => void, expectedOperationId: string) {
  if (!data || typeof data !== 'object') return;
  const result = data as { materialRejected?: boolean; materialCancelled?: boolean; message?: string; operationId?: string };
  if ((result.materialRejected || result.materialCancelled) && result.operationId !== expectedOperationId)
    throw new Error('No se pudo verificar el intento de material. Conserva la operación pendiente.');
  if (result.materialCancelled) {
    clearCancelled();
    throw new Error(result.message || 'Administración anuló el intento equivocado. Revisa los materiales.');
  }
  if (result.materialRejected) throw new Error(result.message || 'El material no se registró por falta de custodia. Solicita la entrega y reintenta la operación pendiente antes de cerrar.');
}

/** Prevalidacion antes de fotos/contratos; los triggers siguen siendo la guarda definitiva. */
export async function checkMaterialClosure(invoke: () => PromiseLike<{ error: { code?: string; message: string } | null }>) {
  const { error } = await invoke();
  // Compatible con el servidor previo a la activacion. Cualquier otro fallo se informa.
  if (error && error.code !== 'PGRST202') throw new Error(error.message);
}
