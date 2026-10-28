import { normalizeHostMac, type HostWifiSignal } from '../../../src/lib/tr069Hosts';

type Node = Record<string, any>;
const root = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.';

/** Solo señal con unidad dBm explícita, MAC exacta y la WLAN referenciada por el Host.
 * X_HW_RSSI sin unidad verificada nunca se interpreta como dBm ni porcentaje. */
export function readHostWifiSignal(host: Node, wlans: Node | undefined): HostWifiSignal | null {
  const mac = normalizeHostMac(host.MACAddress?._value);
  const path = host.Layer2Interface?._value;
  if (!mac || typeof path !== 'string' || !path.startsWith(root)) return null;
  const index = path.slice(root.length);
  if (!/^[1-9]\d*$/.test(index) || !wlans?.[index]) return null;
  const candidates: Node[] = [];
  // Una señal en el propio Host ya pertenece a esa instancia/MAC e interfaz.
  if (host.X_HW_RSSI) candidates.push(host);
  const matches = Object.entries(wlans[index].AssociatedDevice ?? {}).filter(([key, value]) => {
    if (!/^[1-9]\d*$/.test(key)) return false;
    const node = value as Node;
    const standard = normalizeHostMac(node.AssociatedDeviceMACAddress?._value);
    const legacy = normalizeHostMac(node.MACAddress?._value);
    return (!standard || !legacy || standard === legacy) && (standard ?? legacy) === mac;
  });
  if (matches.length > 1) return null; // Asociación ambigua: no elegir la primera.
  if (matches.length === 1) candidates.push(matches[0]![1] as Node);
  const values: HostWifiSignal[] = [];
  for (const node of candidates) {
    for (const name of ['X_HW_RSSI', 'RSSI', 'SignalStrength']) {
      const field = node[name], unit = node[name + 'Unit'];
      if (typeof field?._value !== 'number' || !Number.isInteger(field._value) || field._value < -120 || field._value >= 0 || unit?._value !== 'dBm') continue;
      const macLeaf = normalizeHostMac(node.AssociatedDeviceMACAddress?._value) === mac ? node.AssociatedDeviceMACAddress : node.MACAddress;
      const macAt = macLeaf?._timestamp;
      if (typeof field._timestamp !== 'string' || typeof unit._timestamp !== 'string' || typeof macAt !== 'string') continue;
      values.push({ dbm: field._value, unit: 'dBm', reportedAt: field._timestamp, unitReportedAt: unit._timestamp, macReportedAt: macAt, macAddress: mac, wlanPath: path });
    }
  }
  // Fuentes contradictorias tampoco son señal verificable.
  if (!values.length || values.some(v => v.dbm !== values[0]!.dbm)) return null;
  return values[0]!;
}
