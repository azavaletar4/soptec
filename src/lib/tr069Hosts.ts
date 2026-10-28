/** Un dispositivo conectado tal como lo reporta el propio equipo — nunca inventado.
 * Cualquier campo que el equipo no reporte queda en null (el panel lo muestra como
 * "No disponible"), nunca se asume un valor. */
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
  /** Fecha real (UTC) de la última vez que el equipo reportó este registro —
   * nunca la hora en que se renderiza la pantalla. */
  reportedAt: string | null;
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
