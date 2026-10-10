import { registerOntCommands, listAllOntsCommands, fullRunningConfigCommand, type ZteInterfaceRef } from '../ssh/zteCommands';
import { parseGlobalOntState, parseFullRunningConfig, type FullConfigOnt } from '../ssh/zteParsers';

/**
 * Motor de aprovisionamiento confiable de ONTs (Fase 2, ver
 * docs/auditoria/fase-2-aprovisionamiento.html). Reemplaza la logica "todo o
 * nada" que tenia POST /:id/onts en routes/olt.ts por una secuencia que:
 *
 *   1. Valida la solicitud ANTES de tocar la OLT (sin red).
 *   2. Escanea la OLT en vivo para saber si el serial YA existe en algun
 *      lado (no solo en este puerto) y elegir un onu-id REALMENTE libre
 *      dentro de la capacidad admitida — combinando el escaneo de estado
 *      ("show gpon onu state") Y el de configuracion ("show running-config"),
 *      nunca confiando solo en uno de los dos ni en la base local.
 *   3. Si el escaneo no se pudo interpretar de forma confiable (formato
 *      inesperado, no un puerto genuinamente vacio), se detiene ahi mismo
 *      SIN elegir ningun id ni escribir nada — un fallo de parsing nunca se
 *      trata como "no hay nada ahi".
 *   4. Si el serial ya esta registrado en la MISMA posicion con la MISMA
 *      configuracion, no vuelve a escribir nada (operacion idempotente).
 *   5. El onu-id elegido se deja constancia (etapa "resolve_id") ANTES de
 *      intentar escribir — si algo falla despues, se sabe de todas formas
 *      cual id se intento.
 *   6. Si hay que escribir, lo hace y DESPUES relee la OLT (con el MISMO
 *      comando de "show running-config" completo, el unico confirmado
 *      contra el equipo real — ver advertencia en zteCommands.ts sobre
 *      portRunningConfigCommand) para verificar serial/posicion/VLAN/
 *      perfiles. Un prompt de vuelta nunca se toma como "exito" sin esa
 *      relectura, y si la relectura misma falla (timeout/conexion
 *      perdida), el resultado es "verify_uncertain" — NO se asume ni exito
 *      ni fallo.
 *   7. Un timeout o cierre de conexion durante la ESCRITURA se reporta como
 *      INCIERTO. Un RECHAZO CLI real tampoco prueba que los comandos
 *      anteriores de la secuencia no se hayan aplicado — por eso ambos
 *      casos ("rejected" y "uncertain") llevan el onu-id intentado, y un
 *      reconcile posterior vuelve a escanear antes de decidir nada (si
 *      encuentra una config parcial en esa posicion, lo reporta como
 *      conflicto para que un humano decida, nunca lo sobreescribe solo).
 *   8. Nunca borra ni modifica una ONU existente que no coincida exactamente
 *      con la posicion/config solicitada.
 *
 * Todo el flujo corre dentro de UN SOLO turno de la cola por OLT (el
 * `withOltLock` que el caller ya debe envolver, ver oltTelnetLock.ts).
 */

// onu-id 1..127: mismo rango ya validado en zteCommands.ts (sanitizeInt
// admite 0-127, pero el auto-resuelto de rutas/olt.ts arranca en 1 — se
// mantiene ese mismo criterio aqui para no cambiar el comportamiento ya
// confirmado contra el equipo real).
export const ONU_ID_MIN = 1;
export const ONU_ID_MAX = 127;

export interface ProvisionParams {
  ref: ZteInterfaceRef;
  serial: string;
  onuType: string;
  vlan: number;
  description: string;
  tcontProfile: string;
  trafficProfile: string;
  /** Si se especifica, se usa este onu-id en vez de resolver uno libre — igual se valida que este realmente libre. */
  forcedOnuId?: number;
  /** onu-ids que la base local YA conoce para este puerto (defensa extra, nunca sustituye al escaneo en vivo). */
  knownUsedIdsInDb?: Iterable<number>;
}

export interface VerifyMismatch {
  field: 'serial' | 'onuType' | 'vlan' | 'tcontProfile' | 'trafficProfile' | 'existencia';
  expected: string;
  actual: string | null;
}

export type ProvisionStage = 'validate' | 'scan' | 'resolve_id' | 'write' | 'verify';
export type ProvisionStageStatus = 'started' | 'ok' | 'uncertain' | 'failed';

export interface ProvisionDeps {
  /** Ya bindeado al deviceId del caller (ver withOltLock en oltTelnetLock.ts). */
  withOltLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Ya bindeado al target (host/credenciales) del caller. */
  runTelnet: (commands: string[], opts?: { timeoutMs?: number }) => Promise<string[]>;
  onStage?: (stage: ProvisionStage, status: ProvisionStageStatus, detail?: string) => void | Promise<void>;
}

export type ProvisionOutcome =
  | { kind: 'invalid'; message: string }
  | { kind: 'scan_unreliable'; message: string }
  | { kind: 'already_registered'; onuId: number }
  | { kind: 'registered'; onuId: number }
  | { kind: 'verify_mismatch'; onuId: number; mismatches: VerifyMismatch[] }
  | { kind: 'verify_uncertain'; onuId: number; message: string }
  | { kind: 'conflict_same_position_different_config'; onuId: number; mismatches: VerifyMismatch[] }
  | { kind: 'conflict_elsewhere'; at: { shelf: number; slot: number; port: number; onuId: number } }
  | { kind: 'capacity_full' }
  | { kind: 'rejected'; onuId: number; message: string }
  | { kind: 'uncertain'; onuId: number; message: string };

/** Outcomes donde SI se llego a intentar (o posiblemente aplicar) una escritura — un reconcile tiene sentido en todos estos. */
export function outcomeNeedsReconciliation(outcome: ProvisionOutcome): boolean {
  return (
    outcome.kind === 'uncertain' ||
    outcome.kind === 'rejected' ||
    outcome.kind === 'verify_uncertain' ||
    outcome.kind === 'verify_mismatch'
  );
}

const SERIAL_RE = /^[A-Za-z0-9]{6,20}$/;

/** Validacion de la solicitud ANTES de tocar la OLT — ninguna de estas reglas necesita red. */
export function validateProvisionInput(params: ProvisionParams): string | null {
  const serial = params.serial?.trim() ?? '';
  if (!SERIAL_RE.test(serial)) return 'Serial invalido (debe ser alfanumerico, 6 a 20 caracteres)';
  if (!params.onuType?.trim()) return 'El tipo de ONU (perfil OMCI) es requerido';
  if (!Number.isInteger(params.vlan) || params.vlan < 1 || params.vlan > 4094) return 'VLAN fuera de rango (1-4094)';
  if (!params.tcontProfile?.trim() || !params.trafficProfile?.trim()) return 'Los perfiles de subida y bajada son requeridos';
  if (!Number.isInteger(params.ref.shelf) || params.ref.shelf < 0 || params.ref.shelf > 31) return 'Shelf invalido';
  if (!Number.isInteger(params.ref.slot) || params.ref.slot < 0 || params.ref.slot > 31) return 'Slot invalido';
  if (!Number.isInteger(params.ref.port) || params.ref.port < 0 || params.ref.port > 127) return 'Puerto invalido';
  if (params.forcedOnuId != null) {
    if (!Number.isInteger(params.forcedOnuId) || params.forcedOnuId < ONU_ID_MIN || params.forcedOnuId > ONU_ID_MAX) {
      return `El ID de ONU debe estar entre ${ONU_ID_MIN} y ${ONU_ID_MAX}`;
    }
  }
  return null;
}

export interface ExistingRegistration {
  shelf: number;
  slot: number;
  port: number;
  onuId: number;
  entry: FullConfigOnt;
}

/** Busca un serial en CUALQUIER posicion del equipo (no solo el puerto solicitado) a partir de un dump ya parseado. */
export function findExistingBySerial(fullConfig: Map<string, FullConfigOnt>, serial: string): ExistingRegistration | null {
  const target = serial.trim().toUpperCase();
  for (const [key, entry] of fullConfig) {
    if ((entry.serial || '').trim().toUpperCase() !== target) continue;
    const match = key.match(/^(\d+)\/(\d+)\/(\d+):(\d+)$/);
    if (!match) continue;
    return { shelf: Number(match[1]), slot: Number(match[2]), port: Number(match[3]), onuId: Number(match[4]), entry };
  }
  return null;
}

/** Primer onu-id libre dentro del rango admitido — nunca asume que la base local esta completa, solo complementa el escaneo en vivo. */
export function resolveFreeOnuId(usedIds: ReadonlySet<number>, min = ONU_ID_MIN, max = ONU_ID_MAX): number | null {
  for (let id = min; id <= max; id += 1) {
    if (!usedIds.has(id)) return id;
  }
  return null;
}

/**
 * onu-ids YA usados en un shelf/slot/port, combinando AMBAS fuentes de
 * escaneo (estado Y configuracion) — una ONU podria aparecer en una pero no
 * en la otra (ej. configurada pero sin señal en este momento), y confiar en
 * una sola arriesgaria reusar un id que en realidad ya pertenece a otra ONU
 * real (mismo tipo de incidente que ya paso una vez con el sufijo de
 * "uncfg", ver memoria del proyecto).
 */
export function collectUsedOnuIds(
  globalOnts: { slot: number; port: number; onuId: number }[],
  fullConfig: Map<string, FullConfigOnt>,
  ref: ZteInterfaceRef,
): Set<number> {
  const used = new Set<number>();
  for (const o of globalOnts) {
    if (o.slot === ref.slot && o.port === ref.port) used.add(o.onuId);
  }
  const prefix = `${ref.shelf}/${ref.slot}/${ref.port}:`;
  for (const key of fullConfig.keys()) {
    if (key.startsWith(prefix)) {
      const id = Number(key.slice(prefix.length));
      if (Number.isInteger(id)) used.add(id);
    }
  }
  return used;
}

/**
 * Distingue "el puerto genuinamente no tiene nada" de "el formato de
 * respuesta no era el esperado y el parser no reconocio nada" — un texto
 * crudo con contenido real (mas de unos pocos caracteres, mas alla del
 * prompt) que termino en CERO filas interpretadas es sospechoso: algo en el
 * formato cambio o la respuesta vino incompleta/corrupta, no que no haya
 * absolutamente nada registrado en todo el equipo.
 */
export function looksLikeParseFailure(raw: string, parsedCount: number): boolean {
  if (parsedCount > 0) return false;
  return raw.trim().length > 40;
}

export interface ExpectedOntConfig {
  serial: string;
  onuType: string;
  vlan: number;
  tcontProfile: string;
  trafficProfile: string;
  serviceGemport: number;
  serviceVlan: number;
}

/** Compara lo que de verdad quedo en la OLT (o `undefined` si ni aparece) contra lo solicitado. Vacio = todo coincide. */
export function verifyProvisionedOnt(entry: FullConfigOnt | undefined, expected: ExpectedOntConfig): VerifyMismatch[] {
  if (!entry) return [{ field: 'existencia', expected: 'registrada en la OLT', actual: null }];
  const mismatches: VerifyMismatch[] = [];
  if ((entry.serial || '').toUpperCase() !== expected.serial.toUpperCase()) {
    mismatches.push({ field: 'serial', expected: expected.serial, actual: entry.serial || null });
  }
  if ((entry.onuType || '') !== expected.onuType) {
    mismatches.push({ field: 'onuType', expected: expected.onuType, actual: entry.onuType || null });
  }
  if (entry.vlan !== expected.vlan) {
    mismatches.push({ field: 'vlan', expected: String(expected.vlan), actual: entry.vlan == null ? null : String(entry.vlan) });
  }
  if ((entry.tcontProfile || '') !== expected.tcontProfile) {
    mismatches.push({ field: 'tcontProfile', expected: expected.tcontProfile, actual: entry.tcontProfile || null });
  }
  if ((entry.trafficProfile || '') !== expected.trafficProfile) {
    mismatches.push({ field: 'trafficProfile', expected: expected.trafficProfile, actual: entry.trafficProfile || null });
  }
  if (entry.serviceGemport !== expected.serviceGemport) {
    mismatches.push({ field: 'serviceGemport', expected: String(expected.serviceGemport), actual: entry.serviceGemport == null ? null : String(entry.serviceGemport) });
  }
  if (entry.serviceVlan !== expected.serviceVlan) {
    mismatches.push({ field: 'serviceVlan', expected: String(expected.serviceVlan), actual: entry.serviceVlan == null ? null : String(entry.serviceVlan) });
  }
  return mismatches;
}

/**
 * Clasifica un error de ESCRITURA (nunca de lectura) segun los mensajes ya
 * estandarizados de runTelnetCommands (ver server/src/telnet/client.ts,
 * Fase 1): "rechazo el comando" es un rechazo CLI real y verificado. OJO —
 * eso confirma que ESE comando puntual se rechazo, pero NO prueba que los
 * comandos ANTERIORES de la misma secuencia (ej. la creacion de la interfaz,
 * el binding tipo/serial) no se hayan aplicado ya — por eso un "rejected"
 * sigue siendo reconciliable (ver outcomeNeedsReconciliation), nunca se
 * trata como "no paso nada". Cualquier otro error (timeout, cierre de
 * conexion) es INCIERTO en un sentido mas amplio: ni siquiera se sabe si
 * ESE comando se aplico.
 */
export function classifyWriteError(e: unknown): 'rejected' | 'uncertain' {
  const message = e instanceof Error ? e.message : String(e);
  return /rechazo el comando/i.test(message) ? 'rejected' : 'uncertain';
}

function mismatchSummary(mismatches: VerifyMismatch[]): string {
  return mismatches.map((m) => `${m.field}: esperado "${m.expected}", real "${m.actual ?? '(ausente)'}"`).join('; ');
}

export async function provisionOnt(deps: ProvisionDeps, params: ProvisionParams): Promise<ProvisionOutcome> {
  const invalid = validateProvisionInput(params);
  if (invalid) {
    await deps.onStage?.('validate', 'failed', invalid);
    return { kind: 'invalid', message: invalid };
  }
  await deps.onStage?.('validate', 'ok');

  return deps.withOltLock(async () => {
    await deps.onStage?.('scan', 'started');
    const stateOut = await deps.runTelnet(listAllOntsCommands(), { timeoutMs: 45000 });
    const stateRaw = stateOut.join('\n');
    const globalOnts = parseGlobalOntState(stateRaw);
    const configOut = await deps.runTelnet(fullRunningConfigCommand(), { timeoutMs: 120000 });
    const configRaw = configOut[1] ?? '';
    const fullConfig = parseFullRunningConfig(configRaw);

    if (looksLikeParseFailure(stateRaw, globalOnts.length) || looksLikeParseFailure(configRaw, fullConfig.size)) {
      await deps.onStage?.('scan', 'failed', 'el formato de la respuesta no se pudo interpretar con confianza');
      return {
        kind: 'scan_unreliable',
        message: 'No se pudo interpretar con confianza el escaneo de la OLT (la respuesta no tenia el formato esperado) — no se elige ningun id ni se escribe nada hasta confirmar el formato real.',
      };
    }
    await deps.onStage?.('scan', 'ok');

    const expected: ExpectedOntConfig = {
      serial: params.serial,
      onuType: params.onuType,
      vlan: params.vlan,
      tcontProfile: params.tcontProfile,
      trafficProfile: params.trafficProfile,
      serviceGemport: 1,
      serviceVlan: params.vlan,
    };

    const existing = findExistingBySerial(fullConfig, params.serial);
    if (existing) {
      const samePosition =
        existing.shelf === params.ref.shelf &&
        existing.slot === params.ref.slot &&
        existing.port === params.ref.port &&
        (params.forcedOnuId == null || existing.onuId === params.forcedOnuId);

      if (!samePosition) {
        // Nunca se toca: ni se borra ni se mueve. Queda para que un humano
        // decida (pudo ser una ONU desconfigurada y reconectada en otro
        // puerto, o un error de digitacion del tecnico).
        return { kind: 'conflict_elsewhere', at: { shelf: existing.shelf, slot: existing.slot, port: existing.port, onuId: existing.onuId } };
      }

      await deps.onStage?.('resolve_id', 'ok', String(existing.onuId));
      const mismatches = verifyProvisionedOnt(existing.entry, expected);
      if (mismatches.length === 0) {
        // Idempotente: esta MISMA solicitud (o una igual) ya se aplico —
        // nunca se repite el comando de alta. Cubre el reintento de red y
        // el doble-clic por igual.
        await deps.onStage?.('write', 'ok', 'ya estaba registrada igual en la OLT (operacion idempotente, sin re-escribir)');
        await deps.onStage?.('verify', 'ok', 'confirmado contra el escaneo ya en curso');
        return { kind: 'already_registered', onuId: existing.onuId };
      }

      // Misma posicion, pero con otra config: no se sobreescribe solo. Esto
      // incluye el caso de una escritura PARCIAL anterior (ej. un rechazo a
      // mitad de secuencia) — no se asume que "falta algo" = "se puede
      // completar solo", queda para revision humana.
      return { kind: 'conflict_same_position_different_config', onuId: existing.onuId, mismatches };
    }

    const usedLive = collectUsedOnuIds(globalOnts, fullConfig, params.ref);
    for (const id of params.knownUsedIdsInDb ?? []) usedLive.add(id);

    let onuId: number;
    if (params.forcedOnuId != null) {
      if (usedLive.has(params.forcedOnuId)) {
        return { kind: 'conflict_elsewhere', at: { ...params.ref, onuId: params.forcedOnuId } };
      }
      onuId = params.forcedOnuId;
    } else {
      const free = resolveFreeOnuId(usedLive);
      if (free == null) return { kind: 'capacity_full' };
      onuId = free;
    }

    // Constancia del id elegido ANTES de escribir — si lo que sigue se cae
    // (timeout, proceso caido), de todas formas queda registrado cual id se
    // intento (ver appendProvisioningStep en routes/olt.ts: la etapa
    // "resolve_id" tambien persiste onu_id en la operacion).
    await deps.onStage?.('resolve_id', 'ok', String(onuId));

    await deps.onStage?.('write', 'started');
    try {
      await deps.runTelnet(
        registerOntCommands({
          ref: params.ref,
          onuId,
          serial: params.serial,
          onuType: params.onuType,
          vlan: params.vlan,
          description: params.description,
          tcontProfile: params.tcontProfile,
          trafficProfile: params.trafficProfile,
        }),
      );
    } catch (e) {
      const kind = classifyWriteError(e);
      const message = e instanceof Error ? e.message : 'Error al escribir en la OLT';
      await deps.onStage?.('write', kind === 'rejected' ? 'failed' : 'uncertain', message);
      return kind === 'rejected' ? { kind: 'rejected', onuId, message } : { kind: 'uncertain', onuId, message };
    }
    await deps.onStage?.('write', 'ok');

    await deps.onStage?.('verify', 'started');
    // Se reusa el MISMO comando ya confirmado contra el equipo real
    // ("show running-config" completo) en vez de portRunningConfigCommand()
    // (ver advertencia en zteCommands.ts: nunca se probo que ese comando
    // acotado por puerto realmente incluya los bloques gpon-onu con
    // VLAN/perfiles — asumirlo sin confirmar hubiera arriesgado reportar
    // "verify_mismatch" en un registro que en realidad salio bien).
    let verifyConfig: Map<string, FullConfigOnt>;
    try {
      const verifyOut = await deps.runTelnet(fullRunningConfigCommand(), { timeoutMs: 120000 });
      verifyConfig = parseFullRunningConfig(verifyOut[1] ?? '');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error al releer la OLT para verificar';
      await deps.onStage?.('verify', 'uncertain', message);
      return { kind: 'verify_uncertain', onuId, message };
    }
    const verifyKey = `${params.ref.shelf}/${params.ref.slot}/${params.ref.port}:${onuId}`;
    const mismatches = verifyProvisionedOnt(verifyConfig.get(verifyKey), expected);
    if (mismatches.length) {
      await deps.onStage?.('verify', 'failed', mismatchSummary(mismatches));
      return { kind: 'verify_mismatch', onuId, mismatches };
    }
    await deps.onStage?.('verify', 'ok');
    return { kind: 'registered', onuId };
  });
}

/**
 * Outcomes de provisionOnt() que significan "la OLT quedo bien, se puede
 * seguir con las etapas siguientes" — todo lo demas detiene la cadena ahi:
 * nunca se avanza a BD/MikroTik/WAN sobre una OLT que no esta confirmada.
 */
export function isOltStageOk(outcome: ProvisionOutcome): boolean {
  return outcome.kind === 'registered' || outcome.kind === 'already_registered';
}

export interface PipelineDeps {
  /** Ya resuelto a los parametros reales — ver provisionOnt(). */
  provision: () => Promise<ProvisionOutcome>;
  /** Vincular cliente/contrato/zona en Supabase (fila de olt_onts) — opcional. */
  persistDb?: () => Promise<void>;
  /** Crear/vincular el secreto PPPoE en MikroTik — opcional, independiente de persistDb. */
  syncMikrotik?: () => Promise<void>;
  /** WAN/PPPoE por OMCI contra la propia OLT — opcional, independiente de las otras dos. */
  syncWan?: () => Promise<void>;
  onStage?: (stage: 'db' | 'mikrotik' | 'wan', status: 'ok' | 'failed', detail?: string) => void | Promise<void>;
}

export interface PipelineResult {
  olt: ProvisionOutcome;
  dbOk: boolean;
  dbError?: string;
  mikrotikOk: boolean;
  mikrotikError?: string;
  wanOk: boolean;
  wanError?: string;
}

/** true solo cuando TODAS las etapas que de verdad se pidieron (las que tenian una funcion en PipelineDeps) terminaron bien. */
export function isPipelineComplete(result: PipelineResult): boolean {
  return isOltStageOk(result.olt) && result.dbOk && result.mikrotikOk && result.wanOk;
}

/**
 * Encadena OLT -> BD -> MikroTik -> WAN SIN que una etapa posterior pueda
 * revertir la OLT (requisito 7: nunca se borra/revierte una ONU existente
 * solo porque un paso de DESPUES fallo) y sin que el fallo de una bloquee a
 * las demas (requisito 6: cada etapa pendiente se reintenta por separado).
 * Si la OLT no quedo en un estado "ok" (ver isOltStageOk), ninguna etapa
 * siguiente se intenta — ese es el UNICO paso duro de toda la cadena. Una
 * etapa sin funcion en `deps` (ej. no se pidio WAN porque no habia clave a
 * mano) se reporta como "ok" por default — "no pedida" no es lo mismo que
 * "pendiente".
 */
export async function runProvisioningPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const olt = await deps.provision();
  if (!isOltStageOk(olt)) {
    return { olt, dbOk: false, mikrotikOk: false, wanOk: false };
  }

  let dbOk = true;
  let dbError: string | undefined;
  if (deps.persistDb) {
    try {
      await deps.persistDb();
      await deps.onStage?.('db', 'ok');
    } catch (e) {
      dbOk = false;
      dbError = e instanceof Error ? e.message : 'Error al guardar en la base de datos';
      await deps.onStage?.('db', 'failed', dbError);
    }
  }

  let mikrotikOk = true;
  let mikrotikError: string | undefined;
  if (deps.syncMikrotik) {
    try {
      await deps.syncMikrotik();
      await deps.onStage?.('mikrotik', 'ok');
    } catch (e) {
      mikrotikOk = false;
      mikrotikError = e instanceof Error ? e.message : 'Error al sincronizar MikroTik';
      await deps.onStage?.('mikrotik', 'failed', mikrotikError);
    }
  }

  let wanOk = true;
  let wanError: string | undefined;
  if (deps.syncWan) {
    try {
      await deps.syncWan();
      await deps.onStage?.('wan', 'ok');
    } catch (e) {
      wanOk = false;
      wanError = e instanceof Error ? e.message : 'Error al configurar el WAN/PPPoE';
      await deps.onStage?.('wan', 'failed', wanError);
    }
  }

  return { olt, dbOk, dbError, mikrotikOk, mikrotikError, wanOk, wanError };
}
