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
  macReportedAt?: string | null;
  layer2Interface?: string | null;
  layer2ReportedAt?: string | null;
  wifiSignal?: HostWifiSignal | null;
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

export interface HostWifiSignal {
  dbm: number;
  unit: 'dBm';
  reportedAt: string;
  unitReportedAt: string;
  macReportedAt: string;
  macAddress: string;
  wlanPath: string;
}

export type HostsReadState = 'completed' | 'pending' | 'failed' | 'expired' | 'uncertain';
export interface HostsReadResult {
  state: HostsReadState;
  requestedAt: string;
  checkedAt: string;
  message: string;
  inventory: HostsInventory;
}

// Política conservadora de presentación: hasta dos intervalos Inform de 5 min.
// No garantiza conexión en vivo ni sustituye una lectura del campo Active.
export const HOST_STATUS_MAX_AGE_MS = 10 * 60_000;

function validReportTime(raw: string | null | undefined, now: number): string | null {
  if (typeof raw !== 'string') return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) && time <= now ? raw : null;
}

export function recentHostReport(raw: string | null | undefined, now: number): boolean {
  return validReportTime(raw, now) !== null && now - Date.parse(raw!) <= HOST_STATUS_MAX_AGE_MS;
}

export function hostStatusLabel(host: HostEntry, lastInform: string | null, now: number): string {
  if (typeof host.active !== 'boolean' || !recentHostReport(host.activeReportedAt, now) || !recentHostReport(lastInform, now)) return 'Sin confirmar';
  return host.active ? 'Conectado' : 'Desconectado';
}

export function hostConnectionLabel(host: HostEntry, lastInform: string | null, now: number): string {
  if (!recentHostReport(host.connectionReportedAt, now) || !recentHostReport(lastInform, now)) return 'Sin confirmar';
  return host.connection === 'WiFi' || host.connection === 'Cable' ? host.connection : 'Sin confirmar';
}

export function normalizeHostMac(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw?.trim().toUpperCase();
  return value && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(value) ? value : null;
}

export type WifiSignalLevel = 'excellent' | 'good' | 'fair' | 'poor';

export function hostWifiSignalPresentation(host: HostEntry, lastInform: string | null, now: number): {
  label: string; level: WifiSignalLevel | null;
} {
  const connection = hostConnectionLabel(host, lastInform, now);
  if (connection === 'Cable') return { label: 'No aplica', level: null };
  const signal = host.wifiSignal;
  if (connection !== 'WiFi' || hostStatusLabel(host, lastInform, now) !== 'Conectado' || !signal || signal.unit !== 'dBm' || !Number.isInteger(signal.dbm) || signal.dbm < -120 || signal.dbm >= 0 ||
      !normalizeHostMac(host.macAddress) || normalizeHostMac(host.macAddress) !== normalizeHostMac(signal.macAddress) ||
      !host.layer2Interface || host.layer2Interface !== signal.wlanPath ||
      ![signal.reportedAt, signal.unitReportedAt, signal.macReportedAt, host.macReportedAt, host.layer2ReportedAt].every(t => recentHostReport(t, now))) {
    return { label: 'No disponible', level: null };
  }
  // Umbrales orientativos de cobertura (no porcentaje ni velocidad de internet):
  // -30 a -55 Excelente, -56 a -67 Buena (ambas verdes), -68 a -75 Regular
  // (amarillo), menor de -75 Débil (rojo).
  const level: WifiSignalLevel = signal.dbm >= -55 ? 'excellent' : signal.dbm >= -67 ? 'good' : signal.dbm >= -75 ? 'fair' : 'poor';
  return { label: `${signal.dbm} dBm`, level };
}

/** Conserva la hora aunque el estado haya caducado; no presenta fechas inválidas/futuras. */
export function hostStatusReadAt(host: HostEntry, now: number): string | null {
  return validReportTime(host.activeReportedAt, now);
}

/** Fecha de los datos de las filas, nunca la fecha de descubrimiento del objeto padre. */
export function latestHostsReport(inventory: HostsInventory, now = Date.now()): string | null {
  return inventory.hosts.flatMap(h => [h.reportedAt, h.activeReportedAt, h.connectionReportedAt, h.wifiSignal?.reportedAt])
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
