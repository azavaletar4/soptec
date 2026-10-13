/**
 * Fase 3 comercial OLT — al cambiar la zona/NAP de un contrato
 * (ClientServiceDetailView.vue, syncNap), olt_onts.zone_id es un dato
 * independiente que nadie mantenia sincronizado (confirmado: ver
 * ESTADO_DESARROLLO.md 13ac/13ad). Esta funcion decide QUE ont actualizar,
 * de forma inequivoca — nunca por client_id solo (un cliente puede tener
 * mas de un servicio/ONT), siempre por contract_id exacto.
 */

/**
 * Fase 3 comercial OLT — Fase C (automatizacion de traslados desde App
 * Campo, ver ESTADO_DESARROLLO.md 13am): mismos 3 roles que ya exige la
 * propia funcion SQL `assign_contract_nap_sync_ont_zone` (Fase 158) —
 * centralizado aqui para que ClientServiceDetailView.vue (panel web) y
 * campo.ts (App Campo) usen EXACTAMENTE la misma lista, nunca 2 copias
 * que puedan desincronizarse.
 */
export const OLT_ZONE_SYNC_ROLES = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] as const;
export function canSyncOltZone(role: string | null | undefined): boolean {
  return (OLT_ZONE_SYNC_ROLES as readonly string[]).includes(role ?? '');
}

/**
 * Revisión puntual (2026-10-13, Fase 159, punto 2): decide si un cierre
 * puede usar la vía TRANSACCIONAL de Fase 158 (NAP + zona de la ONT en la
 * OLT) — nunca cuando `ontReplaced` es true, sin importar el rol ni el
 * tipo de trabajo. Extraída a función pura para que la garantía de "ONT
 * reemplazada jamás dispara una sincronización automática contra la OLT"
 * (requisito explícito: "no automatizar cambios físicos en OLT") sea
 * verificable con una prueba, no solo una condición inline en campo.ts.
 */
export function shouldUseTransactionalNapSync(input: {
  jobType: string;
  ontReplaced: boolean;
  role: string | null | undefined;
}): boolean {
  return input.jobType !== 'installation' && !input.ontReplaced && canSyncOltZone(input.role);
}

/** Forma del 3er valor que devuelve assign_contract_nap_sync_ont_zone (ver reportOltZoneSync en ClientServiceDetailView.vue). */
export interface OntZoneRpcResult {
  ontZoneSynced: boolean;
  ontZoneSkipReason: string | null;
}

/**
 * Traduce el resultado crudo de la via transaccional (Fase 158) a un
 * mensaje para mostrarle a quien cerro el trabajo (tecnico o admin) —
 * null significa "nada que avisar": ya sincronizado, o el contrato
 * todavia no tiene ninguna ONT vinculada (caso normal antes de una
 * Alta, no es un error). `ambiguo:N` SI se avisa siempre — es un dato
 * real que necesita revision manual, nunca se calla.
 */
export function describeOntZoneSyncOutcome(result: OntZoneRpcResult | null): string | null {
  if (!result || result.ontZoneSynced) return null;
  if (!result.ontZoneSkipReason || result.ontZoneSkipReason === 'sin_ont_vinculada') return null;
  if (result.ontZoneSkipReason.startsWith('ambiguo:')) {
    const count = result.ontZoneSkipReason.split(':')[1] ?? '2+';
    return `Este contrato tiene ${count} ONTs vinculadas en la OLT — no se actualizó ninguna zona automáticamente. Pide a un administrador que lo revise en el panel OLT.`;
  }
  return `No se pudo confirmar la zona de la ONT en la OLT (${result.ontZoneSkipReason}) — pide a un administrador que lo revise.`;
}

/**
 * Zona "confirmada" a aplicar al cerrar un trabajo de campo: la que el
 * tecnico eligio explicitamente (instalaciones, siempre la pide) o, si
 * no hay una explicita pero SI eligio una caja NAP (traslados/
 * recableados de un ticket, que no tienen selector de zona propio), la
 * zona de ESA caja — nunca se le pide el mismo dato 2 veces (y pedirlo
 * 2 veces podria hacer que se contradigan entre si, el motivo real de
 * los `mismatch` de la Fase B). Sin zona explicita y sin NAP -> null,
 * no hay nada confirmado que sincronizar.
 */
export function resolveClosureTargetZoneId(input: {
  explicitZoneId: string | null;
  napElementoId: string | null;
  napZoneId: string | null;
}): string | null {
  if (input.explicitZoneId) return input.explicitZoneId;
  if (input.napElementoId && input.napZoneId) return input.napZoneId;
  return null;
}

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
