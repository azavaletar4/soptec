export interface WifiNetwork {
  path: string;
  ssid: string | null;
  enabled: boolean | null;
  writable: boolean | null;
  timestamp: string | null;
}

export interface WifiInventory {
  found: boolean;
  deviceId: string | null;
  serial: string | null;
  networks: WifiNetwork[];
}

export interface WifiSsidPlan {
  mode: 'preparation_only';
  deviceId: string;
  serial: string;
  path: string;
  before: string;
  after: string;
  baselineTimestamp: string;
  preparedAt: string;
}

/** Solo compara caché; no solicita lecturas al CPE ni afirma verificación física. */
export function compareWifiPlan(plan: WifiSsidPlan, inventory: WifiInventory): string {
  if (inventory.deviceId !== plan.deviceId || inventory.serial !== plan.serial) return 'Identidad distinta; detener';
  const network = inventory.networks.find(n => n.path === plan.path);
  if (!network || !network.timestamp || !Number.isFinite(Date.parse(network.timestamp)) ||
    !Number.isFinite(Date.parse(plan.baselineTimestamp)) || !Number.isFinite(Date.parse(plan.preparedAt)) ||
    Date.parse(network.timestamp) <= Math.max(Date.parse(plan.baselineTimestamp), Date.parse(plan.preparedAt))) {
    return 'Sin evidencia nueva en caché';
  }
  return network.ssid === plan.after
    ? 'SSID propuesto observado en caché nueva; falta confirmación del propietario'
    : 'Caché nueva con otro SSID; revisar antes de cualquier operación';
}
