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

export interface NapAndOntZoneResult {
  napPortId: string;
  ontZoneSynced: boolean;
  /** 'sin_ont_vinculada' | 'ambiguo:<N>' | null (sincronizada u OK). */
  ontZoneSkipReason: string | null;
}

/**
 * Fase 158 — una sola transaccion de Postgres reserva la NAP Y sincroniza
 * olt_onts.zone_id de la ONT inequivocamente vinculada por contract_id
 * (ver supabase/migrations/20261013160000_fase158_*). Si cualquiera de
 * las 2 partes falla, AMBAS se revierten — nunca queda la NAP reservada
 * con la zona de la ONT desactualizada, ni al revés. Restringida en el
 * propio SQL a SUPERADMIN/ADMIN/TECNICO_RED — llamarla con otro rol
 * lanza "No tienes permisos para esta accion", igual que cualquier otro
 * error de la funcion (misma semantica de reintento que reserveContractNap).
 */
export async function reserveContractNapSyncOntZone(
  rpc: (name: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  input: NapAssignmentInput,
): Promise<NapAndOntZoneResult> {
  if (!input.napId || !input.contractId || !input.clientId) throw new Error('Selecciona NAP, contrato y cliente');
  let result;
  try {
    result = await rpc('assign_contract_nap_sync_ont_zone', {
      p_nap_id: input.napId, p_contract_id: input.contractId, p_client_id: input.clientId,
    });
  } catch {
    throw new Error('No se pudo confirmar la reserva NAP; consulta antes de reintentar');
  }
  if (result.error) {
    if (/^[0-9A-Z]{5}$/.test(result.error.code ?? '')) {
      throw new Error('No se pudo reservar la NAP; la asignación anterior (NAP y zona de la ONT) se conserva: ' + result.error.message);
    }
    throw new Error('No se pudo confirmar la reserva NAP; consulta antes de reintentar');
  }
  // La función devuelve TABLE(...) — el cliente de Supabase resuelve `data` como un array de filas.
  const row = (Array.isArray(result.data) ? result.data[0] : undefined) as Record<string, unknown> | undefined;
  if (!row || typeof row.nap_port_id !== 'string' || !row.nap_port_id) {
    throw new Error('No se pudo confirmar la reserva NAP; consulta antes de reintentar');
  }
  return {
    napPortId: row.nap_port_id,
    ontZoneSynced: row.ont_zone_synced === true,
    ontZoneSkipReason: typeof row.ont_zone_skip_reason === 'string' && row.ont_zone_skip_reason ? row.ont_zone_skip_reason : null,
  };
}
