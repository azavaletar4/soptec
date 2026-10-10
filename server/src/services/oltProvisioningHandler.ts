import {
  provisionOnt,
  runProvisioningPipeline,
  isOltStageOk,
  isPipelineComplete,
  type ProvisionDeps,
  type ProvisionParams,
  type ProvisionOutcome,
} from './oltProvisioningService';
import type { PppoeReference } from './provisioningContract';
import { withOltLock as withOperationLock } from './oltTelnetLock';
import type { ProvisioningStore, ProvisioningOperationRow, OntRow, NewOperationInput } from './oltProvisioningStore';

/**
 * Orquestacion de "Autorizar y Activar" (Fase 2, correccion de revision
 * externa) — unifica lo que antes eran dos bloques casi idénticos en
 * routes/olt.ts (POST /provision y POST /reconcile): ambos ahora llaman a
 * `runProvisionAndPipeline` sobre una `ProvisioningOperationRow` ya resuelta,
 * la diferencia es solo COMO se llega a esa fila (crear/reusar vs releer una
 * existente).
 *
 * Separado de las rutas Hono para poder probarlo con un store/mikrotik/wan
 * FALSOS (ver __tests__/oltProvisioningHandler.test.ts) sin necesitar
 * Supabase real ni un servidor Hono real — solo el motor de OLT sigue
 * usando el simulador de Telnet (fakeOltCli.ts) ya construido en la Fase 2.
 */

export interface ProvisionRequestBody {
  idempotencyKey: string;
  shelf?: number;
  slot: number;
  port: number;
  serial: string;
  onuType: string;
  description?: string;
  vlan: number;
  tcontProfile: string;
  trafficProfile: string;
  onuId?: number;
  clientId?: string | null;
  contractId?: string | null;
  zoneId?: string | null;
  napId?: string | null;
  mikrotik?: { deviceId: string; secretMode: string; profile: string; newSecretName?: string; existingSecretId?: string; existingSecretName?: string };
  pppoeReference?: PppoeReference;
  wan?: { username: string; vlanProfile: string };
}

export interface ProvisionHandlerDeps {
  store: ProvisioningStore;
  deviceId: string;
  withOltLock: <T>(fn: () => Promise<T>) => Promise<T>;
  runTelnet: (commands: string[], opts?: { timeoutMs?: number }) => Promise<string[]>;
  /**
   * Si el caller pidio MikroTik (secreto PPPoE), ya construida — nunca debe
   * cerrar sobre una contraseña que luego se filtre a un mensaje de error
   * persistido (ver sanitizeStageDetail abajo, que igual la redacta por si
   * acaso). Si no se pidio, undefined (etapa no aplica, no "pendiente").
   */
  syncMikrotik?: () => Promise<void>;
  syncLinks?: () => Promise<void>;
  preflight: () => Promise<void>;
  sensitiveValues?: string[];
  /**
   * Si el caller pidio WAN/PPPoE por OMCI, fabrica la funcion real una vez
   * que se conoce el onu-id resuelto (nunca antes de que la OLT lo confirme).
   */
  buildSyncWan?: (onuId: number) => () => Promise<void>;
  /** Notifica a quien este escuchando (SSE) que una ONT cambio — opcional, no-op en pruebas. */
  onOntChanged?: (ont: OntRow) => void;
}

export interface ProvisionHandlerResult {
  httpStatus: number;
  error?: string;
  operation?: ProvisioningOperationRow;
  outcome?: ProvisionOutcome;
  ont?: OntRow | null;
  mikrotikOk?: boolean;
  mikrotikError?: string;
  wanOk?: boolean;
  wanError?: string;
  /** Presente SOLO si algun UPDATE/INSERT de este request fallo — la respuesta nunca afirma "guardado" cuando esto esta presente. */
  persistenceWarning?: string;
}

/** Nunca persistir una contraseña en un mensaje de error/detalle — defensa adicional por si un error de MikroTik/WAN la repite tal cual. */
function redactPotentialSecrets(message: string): string {
  return message.replace(/(password["\s:=]+)\S+/gi, '$1[REDACTED]').replace(/(contrase[ñn]a["\s:=]+)\S+/gi, '$1[REDACTED]');
}

export function outcomeToOperationStatus(outcome: ProvisionOutcome): string {
  switch (outcome.kind) {
    case 'registered':
    case 'already_registered':
      return 'olt_registered';
    case 'verify_mismatch':
      return 'olt_verify_failed';
    case 'verify_uncertain':
    case 'uncertain':
      return 'olt_uncertain';
    default:
      return 'failed';
  }
}

export function outcomeErrorMessage(outcome: ProvisionOutcome): string | null {
  switch (outcome.kind) {
    case 'rejected':
    case 'uncertain':
    case 'verify_uncertain':
    case 'invalid':
    case 'scan_unreliable':
      return outcome.message;
    case 'capacity_full':
      return 'No quedan onu-id libres en ese puerto (capacidad del puerto agotada)';
    case 'conflict_elsewhere':
      return `El serial ya esta registrado en gpon-onu_${outcome.at.shelf}/${outcome.at.slot}/${outcome.at.port}:${outcome.at.onuId} — no se toco nada`;
    case 'conflict_same_position_different_config':
      return `Ya existe una ONU distinta (o una config parcial) en esa misma posicion (onu-id ${outcome.onuId}) — no se sobreescribio`;
    case 'verify_mismatch':
      return `La OLT quedo con datos distintos a los solicitados: ${outcome.mismatches.map((m) => m.field).join(', ')}`;
    default:
      return null;
  }
}

/** Identidad INMUTABLE de una solicitud — dos peticiones con la misma idempotencyKey deben coincidir en todo esto, o se reportan como conflicto antes de tocar la OLT (requisito 2 de la revision externa). */
interface RequestIdentity {
  serial: string;
  frame: number;
  slot: number;
  port: number;
  onuType: string;
  vlan: number;
  tcontProfile: string;
  trafficProfile: string;
  forcedOnuId: number | null;
  description: string;
  clientId: string | null;
  contractId: string | null;
  zoneId: string | null;
  napId: string | null;
  mikrotik: ProvisionRequestBody['mikrotik'] | null;
  pppoeReference: PppoeReference | null;
  wan: ProvisionRequestBody['wan'] | null;
}

function identityFromBody(body: ProvisionRequestBody): RequestIdentity {
  return {
    serial: (body.serial ?? '').trim().toUpperCase(),
    frame: body.shelf ?? 1,
    slot: body.slot,
    port: body.port,
    onuType: body.onuType ?? '',
    vlan: body.vlan,
    tcontProfile: body.tcontProfile ?? '',
    trafficProfile: body.trafficProfile ?? '',
    forcedOnuId: body.onuId ?? null,
    description: body.description ?? '',
    clientId: body.clientId ?? null,
    contractId: body.contractId ?? null,
    zoneId: body.zoneId ?? null,
    napId: body.napId ?? null,
    mikrotik: body.mikrotik ?? null,
    pppoeReference: body.pppoeReference ?? null,
    wan: body.wan ?? null,
  };
}

function identityFromOperation(op: ProvisioningOperationRow): RequestIdentity {
  const requested = op.requested ?? {};
  return {
    serial: (op.serial ?? '').trim().toUpperCase(),
    frame: op.frame,
    slot: op.slot,
    port: op.port,
    onuType: String(requested.onuType ?? ''),
    vlan: Number(requested.vlan ?? 0),
    tcontProfile: String(requested.tcontProfile ?? ''),
    trafficProfile: String(requested.trafficProfile ?? ''),
    forcedOnuId: typeof requested.forcedOnuId === 'number' ? requested.forcedOnuId : null,
    description: String(requested.description ?? ''),
    clientId: op.client_id,
    contractId: op.contract_id,
    zoneId: typeof requested.zoneId === 'string' ? requested.zoneId : null,
    napId: typeof requested.napId === 'string' ? requested.napId : null,
    mikrotik: (requested.mikrotik as ProvisionRequestBody['mikrotik']) ?? null,
    pppoeReference: (requested.pppoeReference as PppoeReference) ?? null,
    wan: (requested.wan as ProvisionRequestBody['wan']) ?? null,
  };
}

function canonical(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter(k => obj[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

function identityMatches(a: RequestIdentity, b: RequestIdentity): boolean {
  return canonical(a) === canonical(b);
}

function validateBody(body: ProvisionRequestBody): string | null {
  if (!body.clientId?.trim() || !body.contractId?.trim()) return 'Cliente y contrato son obligatorios para una nueva autorización';
  if (body.mikrotik && body.mikrotik.secretMode !== 'existing') return 'Autorizar una ONU no crea credenciales PPPoE';
  if (!body.idempotencyKey || !body.idempotencyKey.trim()) return 'idempotencyKey es requerido';
  if (body.slot == null || body.port == null) return 'slot y port son requeridos';
  if (!body.serial || !body.serial.trim()) return 'serial es requerido';
  if (!body.tcontProfile || !body.trafficProfile) {
    return 'tcontProfile y trafficProfile son requeridos (ver "show gpon profile tcont/traffic" en la OLT)';
  }
  return null;
}

/**
 * Punto de entrada para POST /:id/onts/provision — resuelve (o crea, a
 * prueba de carreras) la fila de operacion para esta idempotencyKey, y
 * delega a runProvisionAndPipeline.
 */
// Same single-process deployment constraint as oltTelnetLock. Lock the
// whole operation, including DB/MikroTik/WAN; the OLT lock alone is insufficient.
export async function handleProvisionRequest(deps: ProvisionHandlerDeps, body: ProvisionRequestBody): Promise<ProvisionHandlerResult> {
  return withOperationLock(`provisioning:${deps.deviceId}`, () => handleProvisionLocked(deps, body));
}

async function handleProvisionLocked(deps: ProvisionHandlerDeps, body: ProvisionRequestBody): Promise<ProvisionHandlerResult> {
  const validationError = validateBody(body);
  if (validationError) return { httpStatus: 400, error: validationError };

  const idempotencyKey = body.idempotencyKey.trim();
  const incomingIdentity = identityFromBody(body);

  const existing = await deps.store.findOperationByKey(deps.deviceId, idempotencyKey);
  if (existing.error) return { httpStatus: 500, error: `No se pudo consultar la operacion existente: ${existing.error}` };

  let operation: ProvisioningOperationRow;
  let preflightChecked = false;

  if (existing.data) {
    if (!identityMatches(identityFromOperation(existing.data), incomingIdentity)) {
      return {
        httpStatus: 409,
        error:
          'Esta clave de idempotencia ya se uso para una solicitud con datos distintos (serial/posicion/VLAN/perfiles) — no se toco la OLT. Si es una solicitud realmente nueva, usa una clave de idempotencia distinta.',
      };
    }
    operation = existing.data;
  } else {
    try { await deps.preflight(); preflightChecked = true; }
    catch (e) { return { httpStatus: 400, error: e instanceof Error ? e.message : 'Vínculo inválido' }; }
    const insertInput: NewOperationInput = {
      idempotency_key: idempotencyKey,
      olt_device_id: deps.deviceId,
      serial: incomingIdentity.serial,
      frame: body.shelf ?? 1,
      slot: body.slot,
      port: body.port,
      client_id: body.clientId ?? null,
      contract_id: body.contractId ?? null,
      requested: {
        onuType: body.onuType,
        vlan: body.vlan,
        tcontProfile: body.tcontProfile,
        trafficProfile: body.trafficProfile,
        description: body.description ?? '',
        forcedOnuId: body.onuId ?? null,
        zoneId: body.zoneId ?? null,
        napId: body.napId ?? null,
        mikrotik: body.mikrotik ?? null,
        pppoeReference: body.pppoeReference ?? null,
        wan: body.wan ?? null,
      },
    };
    const inserted = await deps.store.insertOperation(insertInput);

    if (inserted.duplicateKey) {
      // Carrera real: dos solicitudes concurrentes con la MISMA clave —
      // otra ya inserto la fila entre nuestro findOperationByKey (que no la
      // vio) y este insert. Se relee en vez de tratarlo como un error: el
      // historial de la fila ganadora sigue intacto (nunca se pierde una
      // etapa por esto, ver appendStep atomico en oltProvisioningStore.ts).
      const refetched = await deps.store.findOperationByKey(deps.deviceId, idempotencyKey);
      if (refetched.error || !refetched.data) {
        return { httpStatus: 500, error: `Conflicto de solicitudes concurrentes y no se pudo releer la operacion: ${refetched.error ?? 'no encontrada'}` };
      }
      if (!identityMatches(identityFromOperation(refetched.data), incomingIdentity)) {
        return {
          httpStatus: 409,
          error: 'Esta clave de idempotencia ya se uso (por una solicitud concurrente) para datos distintos — no se toco la OLT.',
        };
      }
      operation = refetched.data;
    } else if (inserted.error || !inserted.data) {
      return { httpStatus: 500, error: `No se pudo registrar la operacion: ${inserted.error}` };
    } else {
      operation = inserted.data;
    }
  }

  if (operation.status === 'completed') {
    return completedOperationResult(deps, operation);
  }

  return runProvisionAndPipeline(deps, operation, preflightChecked);
}

/** Punto de entrada para POST /:id/onts/operations/:opId/reconcile. */
export async function handleReconcileRequest(deps: ProvisionHandlerDeps, operationId: string): Promise<ProvisionHandlerResult> {
  return withOperationLock(`provisioning:${deps.deviceId}`, () => handleReconcileLocked(deps, operationId));
}

async function handleReconcileLocked(deps: ProvisionHandlerDeps, operationId: string): Promise<ProvisionHandlerResult> {
  const existing = await deps.store.findOperationById(operationId, deps.deviceId);
  if (existing.error) return { httpStatus: 500, error: `No se pudo consultar la operacion: ${existing.error}` };
  if (!existing.data) return { httpStatus: 404, error: 'Operacion no encontrada' };

  if (existing.data.status === 'completed') {
    return completedOperationResult(deps, existing.data);
  }

  return runProvisionAndPipeline(deps, existing.data);
}

async function completedOperationResult(deps: ProvisionHandlerDeps, operation: ProvisioningOperationRow): Promise<ProvisionHandlerResult> {
  const outcome: ProvisionOutcome = { kind: 'already_registered', onuId: operation.onu_id ?? 0 };
  if (!operation.ont_db_id) {
    return {
      httpStatus: 500,
      operation,
      outcome,
      ont: null,
      persistenceWarning: 'La operacion esta marcada "completed" pero no tiene ninguna ONT asociada — revisar manualmente, no asumir que esta bien.',
    };
  }
  const ontResult = await deps.store.getOntById(operation.ont_db_id);
  if (ontResult.error || !ontResult.data) {
    return { httpStatus: 500, operation, outcome, ont: null, persistenceWarning: `No se pudo leer la ONT asociada: ${ontResult.error ?? 'ONT no encontrada'}` };
  }
  return { httpStatus: 200, operation, outcome, ont: ontResult.data };
}

/**
 * El nucleo real: corre el motor de OLT + el pipeline (BD/MikroTik/WAN) y
 * persiste el resultado. Usado tanto por el alta nueva como por el
 * reconcile — ambos caminos llegan aqui con una ProvisioningOperationRow ya
 * resuelta (creada, reusada, o releida).
 */
async function runProvisionAndPipeline(deps: ProvisionHandlerDeps, operation: ProvisioningOperationRow, preflightChecked = false): Promise<ProvisionHandlerResult> {
  const sanitize = (message: string) => (deps.sensitiveValues ?? []).filter(Boolean).reduce((text, value) => text.split(value).join('[REDACTED]'), redactPotentialSecrets(message));
  if (!operation.client_id || !operation.contract_id) return { httpStatus: 400, error: 'La operación pendiente requiere un contrato antes de escribir; conserva el histórico y revisa el vínculo' };
  if (!preflightChecked) {
    try { await deps.preflight(); }
    catch (e) { return { httpStatus: 400, error: e instanceof Error ? e.message : 'Vinculo invalido' }; }
  }
  const stageDone = (stage: string) => [...operation.steps].reverse().find(s => s.stage === stage)?.status === 'ok';
  let resolvedOnuId: number | undefined = operation.onu_id ?? undefined;
  // Objeto contenedor en vez de un `let` suelto a proposito: TypeScript no
  // seguro invalida el narrowing de un `let` cuyo UNICO punto de asignacion
  // visible esta dentro de un closure anidado (persistDb, mas abajo) — lo
  // sigue tratando como su valor inicial ("null") en el resto de esta
  // funcion, aunque en tiempo de ejecucion si cambie. Mutar una propiedad
  // de un objeto no tiene ese problema.
  const ontRowHolder: { current: OntRow | null } = { current: null };

  const provisionDeps: ProvisionDeps = {
    withOltLock: deps.withOltLock,
    runTelnet: deps.runTelnet,
    onStage: async (stage, status, detail) => {
      const safeDetail = detail != null ? sanitize(detail) : null;
      const stepResult = await deps.store.appendStep(operation.id, stage, status, safeDetail);
      if (stepResult.error || !stepResult.data) throw new Error(`No se pudo guardar etapa ${stage}`);

      if (stage === 'resolve_id' && status === 'ok' && detail != null) {
        const id = Number(detail);
        if (Number.isInteger(id)) {
          resolvedOnuId = id;
          // Se persiste de inmediato (antes de escribir) — si todo lo demas
          // se cae despues, de todas formas queda registrado cual id se
          // intento (requisito 4 de la revision externa).
          const idPatch = await deps.store.updateOperation(operation.id, { onu_id: id });
          if (idPatch.error || !idPatch.data) throw new Error('No se pudo guardar el onu-id elegido; se detuvo antes de escribir');
        }
      }
    },
  };

  const requested = operation.requested ?? {};
  const params: ProvisionParams = {
    ref: { shelf: operation.frame, slot: operation.slot, port: operation.port },
    serial: operation.serial,
    onuType: String(requested.onuType ?? ''),
    vlan: Number(requested.vlan ?? 0),
    description: String(requested.description ?? ''),
    tcontProfile: String(requested.tcontProfile ?? ''),
    trafficProfile: String(requested.trafficProfile ?? ''),
    forcedOnuId: typeof requested.forcedOnuId === 'number' ? requested.forcedOnuId : (operation.onu_id ?? undefined),
  };

  const persistDb = async () => {
    if (resolvedOnuId == null) throw new Error('No se resolvio ningun onu-id — no se puede guardar la ONT en la base');
    const ontResult = await deps.store.upsertOnt({
      olt_device_id: deps.deviceId,
      zone_id: typeof requested.zoneId === 'string' ? requested.zoneId : null,
      client_id: operation.client_id,
      contract_id: operation.contract_id,
      frame: operation.frame,
      slot: operation.slot,
      port: operation.port,
      ont_id: resolvedOnuId,
      serial: operation.serial,
      description: typeof requested.description === 'string' ? requested.description : null,
      onu_type: String(requested.onuType ?? ''),
      vlan: Number(requested.vlan ?? 0),
      tcont_profile: String(requested.tcontProfile ?? ''),
      traffic_profile: String(requested.trafficProfile ?? ''),
    });
    if (ontResult.error || !ontResult.data) throw new Error(ontResult.error ?? 'no se pudo guardar la ONT en la base de datos');
    ontRowHolder.current = ontResult.data;
    // Link immediately, before reporting the DB stage as successful.
    const linked = await deps.store.updateOperation(operation.id, { ont_db_id: ontResult.data.id });
    if (linked.error || !linked.data) throw new Error('No se pudo asociar la ONT a la operacion');
    if (requested.napId && !deps.syncLinks) throw new Error('Asignacion NAP pendiente');
    await deps.syncLinks?.();
    deps.onOntChanged?.(ontResult.data);
  };

  const syncWan = deps.buildSyncWan
    ? async () => {
        if (resolvedOnuId == null) throw new Error('No se resolvio ningun onu-id antes de intentar el WAN/PPPoE');
        await deps.buildSyncWan!(resolvedOnuId)();
      }
    : undefined;

  if (stageDone('db') && operation.ont_db_id) {
    const saved = await deps.store.getOntById(operation.ont_db_id);
    if (!saved.error) ontRowHolder.current = saved.data;
  }
  const pendingMikrotik = requested.mikrotik && !stageDone('mikrotik');
  const pendingWan = requested.wan && !stageDone('wan');
  let pipelineResult;
  try {
    pipelineResult = await runProvisioningPipeline({
      provision: () => provisionOnt(provisionDeps, params),
    persistDb: stageDone('db') && ontRowHolder.current ? undefined : persistDb,
    syncMikrotik: pendingMikrotik
      ? (deps.syncMikrotik ?? (async () => { throw new Error('MikroTik pendiente; falta la credencial para reintentar'); }))
      : undefined,
    syncWan: pendingWan
      ? (syncWan ?? (async () => { throw new Error('WAN pendiente; vuelve a ingresar la clave PPPoE'); }))
      : undefined,
    onStage: async (stage, status, detail) => {
      const safeDetail = detail != null ? sanitize(detail) : null;
      const r = await deps.store.appendStep(operation.id, stage, status, safeDetail);
      if (r.error || !r.data) throw new Error(`No se pudo guardar etapa ${stage}`);
    },
  });

  } catch {
    const saved = await deps.store.findOperationById(operation.id, deps.deviceId);
    return {
      httpStatus: 207, operation: saved.data ?? operation,
      outcome: { kind: 'uncertain', onuId: resolvedOnuId ?? 0, message: 'El historial no pudo confirmarse; consultar antes de reintentar' },
      ont: ontRowHolder.current,
      persistenceWarning: 'Se detuvo el flujo al fallar la persistencia de una etapa. Debe reconciliarse antes de continuar.',
    };
  }
  const outcome = pipelineResult.olt;
  const complete = isPipelineComplete(pipelineResult);

  let finalStatus: string;
  if (!isOltStageOk(outcome)) {
    finalStatus = outcomeToOperationStatus(outcome);
  } else if (complete) {
    finalStatus = 'completed';
  } else if (!pipelineResult.dbOk) {
    finalStatus = 'linking';
  } else {
    // BD ok pero MikroTik y/o WAN quedaron pendientes.
    finalStatus = 'mikrotik_pending';
  }

  const patch: Partial<ProvisioningOperationRow> = {
    status: finalStatus,
    error: sanitize(outcomeErrorMessage(outcome) ?? pipelineResult.dbError ?? pipelineResult.mikrotikError ?? pipelineResult.wanError ?? '') || null,
  };
  if (resolvedOnuId != null) patch.onu_id = resolvedOnuId;
  if (ontRowHolder.current) patch.ont_db_id = ontRowHolder.current.id;

  const updateResult = await deps.store.updateOperation(operation.id, patch);

  const common = {
    outcome,
    ont: ontRowHolder.current,
    mikrotikOk: pipelineResult.mikrotikOk,
    mikrotikError: pipelineResult.mikrotikError ? sanitize(pipelineResult.mikrotikError) : undefined,
    wanOk: pipelineResult.wanOk,
    wanError: pipelineResult.wanError ? sanitize(pipelineResult.wanError) : undefined,
  };

  if (updateResult.error || !updateResult.data) {
    // La base NO confirmo el update — la respuesta nunca afirma el estado
    // nuevo (ni "completed" ni ningun otro): se devuelve el estado VIEJO
    // conocido mas una advertencia explicita (requisito 5 de la revision
    // externa).
    return {
      httpStatus: 207,
      operation,
      ...common,
      persistenceWarning: `El resultado se calculo (${finalStatus}) pero no se pudo guardar en la base de datos: ${updateResult.error}. Vuelve a consultar esta operacion antes de confiar en su estado.`,
    };
  }

  return {
    httpStatus: 200,
    operation: updateResult.data ?? { ...operation, ...patch },
    ...common,
  };
}
