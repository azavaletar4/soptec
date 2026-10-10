export interface NapAssignmentInput { napId: string; contractId: string; clientId: string }
/** One database transaction reserves the destination before releasing the old port. */
export async function reserveContractNap(
  rpc: (name: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  input: NapAssignmentInput,
): Promise<string> {
  if (!input.napId || !input.contractId || !input.clientId) throw new Error('Selecciona NAP, contrato y cliente');
  let result;
  try {
    result = await rpc('assign_contract_nap', {
      p_nap_id: input.napId, p_contract_id: input.contractId, p_client_id: input.clientId,
    });
  } catch {
    throw new Error('No se pudo confirmar la reserva NAP; consulta antes de reintentar');
  }
  if (result.error) {
    if (/^[0-9A-Z]{5}$/.test(result.error.code ?? '')) {
      throw new Error('No se pudo reservar la NAP; la asignación anterior se conserva: ' + result.error.message);
    }
    throw new Error('No se pudo confirmar la reserva NAP; consulta antes de reintentar');
  }
  if (typeof result.data !== 'string' || !result.data) throw new Error('No se pudo confirmar la reserva NAP; consulta antes de reintentar');
  return result.data;
}
