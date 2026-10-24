// Fase 169 — nucleo puro del monitoreo de trafico del MikroTik de borde
// DEDICADO (CCR2004 Fiberlux). Sin I/O aqui a proposito (ni Supabase ni
// REST) para poder probarlo sin red/DB real — server/src/services/
// mikrotikBorderTrafficService.ts hace la parte con I/O usando estas
// funciones.

export interface RawCounters {
  rx: number;
  tx: number;
}

export interface DeltaResult {
  intervalSeconds: number;
  rxBytes: number;
  txBytes: number;
  rxBps: number;
  txBps: number;
}

const MIN_INTERVAL_SECONDS = 1;
// Mismo tope que Fase 36 (mikrotik_traffic_samples): si el scheduler estuvo
// caido mucho tiempo, un intervalo gigante da un bps promedio sin sentido —
// mejor acotarlo que mostrar un numero absurdo.
const MAX_INTERVAL_SECONDS = 6 * 3600;

/**
 * Convierte 2 lecturas crudas de rx-byte/tx-byte (acumulados desde que el
 * router arranco) en bytes/bps del intervalo. `prev` null significa "no hay
 * lectura anterior confiable" (primer ciclo, o se perdio el estado) — no se
 * inventa un delta, se devuelve 0.
 *
 * Si el contador actual es MENOR al anterior, RouterOS reinicio esa
 * interfaz (reboot, replug) — se toma el valor crudo actual como el delta
 * completo en vez de un numero negativo sin sentido (igual criterio que el
 * contador PPPoE de Fase 36).
 */
export function computeInterfaceDelta(prev: RawCounters | null, curr: RawCounters, intervalSecondsRaw: number): DeltaResult {
  const intervalSeconds = Math.min(Math.max(intervalSecondsRaw, MIN_INTERVAL_SECONDS), MAX_INTERVAL_SECONDS);
  if (!prev) {
    return { intervalSeconds, rxBytes: 0, txBytes: 0, rxBps: 0, txBps: 0 };
  }
  const rxBytes = curr.rx >= prev.rx ? curr.rx - prev.rx : curr.rx;
  const txBytes = curr.tx >= prev.tx ? curr.tx - prev.tx : curr.tx;
  return {
    intervalSeconds,
    rxBytes,
    txBytes,
    rxBps: Math.round((rxBytes * 8) / intervalSeconds),
    txBps: Math.round((txBytes * 8) / intervalSeconds),
  };
}

export interface MikrotikInterfaceRaw {
  name: string;
  type?: string;
  running?: string;
  disabled?: string;
  'rx-byte'?: string;
  'tx-byte'?: string;
  [key: string]: unknown;
}

/** Busca por nombre EXACTO (los nombres de RouterOS son literales, ej. "VLAN-236") — nunca por coincidencia parcial. */
export function findInterfaceByName(interfaces: MikrotikInterfaceRaw[], name: string | null | undefined): MikrotikInterfaceRaw | null {
  if (!name) return null;
  return interfaces.find((i) => i.name === name) ?? null;
}

export type SaturationDecision = 'over' | 'under' | 'unknown';

export interface SaturationSample {
  sampledAt: string | number | Date;
  rxBps: number;
  txBps: number;
  online: boolean;
}

export interface SaturationEvalResult {
  download: SaturationDecision;
  upload: SaturationDecision;
}

export const SATURATION_RATIO = 0.85;
export const SATURATION_MIN_DURATION_SECONDS = 5 * 60;

/**
 * Decide si descarga/subida estan en saturacion SOSTENIDA (>=85% de la
 * capacidad configurada durante toda la ventana de `minDurationSeconds`).
 * Estateless a proposito: se recalcula cada vez a partir de las muestras ya
 * guardadas (sobrevive un reinicio del backend sin perder continuidad).
 *
 * 'unknown' (nunca 'under') cuando no hay suficientes lecturas CONFIABLES
 * (`online=true`) en la ventana — una caida de monitoreo (router
 * inalcanzable) nunca se confunde con "por debajo del umbral", y por lo
 * tanto tampoco puede disparar NI resolver una alerta por si sola.
 */
export function evaluateSaturation(
  samples: SaturationSample[],
  now: Date,
  capacityDownloadBps: number,
  capacityUploadBps: number,
  minDurationSeconds: number = SATURATION_MIN_DURATION_SECONDS,
  ratio: number = SATURATION_RATIO,
): SaturationEvalResult {
  const sinceMs = now.getTime() - minDurationSeconds * 1000;
  const windowSamples = samples.filter((s) => new Date(s.sampledAt).getTime() >= sinceMs);
  const onlineSamples = windowSamples.filter((s) => s.online);

  // Menos del 60% de la ventana con lecturas validas -> no hay base
  // suficiente para afirmar nada (ni saturado ni normal).
  if (windowSamples.length === 0 || onlineSamples.length < Math.ceil(windowSamples.length * 0.6)) {
    return { download: 'unknown', upload: 'unknown' };
  }

  const thresholdDownload = capacityDownloadBps * ratio;
  const thresholdUpload = capacityUploadBps * ratio;
  return {
    download: onlineSamples.every((s) => s.rxBps >= thresholdDownload) ? 'over' : 'under',
    upload: onlineSamples.every((s) => s.txBps >= thresholdUpload) ? 'over' : 'under',
  };
}

export interface AlertTransition {
  shouldFire: boolean;
  shouldResolve: boolean;
}

/**
 * Nunca dispara una alerta nueva si ya hay una activa (evita duplicados) y
 * nunca actua (ni disparar ni resolver) sobre 'unknown' — una perdida de
 * monitoreo deja la alerta como estaba hasta que vuelva a haber datos.
 */
export function decideAlertTransition(decision: SaturationDecision, hasActiveAlert: boolean): AlertTransition {
  if (decision === 'over' && !hasActiveAlert) return { shouldFire: true, shouldResolve: false };
  if (decision === 'under' && hasActiveAlert) return { shouldFire: false, shouldResolve: true };
  return { shouldFire: false, shouldResolve: false };
}
