import { normalizeHostMac, type HostWifiSignal } from '../../../src/lib/tr069Hosts';

type Node = Record<string, any>;
const root = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.';

export interface FirmwareIdentity {
  oui: string | null;
  productClass: string | null;
  softwareVersion: string | null;
}

/**
 * Modelos/firmware Huawei donde se confirmó, con evidencia real cruzada
 * contra la propia interfaz de la ONT (2026-10-29: RSSI -39 dBm en la ONT
 * vs. X_HW_RSSI=-40 reportado por TR-069 para el mismo host, diferencia
 * coherente con el desfase entre ambas lecturas), que `X_HW_RSSI` SÍ está
 * en dBm aunque el equipo no declare `X_HW_RSSIUnit`. Alcance exacto por
 * fabricante+modelo+firmware — agregar aquí solo tras verificar cada
 * combinación nueva por separado; nunca generalizar a otra ONT/firmware
 * sin esa misma verificación (ver docs/TR069-HOSTS-SENAL-WIFI-*.md).
 */
const VERIFIED_X_HW_RSSI_DBM_FIRMWARE: readonly FirmwareIdentity[] = [
  { oui: '00259E', productClass: 'HG8145X6-13', softwareVersion: 'V5R023C00S342' },
];

function isVerifiedXHwRssiFirmware(identity: FirmwareIdentity | undefined): boolean {
  if (!identity || !identity.oui || !identity.productClass || !identity.softwareVersion) return false;
  return VERIFIED_X_HW_RSSI_DBM_FIRMWARE.some(v =>
    v.oui === identity.oui && v.productClass === identity.productClass && v.softwareVersion === identity.softwareVersion);
}

/** Solo señal con unidad dBm explícita (o, exclusivamente para X_HW_RSSI en un
 * firmware verificado por separado — ver arriba, nunca por defecto) con MAC
 * exacta y la WLAN referenciada por el Host. Un firmware no verificado nunca
 * interpreta X_HW_RSSI como dBm ni porcentaje, aunque el valor sea plausible. */
export function readHostWifiSignal(host: Node, wlans: Node | undefined, identity?: FirmwareIdentity): HostWifiSignal | null {
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
  const verifiedVendorDbm = isVerifiedXHwRssiFirmware(identity);
  const values: HostWifiSignal[] = [];
  for (const node of candidates) {
    for (const name of ['X_HW_RSSI', 'RSSI', 'SignalStrength']) {
      const field = node[name], unit = node[name + 'Unit'];
      // Solo X_HW_RSSI, y solo en un firmware ya verificado por separado, no
      // necesita que el propio equipo declare la unidad (nunca la declara).
      const unitConfirmedByFirmware = name === 'X_HW_RSSI' && verifiedVendorDbm;
      if (typeof field?._value !== 'number' || !Number.isInteger(field._value) || field._value < -120 || field._value >= 0) continue;
      if (!unitConfirmedByFirmware && unit?._value !== 'dBm') continue;
      const macLeaf = normalizeHostMac(node.AssociatedDeviceMACAddress?._value) === mac ? node.AssociatedDeviceMACAddress : node.MACAddress;
      const macAt = macLeaf?._timestamp;
      const unitAt = unitConfirmedByFirmware ? field._timestamp : unit?._timestamp;
      if (typeof field._timestamp !== 'string' || typeof unitAt !== 'string' || typeof macAt !== 'string') continue;
      values.push({ dbm: field._value, unit: 'dBm', reportedAt: field._timestamp, unitReportedAt: unitAt, macReportedAt: macAt, macAddress: mac, wlanPath: path });
    }
  }
  // Fuentes contradictorias tampoco son señal verificable.
  if (!values.length || values.some(v => v.dbm !== values[0]!.dbm)) return null;
  return values[0]!;
}
