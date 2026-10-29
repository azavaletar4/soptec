// Maquina de estados visible para la habilitacion guiada de TR-069 por ONT
// (requisito 7 del propietario, 2026-10-27; ampliada 2026-10-29 para
// distinguir "nunca contactó" de "contactó antes y ahora no" — caso real:
// GenieACS llegó a registrar la Huawei, pero la ficha seguía mostrando
// "Esperando conexión" indefinidamente aunque ya hubo contacto confirmado).
// Deriva SIEMPRE de datos ya leidos (olt_onts.tr069_enabled/tr069_enabled_at
// + el ultimo intento conocido + la fila de tr069_devices por serial, si
// existe) — nunca inventa un estado intermedio que el sistema no pueda
// sustentar con un dato real, mismo criterio que src/lib/oltConnectionStatus.ts
// (ahí también se separa "sin dato" de "dato viejo" en vez de mezclarlos).

export type Tr069EnableStatus =
  | 'no_habilitado'
  | 'habilitando'
  | 'configurado'
  | 'esperando_conexion'
  | 'conectado'
  | 'sin_comunicacion_reciente'
  | 'error';

export interface Tr069EnableStatusInput {
  /** true si la ultima escritura a la OLT (pon-onu-mng/tr069-mgmt) se aplico sin error. */
  tr069Enabled: boolean;
  /** true mientras la solicitud de habilitacion esta en curso (ver singleFlightGuard). */
  requestInFlight: boolean;
  /** Mensaje de la ultima falla conocida (escritura a la OLT o verificacion), si la hay. */
  lastError: string | null;
  /** Fila de tr069_devices cuyo cpe_serial coincide EXACTO con el serial de esta ONT, o null si no hay match todavia. Nunca una identidad ambigua. */
  matchedDevice: { cpe_serial: string; last_seen_at: string | null } | null;
  /** Momento real en que se aplicó esta habilitación (olt_onts.tr069_enabled_at) — null/ausente si se desconoce. */
  enabledAt?: string | null;
  nowMs: number;
  /** A partir de cuanto tiempo SIN Inform un equipo que YA había contactado deja de considerarse "conectado" (default 30 min). */
  staleAfterMs?: number;
  /** A partir de cuanto tiempo desde que se configuró, SIN ningún contacto todavía, se pasa de "Configurado" a "Esperando conexión" (default 10 min — mismo margen ya usado para el guard de Hosts). */
  firstContactGraceMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;
const DEFAULT_FIRST_CONTACT_GRACE_MS = 10 * 60 * 1000;

export function deriveTr069EnableStatus(input: Tr069EnableStatusInput): Tr069EnableStatus {
  if (input.requestInFlight) return 'habilitando';
  if (input.lastError) return 'error';
  if (!input.tr069Enabled) return 'no_habilitado';

  // Hubo o hay contacto confirmado por identidad exacta — nunca se declara
  // "conectado" por un registro histórico ambiguo, solo por ESTE match.
  if (input.matchedDevice?.last_seen_at) {
    const staleAfter = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    const age = input.nowMs - Date.parse(input.matchedDevice.last_seen_at);
    return Number.isFinite(age) && age <= staleAfter ? 'conectado' : 'sin_comunicacion_reciente';
  }

  // Nunca hubo contacto todavía: "Configurado" mientras sigue dentro del
  // margen normal de espera (nunca se asume "ya es mucho tiempo" sin la
  // fecha real de habilitación); pasado ese margen, "Esperando conexión".
  if (input.enabledAt) {
    const grace = input.firstContactGraceMs ?? DEFAULT_FIRST_CONTACT_GRACE_MS;
    const sinceEnabled = input.nowMs - Date.parse(input.enabledAt);
    if (Number.isFinite(sinceEnabled) && sinceEnabled > grace) return 'esperando_conexion';
  }
  return 'configurado';
}

/** "Administrar TR-069" (requisito 8) solo debe mostrarse con identidad Y conexion RECIENTE confirmadas — nunca con un contacto viejo. */
export function canManageTr069(status: Tr069EnableStatus): boolean {
  return status === 'conectado';
}

/** Mientras siga en alguno de estos estados vale la pena seguir comprobando (ver poll acotado en OntDetailModal.vue) — "sin_comunicacion_reciente" ya tuvo su oportunidad y no se sondea solo por abrir la ficha. */
export function shouldKeepPollingTr069(status: Tr069EnableStatus): boolean {
  return status === 'habilitando' || status === 'configurado' || status === 'esperando_conexion';
}

export const TR069_ENABLE_STATUS_LABEL: Record<Tr069EnableStatus, string> = {
  no_habilitado: 'No habilitado',
  habilitando: 'Habilitando...',
  configurado: 'Configurado',
  esperando_conexion: 'Esperando conexión',
  conectado: 'Conectado a GenieACS',
  sin_comunicacion_reciente: 'Sin comunicación reciente',
  error: 'Error',
};
