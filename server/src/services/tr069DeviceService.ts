import { getPath } from './genieacsMetricsService';

// Acciones directas sobre una ONT via TR-069/GenieACS (setParameterValues,
// reboot, connection request), replicando la logica de
// server/scripts/set-tr069-pppoe.ts pero como servicio reusable desde el
// panel (seccion /tr069, uso exclusivo — ver Fase de PPPoE). La mayoria de
// los cambios se aplican solo en el proximo Inform del equipo (CPE-iniciado):
// este backend no tiene connection request hacia la red de clientes en dev,
// ver memoria del proyecto TR-069 (si funciona en produccion/on-prem).

interface GenieAcsParam {
  _value?: unknown;
  [child: string]: unknown;
}

type GenieAcsDevice = GenieAcsParam & { _id: string };

function walkForKey(root: GenieAcsParam, targetKey: string): string[] {
  const found: string[] = [];
  function walk(obj: GenieAcsParam, path: string) {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue;
      const val = obj[key] as GenieAcsParam;
      if (!val || typeof val !== 'object') continue;
      const newPath = path ? `${path}.${key}` : key;
      if (key === targetKey) {
        for (const instance of Object.keys(val)) {
          if (instance.startsWith('_')) continue;
          found.push(`${newPath}.${instance}`);
        }
        continue;
      }
      if (!('_value' in val)) walk(val, newPath);
    }
  }
  walk(root, '');
  return found;
}

async function findDeviceBySerial(nbiUrl: string, serial: string): Promise<GenieAcsDevice | null> {
  const query = encodeURIComponent(JSON.stringify({ '_deviceId._SerialNumber': serial }));
  const res = await fetch(`${nbiUrl}/devices/?query=${query}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GenieACS NBI respondio ${res.status}`);
  const rows = (await res.json()) as GenieAcsDevice[];
  return rows[0] ?? null;
}

function rootPrefix(device: GenieAcsDevice): { igd: GenieAcsParam | undefined; prefix: string } {
  const igd = (device.InternetGatewayDevice ?? device.Device) as GenieAcsParam | undefined;
  return { igd, prefix: device.InternetGatewayDevice ? 'InternetGatewayDevice' : 'Device' };
}

function wanPppPaths(device: GenieAcsDevice): string[] {
  const { igd, prefix } = rootPrefix(device);
  if (!igd) return [];
  return walkForKey(igd, 'WANPPPConnection').map((p) => `${prefix}.${p}`);
}

interface QueueTaskResult {
  ok: boolean;
  taskId?: string;
  error?: string;
}

async function queueTask(nbiUrl: string, deviceId: string, task: Record<string, unknown>): Promise<QueueTaskResult> {
  const res = await fetch(`${nbiUrl}/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => null)) as { _id?: string } | null;
  if (!res.ok) return { ok: false, error: `GenieACS respondio ${res.status}: ${JSON.stringify(body)}` };
  return { ok: true, taskId: body?._id };
}

// ---- PPPoE (WANPPPConnection) ----

export interface PppoeInfo {
  found: boolean;
  username: string | null;
}

/** Lee el usuario PPPoE actual del equipo (segun el ultimo Inform cacheado en GenieACS). */
export async function getPppoeInfo(nbiUrl: string, serial: string): Promise<PppoeInfo> {
  const device = await findDeviceBySerial(nbiUrl, serial);
  if (!device) return { found: false, username: null };
  const paths = wanPppPaths(device);
  if (!paths.length) return { found: true, username: null };
  const username = getPath(device, `${paths[0]}.Username`)?._value;
  return { found: true, username: username != null ? String(username) : null };
}

export interface DeviceChangeResult {
  ok: boolean;
  queued: boolean;
  discovering: boolean; // aun no aparece el objeto esperado; se encolo un refreshObject para descubrirlo
  taskId?: string;
  error?: string;
}

/** Encola el cambio de usuario/clave PPPoE. Requiere al menos uno de los dos. */
export async function queuePppoeChange(
  nbiUrl: string,
  serial: string,
  changes: { username?: string; password?: string },
): Promise<DeviceChangeResult> {
  if (!changes.username && !changes.password) {
    return { ok: false, queued: false, discovering: false, error: 'Falta usuario y/o clave a cambiar' };
  }

  const device = await findDeviceBySerial(nbiUrl, serial);
  if (!device) {
    return { ok: false, queued: false, discovering: false, error: 'Dispositivo no encontrado en GenieACS (nunca informo TR-069, o el ACS URL esta mal)' };
  }

  const paths = wanPppPaths(device);
  if (!paths.length) {
    const objectName = device.InternetGatewayDevice
      ? 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1'
      : 'Device.IP.Interface.1';
    const result = await queueTask(nbiUrl, device._id, { name: 'refreshObject', objectName });
    return { ok: result.ok, queued: false, discovering: true, error: result.error };
  }

  const basePath = paths[0];
  const parameterValues: [string, string, string][] = [];
  if (changes.username) parameterValues.push([`${basePath}.Username`, changes.username, 'xsd:string']);
  if (changes.password) parameterValues.push([`${basePath}.Password`, changes.password, 'xsd:string']);

  const result = await queueTask(nbiUrl, device._id, { name: 'setParameterValues', parameterValues });
  return { ok: result.ok, queued: result.ok, discovering: false, taskId: result.taskId, error: result.error };
}

// ---- WiFi (WLANConfiguration) ----

export interface WifiNetwork {
  path: string; // ej InternetGatewayDevice.LANDevice.1.WLANConfiguration.1
  ssid: string | null;
}

/** Lista las redes WiFi activas del equipo (Enable=true), con su SSID actual. */
export async function getWifiNetworks(nbiUrl: string, serial: string): Promise<{ found: boolean; networks: WifiNetwork[] }> {
  const device = await findDeviceBySerial(nbiUrl, serial);
  if (!device) return { found: false, networks: [] };
  const { igd, prefix } = rootPrefix(device);
  if (!igd) return { found: true, networks: [] };
  const paths = walkForKey(igd, 'WLANConfiguration').map((p) => `${prefix}.${p}`);
  const networks = paths
    .filter((p) => getPath(device, `${p}.Enable`)?._value === true)
    .map((p) => {
      const ssid = getPath(device, `${p}.SSID`)?._value;
      return { path: p, ssid: ssid != null ? String(ssid) : null };
    });
  return { found: true, networks };
}

/** Cambia SSID y/o clave de UNA red WiFi puntual (path de getWifiNetworks). */
export async function queueWifiChange(
  nbiUrl: string,
  serial: string,
  wlanPath: string,
  changes: { ssid?: string; password?: string },
): Promise<DeviceChangeResult> {
  if (!changes.ssid && !changes.password) {
    return { ok: false, queued: false, discovering: false, error: 'Falta el SSID y/o la clave a cambiar' };
  }
  const device = await findDeviceBySerial(nbiUrl, serial);
  if (!device) {
    return { ok: false, queued: false, discovering: false, error: 'Dispositivo no encontrado en GenieACS (nunca informo TR-069, o el ACS URL esta mal)' };
  }
  const parameterValues: [string, string, string][] = [];
  if (changes.ssid) parameterValues.push([`${wlanPath}.SSID`, changes.ssid, 'xsd:string']);
  if (changes.password) parameterValues.push([`${wlanPath}.KeyPassphrase`, changes.password, 'xsd:string']);

  const result = await queueTask(nbiUrl, device._id, { name: 'setParameterValues', parameterValues });
  return { ok: result.ok, queued: result.ok, discovering: false, taskId: result.taskId, error: result.error };
}

// ---- Reiniciar ----

export async function queueReboot(nbiUrl: string, serial: string): Promise<DeviceChangeResult> {
  const device = await findDeviceBySerial(nbiUrl, serial);
  if (!device) {
    return { ok: false, queued: false, discovering: false, error: 'Dispositivo no encontrado en GenieACS (nunca informo TR-069, o el ACS URL esta mal)' };
  }
  const result = await queueTask(nbiUrl, device._id, { name: 'reboot' });
  return { ok: result.ok, queued: result.ok, discovering: false, taskId: result.taskId, error: result.error };
}

// ---- Refrescar ahora (connection request) ----

/**
 * Pide al equipo que reporte su estado ya, en vez de esperar al proximo
 * Inform periodico. Requiere que el ACS (este backend) tenga ruta de red
 * hacia el CPE — en un laptop de desarrollo sin esa ruta, GenieACS igual
 * encola la tarea pero el "connection request" en si puede fallar
 * silenciosamente (el equipo la recoge recien en su proximo Inform normal).
 */
export async function queueRefresh(nbiUrl: string, serial: string): Promise<DeviceChangeResult> {
  const device = await findDeviceBySerial(nbiUrl, serial);
  if (!device) {
    return { ok: false, queued: false, discovering: false, error: 'Dispositivo no encontrado en GenieACS (nunca informo TR-069, o el ACS URL esta mal)' };
  }
  const { prefix } = rootPrefix(device);
  const result = await queueTask(nbiUrl, device._id, { name: 'refreshObject', objectName: `${prefix}.DeviceInfo` });
  return { ok: result.ok, queued: result.ok, discovering: false, taskId: result.taskId, error: result.error };
}

// ---- Aprovisionar (PPPoE + WiFi en una sola pasada) ----

export interface ProvisionChanges {
  pppoeUsername?: string;
  pppoePassword?: string;
  wifiSsid?: string;
  wifiPassword?: string;
  wlanPath?: string; // si no se pasa, usa la primera red WiFi activa encontrada
}

export interface ProvisionResult {
  ok: boolean;
  pppoe?: DeviceChangeResult;
  wifi?: DeviceChangeResult;
  error?: string;
}

/** Aplica PPPoE y WiFi de una sola vez (pensado para instalaciones nuevas). */
export async function queueProvision(nbiUrl: string, serial: string, changes: ProvisionChanges): Promise<ProvisionResult> {
  const wantsPppoe = changes.pppoeUsername || changes.pppoePassword;
  const wantsWifi = changes.wifiSsid || changes.wifiPassword;
  if (!wantsPppoe && !wantsWifi) return { ok: false, error: 'No hay ningun cambio para aplicar' };

  const results: ProvisionResult = { ok: true };

  if (wantsPppoe) {
    results.pppoe = await queuePppoeChange(nbiUrl, serial, { username: changes.pppoeUsername, password: changes.pppoePassword });
    if (!results.pppoe.ok) results.ok = false;
  }

  if (wantsWifi) {
    let wlanPath = changes.wlanPath;
    if (!wlanPath) {
      const { networks } = await getWifiNetworks(nbiUrl, serial);
      wlanPath = networks[0]?.path;
    }
    if (!wlanPath) {
      results.wifi = { ok: false, queued: false, discovering: false, error: 'No se encontro ninguna red WiFi activa en el equipo' };
      results.ok = false;
    } else {
      results.wifi = await queueWifiChange(nbiUrl, serial, wlanPath, { ssid: changes.wifiSsid, password: changes.wifiPassword });
      if (!results.wifi.ok) results.ok = false;
    }
  }

  return results;
}
