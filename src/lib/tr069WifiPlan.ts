export interface WifiNetwork {
  path: string;
  ssid: string | null;
  enabled: boolean | null;
  writable: boolean | null;
  timestamp: string | null;
  band: '2.4 GHz' | '5 GHz' | 'Banda desconocida';
}

export interface WifiInventory {
  found: boolean;
  deviceId: string | null;
  serial: string | null;
  lastInform: string | null;
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
  baselineInform: string | null;
  preparedAt: string;
}

/** Solo compara caché; no solicita lecturas al CPE ni afirma verificación física. */
export function compareWifiPlan(plan: WifiSsidPlan, inventory: WifiInventory): string {
  if (inventory.deviceId !== plan.deviceId || inventory.serial !== plan.serial) return 'Identidad distinta; detener';
  const network = inventory.networks.find(n => n.path === plan.path);
  if (!inventory.lastInform || !Number.isFinite(Date.parse(inventory.lastInform)) ||
    Date.parse(inventory.lastInform) <= Math.max(Date.parse(plan.preparedAt), Date.parse(plan.baselineInform ?? '') || 0)) {
    return 'Pendiente: no se ha observado un nuevo Inform posterior a la preparación';
  }
  if (!network || !network.timestamp || !Number.isFinite(Date.parse(network.timestamp)) ||
    !Number.isFinite(Date.parse(plan.baselineTimestamp)) || !Number.isFinite(Date.parse(plan.preparedAt)) ||
    Date.parse(network.timestamp) <= Math.max(Date.parse(plan.baselineTimestamp), Date.parse(plan.preparedAt))) {
    return 'Sin evidencia nueva en caché';
  }
  return network.ssid === plan.after
    ? 'SSID propuesto observado en caché nueva; falta confirmación del propietario'
    : 'Caché nueva con otro SSID; revisar antes de cualquier operación';
}
