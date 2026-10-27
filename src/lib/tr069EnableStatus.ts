// Maquina de estados visible para la habilitacion guiada de TR-069 por ONT
// (requisito 7 del propietario, 2026-10-27). Deriva SIEMPRE de datos ya
// leidos (olt_onts.tr069_enabled + el ultimo intento conocido + la fila de
// tr069_devices por serial, si existe) — nunca inventa un estado intermedio
// que el sistema no pueda sustentar con un dato real, mismo criterio que
// src/lib/oltConnectionStatus.ts.

export type Tr069EnableStatus =
  | 'no_habilitado'
  | 'habilitando'
  | 'esperando_conexion'
  | 'conectado'
  | 'error';

export interface Tr069EnableStatusInput {
  /** true si la ultima escritura a la OLT (pon-onu-mng/tr069-mgmt) se aplico sin error. */
  tr069Enabled: boolean;
  /** true mientras la solicitud de habilitacion esta en curso (ver singleFlightGuard). */
  requestInFlight: boolean;
  /** Mensaje de la ultima falla conocida (escritura a la OLT o verificacion), si la hay. */
  lastError: string | null;
  /** Fila de tr069_devices cuyo cpe_serial coincide EXACTO con el serial de esta ONT, o null si no hay match todavia. */
  matchedDevice: { cpe_serial: string; last_seen_at: string | null } | null;
  nowMs: number;
  /** A partir de cuanto tiempo sin Inform se deja de considerar "conectado" (default 30 min). */
  staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

export function deriveTr069EnableStatus(input: Tr069EnableStatusInput): Tr069EnableStatus {
  if (input.requestInFlight) return 'habilitando';
  if (input.lastError) return 'error';
  if (!input.tr069Enabled) return 'no_habilitado';
  if (!input.matchedDevice?.last_seen_at) return 'esperando_conexion';
  const staleAfter = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const age = input.nowMs - Date.parse(input.matchedDevice.last_seen_at);
  return age <= staleAfter ? 'conectado' : 'esperando_conexion';
}

/** "Administrar TR-069" (requisito 8) solo debe mostrarse con identidad Y conexion confirmadas. */
export function canManageTr069(status: Tr069EnableStatus): boolean {
  return status === 'conectado';
}

export const TR069_ENABLE_STATUS_LABEL: Record<Tr069EnableStatus, string> = {
  no_habilitado: 'No habilitado',
  habilitando: 'Habilitando...',
  esperando_conexion: 'Esperando conexión',
  conectado: 'Conectado',
  error: 'Error',
};
