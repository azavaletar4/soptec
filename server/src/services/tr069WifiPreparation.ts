import { normalizeGponSerial, matchTr069Device } from '../../../src/lib/gponSerial';
import type { WifiInventory, WifiSsidPlan } from '../../../src/lib/tr069WifiPlan';

type Node = { _value?: unknown; _timestamp?: string; _writable?: boolean; [key: string]: unknown };
type Device = Node & { _id: string; _deviceId: { _SerialNumber: string } };
export const WIFI_TEST_SERIAL = 'HWTC1D3691B7';
export const WIFI_TEST_DEVICE = '00259E-HG8145X6%2D13-485754431D3691B7';

/** GET NBI exclusivamente. Ambas representaciones completas, nunca por sufijo. */
export async function readWifiInventory(nbiUrl: string, serial: string): Promise<WifiInventory> {
  const canonical = normalizeGponSerial(serial);
  if (!canonical) throw new Error('Serial GPON inválido');
  const hex = [...canonical.slice(0, 4)].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase() + canonical.slice(4);
  const query = encodeURIComponent(JSON.stringify({ '_deviceId._SerialNumber': { $in: [canonical, hex] } }));
  const res = await fetch(`${nbiUrl}/devices/?query=${query}`, { method: 'GET', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error('No se pudo consultar la caché WiFi');
  const rows = await res.json() as Device[];
  const match = matchTr069Device(canonical, rows.map(device => ({ device, cpe_serial: device._deviceId?._SerialNumber ?? null })));
  if (match.rejection === 'AMBIGUOUS') throw new Error('Identidad GenieACS ambigua; detener');
  if (!match.device) return { found: false, deviceId: null, serial: canonical, networks: [] };
  const device = match.device.device;
  if (typeof device._id !== 'string' || !device._id) throw new Error('Identificador GenieACS inválido');
  const networks: WifiInventory['networks'] = [];
  const root = device.InternetGatewayDevice as Node | undefined;
  const lans = root?.LANDevice as Node | undefined;
  for (const [lanIndex, lan] of Object.entries(lans ?? {})) {
    if (!/^[1-9]\d*$/.test(lanIndex)) continue;
    const wlans = (lan as Node).WLANConfiguration as Node | undefined;
    for (const [index, wlan] of Object.entries(wlans ?? {})) {
      if (!/^[1-9]\d*$/.test(index)) continue;
      const node = wlan as Node;
      const ssid = node.SSID as Node | undefined;
      const enabled = (node.Enable as Node | undefined)?._value;
      networks.push({
        path: `InternetGatewayDevice.LANDevice.${lanIndex}.WLANConfiguration.${index}`,
        ssid: typeof ssid?._value === 'string' ? ssid._value : null,
        enabled: typeof enabled === 'boolean' ? enabled : null,
        writable: typeof ssid?._writable === 'boolean' ? ssid._writable : null,
        timestamp: typeof ssid?._timestamp === 'string' ? ssid._timestamp : null,
      });
    }
  }
  return { found: true, deviceId: device._id, serial: canonical, networks };
}

export async function prepareWifiSsid(nbiUrl: string, serial: string, input: unknown): Promise<WifiSsidPlan> {
  if (normalizeGponSerial(serial) !== WIFI_TEST_SERIAL) throw new Error('Preparación limitada a la Huawei de prueba');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Solicitud inválida');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(k => !['deviceId', 'path', 'ssid', 'expectedSsid', 'expectedTimestamp', 'confirmed'].includes(k))) {
    throw new Error('Solo se permite preparar un SSID; sin contraseñas ni PPPoE');
  }
  if (body.confirmed !== true) throw new Error('Falta confirmar la preparación');
  if (typeof body.ssid !== 'string' || !body.ssid.trim() || Buffer.byteLength(body.ssid, 'utf8') > 32 || /[\x00-\x1f\x7f]/.test(body.ssid)) {
    throw new Error('SSID inválido: entre 1 y 32 bytes, sin caracteres de control');
  }
  const inventory = await readWifiInventory(nbiUrl, serial);
  if (inventory.deviceId !== WIFI_TEST_DEVICE || body.deviceId !== inventory.deviceId) throw new Error('Dispositivo GenieACS distinto; detener');
  const network = inventory.networks.find(n => n.path === body.path);
  if (!network || network.ssid === null || !network.timestamp || !Number.isFinite(Date.parse(network.timestamp))) throw new Error('Red sin respaldo SSID recuperable');
  if (network.enabled === false || network.writable === false) throw new Error('Red desactivada o SSID no escribible según caché');
  if (body.expectedSsid !== network.ssid || body.expectedTimestamp !== network.timestamp) throw new Error('La caché cambió; vuelva a consultar y confirmar');
  if (body.ssid === network.ssid) throw new Error('El SSID nuevo debe ser diferente');
  return { mode: 'preparation_only', deviceId: inventory.deviceId, serial: WIFI_TEST_SERIAL,
    path: network.path, before: network.ssid, after: body.ssid, baselineTimestamp: network.timestamp, preparedAt: new Date().toISOString() };
}
