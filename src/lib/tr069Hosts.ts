/** Un dispositivo conectado tal como lo reporta el propio equipo — nunca inventado.
 * Cualquier campo que el equipo no reporte queda en null (el panel lo muestra como
 * "Sin confirmar" para conexión/banda/estado), nunca se asume un valor. */
export interface HostEntry {
  hostName: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  /** Derivado de InterfaceType si el equipo lo reporta, o de una asociación WiFi
   * realmente observada (AssociatedDevice) — nunca de una suposición. */
  connection: 'WiFi' | 'Cable' | null;
  /** Fecha del InterfaceType que respalda el tipo; ausente implica sin confirmar. */
  connectionReportedAt?: string | null;
  /** Solo si el propio parámetro de la red WiFi la declara explícitamente. */
  band: '2.4 GHz' | '5 GHz' | null;
  /** Active de TR-069 (Hosts.{i}.Active) — null si el equipo nunca lo reportó, no
   * se asume "conectado" por estar en la lista. */
  active: boolean | null;
  /** Fecha del valor Active, independiente del Inform y de nombre/IP/MAC.
   * Opcional para conservar compatibilidad con el backend ya desplegado. */
  activeReportedAt?: string | null;
  /** Fecha real (UTC) de la última vez que el equipo reportó este registro —
   * nunca la hora en que se renderiza la pantalla. */
  reportedAt: string | null;
}

// Política conservadora de presentación: hasta dos intervalos Inform de 5 min.
// No garantiza conexión en vivo ni sustituye una lectura del campo Active.
export const HOST_STATUS_MAX_AGE_MS = 10 * 60_000;

function validReportTime(raw: string | null | undefined, now: number): string | null {
  if (typeof raw !== 'string') return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) && time <= now ? raw : null;
}

function recentReport(raw: string | null | undefined, now: number): boolean {
  return validReportTime(raw, now) !== null && now - Date.parse(raw!) <= HOST_STATUS_MAX_AGE_MS;
}

export function hostStatusLabel(host: HostEntry, lastInform: string | null, now: number): string {
  if (typeof host.active !== 'boolean' || !recentReport(host.activeReportedAt, now) || !recentReport(lastInform, now)) return 'Sin confirmar';
  return host.active ? 'Conectado' : 'Desconectado';
}

export function hostConnectionLabel(host: HostEntry, lastInform: string | null, now: number): string {
  if (!recentReport(host.connectionReportedAt, now) || !recentReport(lastInform, now)) return 'Sin confirmar';
  return host.connection === 'WiFi' || host.connection === 'Cable' ? host.connection : 'Sin confirmar';
}

/** Conserva la hora aunque el estado haya caducado; no presenta fechas inválidas/futuras. */
export function hostStatusReadAt(host: HostEntry, now: number): string | null {
  return validReportTime(host.activeReportedAt, now);
}

/** Fecha de los datos de las filas, nunca la fecha de descubrimiento del objeto padre. */
export function latestHostsReport(inventory: HostsInventory, now = Date.now()): string | null {
  return inventory.hosts.flatMap(h => [h.reportedAt, h.activeReportedAt, h.connectionReportedAt])
    .filter((t): t is string => validReportTime(t, now) !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

export interface HostsInventory {
  found: boolean;
  deviceId: string | null;
  serial: string | null;
  lastInform: string | null;
  /** Fecha del propio bloque Hosts en la caché — puede ser más vieja que
   * `lastInform` si el equipo no reporta Hosts en cada Inform periódico. */
  hostsReportedAt: string | null;
  hosts: HostEntry[];
}
