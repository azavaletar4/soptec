/**
 * Fase 3 comercial OLT — al cambiar la zona/NAP de un contrato
 * (ClientServiceDetailView.vue, syncNap), olt_onts.zone_id es un dato
 * independiente que nadie mantenia sincronizado (confirmado: ver
 * ESTADO_DESARROLLO.md 13ac/13ad). Esta funcion decide QUE ont actualizar,
 * de forma inequivoca — nunca por client_id solo (un cliente puede tener
 * mas de un servicio/ONT), siempre por contract_id exacto.
 */

export type OntZoneSyncResolution =
  | { status: 'update'; ontId: string }
  | { status: 'unchanged'; ontId: string }
  | { status: 'skipped_none' }
  | { status: 'skipped_ambiguous'; count: number };

/**
 * `onts` es TODO lo que trajo /onts/by-client/:clientId para el cliente del
 * contrato (puede incluir ONTs de otros servicios del mismo cliente). Solo
 * se actua si hay EXACTAMENTE una ONT con `contract_id` igual al contrato
 * que se esta guardando:
 *  - 0 coincidencias: el contrato todavia no tiene ONT vinculada (normal,
 *    ej. antes de instalar) -> no se toca nada, se reporta para registro.
 *  - 2+ coincidencias: dato ambiguo en si mismo (no deberia pasar nunca
 *    por como trabaja assign_provisioning_nap, pero no se asume) -> no se
 *    toca nada, se reporta para revision manual.
 *  - 1 coincidencia con la MISMA zona ya puesta: nada que hacer.
 *  - 1 coincidencia con otra zona: se marca para actualizar.
 */
export function resolveOntForZoneSync(
  onts: readonly { id: string; contract_id?: string | null; zone_id: string | null }[],
  contractId: string,
  targetZoneId: string | null,
): OntZoneSyncResolution {
  const matches = onts.filter((o) => o.contract_id === contractId);
  if (matches.length === 0) return { status: 'skipped_none' };
  if (matches.length > 1) return { status: 'skipped_ambiguous', count: matches.length };
  const [ont] = matches;
  if (ont.zone_id === targetZoneId) return { status: 'unchanged', ontId: ont.id };
  return { status: 'update', ontId: ont.id };
}

export interface OntZoneSyncOutcome {
  status: 'ok' | 'unchanged' | 'skipped_none' | 'skipped_ambiguous' | 'failed_fetch' | 'failed_update';
  /** Para skipped_ambiguous: cuantas. Para failed_*: el mensaje crudo (sin traducir), para loggear/mostrar. */
  detail?: string | number;
}

interface OntLike {
  id: string;
  olt_device_id: string;
  contract_id?: string | null;
  zone_id: string | null;
}

/**
 * Orquesta el paso completo (consultar ONTs del cliente -> decidir -> en su
 * caso, actualizar) con los efectos de red inyectados — mismo patron que
 * `reserveContractNap` en napAssignment.ts — para poder probar los casos de
 * fallo parcial sin mockear el store de Pinia completo.
 *
 * NUNCA lanza: todo fallo se devuelve como parte del resultado, nunca se
 * presenta como éxito si algo no se pudo completar (requisito explicito:
 * no simular una sincronizacion completa cuando quedo parcial).
 *
 * NO es transaccional con el guardado del contrato/NAP que ya ocurrio antes
 * de llamar esto: son 2 backends distintos (Supabase directo para
 * contrato/NAP, el backend Hono propio para olt_onts) sin una transaccion
 * de BD comun disponible hoy — ver nota mas larga en ClientServiceDetailView.vue.
 */
export async function syncOltZoneForContract(
  deps: {
    fetchOntsByClient: (clientId: string) => Promise<OntLike[]>;
    updateOntMeta: (deviceId: string, ontId: string, payload: { zone_id: string | null }) => Promise<unknown>;
  },
  input: { contractId: string; clientId: string; targetZoneId: string | null },
): Promise<OntZoneSyncOutcome> {
  let onts: OntLike[];
  try {
    onts = await deps.fetchOntsByClient(input.clientId);
  } catch (e) {
    return { status: 'failed_fetch', detail: e instanceof Error ? e.message : String(e) };
  }

  const resolution = resolveOntForZoneSync(onts, input.contractId, input.targetZoneId);
  if (resolution.status === 'skipped_none') return { status: 'skipped_none' };
  if (resolution.status === 'skipped_ambiguous') return { status: 'skipped_ambiguous', detail: resolution.count };
  if (resolution.status === 'unchanged') return { status: 'unchanged' };

  const ont = onts.find((o) => o.id === resolution.ontId);
  if (!ont) return { status: 'skipped_none' }; // defensivo, no deberia pasar

  try {
    await deps.updateOntMeta(ont.olt_device_id, ont.id, { zone_id: input.targetZoneId });
    return { status: 'ok' };
  } catch (e) {
    return { status: 'failed_update', detail: e instanceof Error ? e.message : String(e) };
  }
}
