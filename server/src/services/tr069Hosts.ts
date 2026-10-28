import { normalizeGponSerial, matchTr069Device } from '../../../src/lib/gponSerial';
import type { HostEntry, HostsInventory } from '../../../src/lib/tr069Hosts';
import { readHostWifiSignal } from './tr069HostsSignal';

type Node = { _value?: unknown; _timestamp?: string; _writable?: boolean; [key: string]: unknown };
export type HostsDevice = Node & { _id: string; _deviceId: { _SerialNumber: string }; _lastInform?: string };

function str(node: Node | undefined): string | null {
  return typeof node?._value === 'string' && node._value.length > 0 ? node._value : null;
}
function ts(node: Node | undefined): string | null {
  return typeof node?._timestamp === 'string' ? node._timestamp : null;
}
function bool(node: Node | undefined): boolean | null {
  return typeof node?._value === 'boolean' ? node._value : null;
}
/** Solo mapea valores TR-098 ya conocidos; uno desconocido queda sin inventar. */
function labelInterfaceType(value: string | null): 'WiFi' | 'Cable' | null {
  if (!value) return null;
  if (/^(802\.11|wlan|wifi)$/i.test(value.trim())) return 'WiFi';
  if (/^ethernet$/i.test(value.trim())) return 'Cable';
  return null;
}

/** GET NBI exclusivamente, solo lectura (caché ya reportada por el equipo, nunca
 * una tarea nueva). Identidad exacta por serial GPON: nunca mezcla datos de otra ONT. */
export async function readHostsDevice(nbiUrl: string, serial: string, request: typeof fetch = fetch): Promise<HostsDevice | null> {
  const canonical = normalizeGponSerial(serial);
  if (!canonical) throw new Error('Serial GPON inválido');
  const hex = [...canonical.slice(0, 4)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase() + canonical.slice(4);
  const query = encodeURIComponent(JSON.stringify({ '_deviceId._SerialNumber': { $in: [canonical, hex] } }));
  const projection = encodeURIComponent([
    // NBI excluye los campos no proyectados: conservar la identidad que valida
    // matchTr069Device, igual que readWifiInventory (que lee el documento completo).
    '_id', '_deviceId._SerialNumber',
    '_lastInform',
    'InternetGatewayDevice.LANDevice.1.Hosts._timestamp',
    'InternetGatewayDevice.LANDevice.1.Hosts.Host',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.OperatingFrequencyBand',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.OperatingFrequencyBand',
  ].join(','));
  const res = await request(`${nbiUrl}/devices/?query=${query}&projection=${projection}`, { method: 'GET', signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error('No se pudo consultar los dispositivos conectados');
  const rows = await res.json() as HostsDevice[];
  const match = matchTr069Device(canonical, rows.map(device => ({ device, cpe_serial: device._deviceId?._SerialNumber ?? null })));
  if (match.rejection === 'AMBIGUOUS') throw new Error('Identidad GenieACS ambigua; detener');
  if (!match.device) return null;
  const device = match.device.device;
  if (typeof device._id !== 'string' || !device._id) throw new Error('Identificador GenieACS inválido');
  return device;
}

export function hostsInventoryFromDevice(device: HostsDevice | null, serial: string): HostsInventory {
  const canonical = normalizeGponSerial(serial);
  if (!canonical) throw new Error('Serial GPON inválido');
  if (!device || !matchTr069Device(canonical, [{ cpe_serial: device._deviceId?._SerialNumber ?? null }]).device) {
    return { found: false, deviceId: null, serial: canonical, lastInform: null, hostsReportedAt: null, hosts: [] };
  }

  const root = device.InternetGatewayDevice as Node | undefined;
  const lan1 = (root?.LANDevice as Node | undefined)?.['1'] as Node | undefined;

  // Banda por MAC, solo con asociaciones WiFi REALMENTE observadas (AssociatedDevice) y banda
  // REALMENTE declarada (OperatingFrequencyBand) — nunca por número de instancia ni por nombre.
  const wifiMacToBand = new Map<string, '2.4 GHz' | '5 GHz'>();
  const wlans = lan1?.WLANConfiguration as Node | undefined;
  for (const [index, wlan] of Object.entries(wlans ?? {})) {
    if (!/^[1-9]\d*$/.test(index)) continue;
    const node = wlan as Node;
    const bandRaw = (node.OperatingFrequencyBand as Node | undefined)?._value;
    const band = bandRaw === '2.4GHz' ? '2.4 GHz' : bandRaw === '5GHz' ? '5 GHz' : null;
    const assoc = node.AssociatedDevice as Node | undefined;
    for (const [aIndex, aDevice] of Object.entries(assoc ?? {})) {
      if (!/^[1-9]\d*$/.test(aIndex)) continue;
      const mac = str((aDevice as Node).MACAddress as Node | undefined);
      if (mac && band) wifiMacToBand.set(mac.toUpperCase(), band);
    }
  }

  const hostsContainer = lan1?.Hosts as Node | undefined;
  const hostsNode = hostsContainer?.Host as Node | undefined;
  const hosts: HostEntry[] = [];
  for (const [index, host] of Object.entries(hostsNode ?? {})) {
    if (!/^[1-9]\d*$/.test(index)) continue;
    const node = host as Node;
    const mac = str(node.MACAddress as Node | undefined);
    const interfaceValue = str(node.InterfaceType as Node | undefined);
    const wifiBand = mac ? wifiMacToBand.get(mac.toUpperCase()) ?? null : null;
    const connection = labelInterfaceType(interfaceValue) ?? (wifiBand ? 'WiFi' : null);
    hosts.push({
      hostName: str(node.HostName as Node | undefined),
      ipAddress: str(node.IPAddress as Node | undefined),
      macAddress: mac,
      connection,
      connectionReportedAt: labelInterfaceType(interfaceValue) ? ts(node.InterfaceType as Node | undefined) : null,
      macReportedAt: ts(node.MACAddress as Node | undefined),
      layer2Interface: str(node.Layer2Interface as Node | undefined),
      layer2ReportedAt: ts(node.Layer2Interface as Node | undefined),
      wifiSignal: connection === 'WiFi' ? readHostWifiSignal(node, wlans) : null,
      band: connection === 'WiFi' ? wifiBand : null,
      active: bool(node.Active as Node | undefined),
      activeReportedAt: bool(node.Active as Node | undefined) !== null ? ts(node.Active as Node | undefined) : null,
      reportedAt: ts(node.HostName as Node | undefined) ?? ts(node.IPAddress as Node | undefined) ?? ts(node.MACAddress as Node | undefined),
    });
  }
  return { found: true, deviceId: device._id, serial: canonical,
    lastInform: typeof device._lastInform === 'string' ? device._lastInform : null,
    hostsReportedAt: ts(hostsContainer), hosts };
}

export async function readHostsInventory(nbiUrl: string, serial: string): Promise<HostsInventory> {
  return hostsInventoryFromDevice(await readHostsDevice(nbiUrl, serial), serial);
}
