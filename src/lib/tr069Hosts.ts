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

export function hostStatusLabel(host: HostEntry, lastInform: string | null, now: number): string {
  const recent = (raw: string | null | undefined) => {
    const time = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(time) && time <= now && now - time <= HOST_STATUS_MAX_AGE_MS;
  };
  if (typeof host.active !== 'boolean' || !recent(host.activeReportedAt) || !recent(lastInform)) return 'Sin confirmar';
  return host.active ? 'Conectado' : 'Desconectado';
}

/** Fecha de los datos de las filas, nunca la fecha de descubrimiento del objeto padre. */
export function latestHostsReport(inventory: HostsInventory): string | null {
  return inventory.hosts.map(h => h.reportedAt).filter((t): t is string => !!t && Number.isFinite(Date.parse(t)))
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
