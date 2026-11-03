/**
 * Validacion pura para vincular una ONT ya existente en olt_onts (importada
 * o no) a un cliente y contrato — ver POST /:id/onts/:ontDbId/link en
 * routes/olt.ts. Nunca toca la OLT (sin VLAN/GEM/PPPoE/perfiles); solo
 * decide si la escritura en Supabase debe proceder. La escritura real usa
 * ADEMAS una condicion WHERE atomica (ver la ruta) y un indice unico
 * parcial en Supabase (olt_onts_contract_id_active_key, migracion
 * 20261103000000) como ultima linea de defensa contra una carrera entre 2
 * solicitudes simultaneas — esta funcion sola no alcanza para eso, decide
 * el caso "sin carrera" antes de llegar a la base.
 */

export interface OntLinkCandidate {
  serial: string;
  client_id: string | null;
  contract_id: string | null;
  retired_at: string | null;
}

export interface ContractLike {
  id: string;
  client_id: string;
  status: string;
}

export interface OntLinkRequest {
  clientId: string;
  contractId: string;
  expectedSerial: string;
}

export type OntLinkDecision =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * `contractOccupiedByAnotherOnt` se calcula aparte (una consulta a
 * olt_onts) porque es la unica comprobacion que necesita leer OTRA fila
 * distinta de `ont`/`contract` — mantenerla como parametro simple deja
 * esta funcion sin I/O, facil de probar con datos sinteticos.
 */
export function validateOntLinkRequest(
  ont: OntLinkCandidate,
  contract: ContractLike | null,
  request: OntLinkRequest,
  contractOccupiedByAnotherOnt: boolean,
): OntLinkDecision {
  if (ont.retired_at) {
    return { ok: false, status: 404, error: 'La ONT no existe o está retirada.' };
  }
  if (ont.client_id || ont.contract_id) {
    return {
      ok: false,
      status: 409,
      error: 'Esta ONT ya está vinculada a un cliente/contrato. Esta acción solo vincula ONTs pendientes, no transfiere un vínculo existente.',
    };
  }
  if (!request.clientId || !request.contractId) {
    return { ok: false, status: 400, error: 'Selecciona un cliente y un contrato.' };
  }
  if (request.expectedSerial.trim().toUpperCase() !== ont.serial.trim().toUpperCase()) {
    return { ok: false, status: 409, error: 'El serial de esta ONT cambió desde que se consultó; recarga e intenta de nuevo.' };
  }
  if (!contract) {
    return { ok: false, status: 404, error: 'El contrato no existe.' };
  }
  if (contract.client_id !== request.clientId) {
    return { ok: false, status: 400, error: 'El contrato seleccionado no pertenece al cliente seleccionado.' };
  }
  if (contract.status === 'cancelled') {
    return { ok: false, status: 400, error: 'El contrato está cancelado; no es elegible para vincular una ONT.' };
  }
  if (contractOccupiedByAnotherOnt) {
    return { ok: false, status: 409, error: 'Ese contrato ya está vinculado a otra ONT activa.' };
  }
  return { ok: true };
}

export function ontLinkAuditRow(params: {
  ontId: string;
  oltDeviceId: string;
  action: 'import' | 'link';
  clientId: string | null;
  contractId: string | null;
  previousClientId: string | null;
  previousContractId: string | null;
  serial: string;
  frame: number;
  slot: number;
  port: number;
  ontNumber: number;
  performedBy: string;
}) {
  return {
    ont_id: params.ontId,
    olt_device_id: params.oltDeviceId,
    action: params.action,
    client_id: params.clientId,
    contract_id: params.contractId,
    previous_client_id: params.previousClientId,
    previous_contract_id: params.previousContractId,
    serial: params.serial,
    position: `${params.frame}/${params.slot}/${params.port}:${params.ontNumber}`,
    performed_by: params.performedBy,
  };
}
