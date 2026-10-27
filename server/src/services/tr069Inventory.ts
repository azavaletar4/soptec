import type { Tr069InventorySnapshot, Tr069LiveDevice } from '../../../src/types/tr069Inventory';

type NbiDevice = Record<string, unknown> & { _id: string };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const parameter = (value: unknown): string | null => {
  const raw = object(value)._value;
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null;
};

function describe(device: NbiDevice): Tr069LiveDevice {
  const root = object(device.InternetGatewayDevice ?? device.Device);
  const info = object(root.DeviceInfo), identity = object(device._deviceId);
  const parts = device._id.split('-');
  let wan: string | null = null, ssid: string | null = null;
  for (const w of Object.values(object(root.WANDevice))) {
    for (const c of Object.values(object(object(w).WANConnectionDevice))) {
      for (const kind of ['WANPPPConnection', 'WANIPConnection']) {
        for (const entry of Object.values(object(object(c)[kind]))) wan ??= parameter(object(entry).ExternalIPAddress);
      }
    }
  }
  for (const lan of Object.values(object(root.LANDevice))) {
    for (const wlan of Object.values(object(object(lan).WLANConfiguration))) ssid ??= parameter(object(wlan).SSID);
  }
  return {
    genieacs_id: device._id,
    cpe_serial: text(identity._SerialNumber) ?? parameter(info.SerialNumber) ?? parts.at(-1)!,
    cpe_oui: text(identity._OUI) ?? parts[0] ?? null,
    cpe_product_class: text(identity._ProductClass) ?? (parts.length > 2 ? parts.slice(1, -1).join('-').replace(/%2d/gi, '-') : null),
    last_seen_at: text(device._lastInform),
    model_name: parameter(info.ModelName) ?? parameter(info.Manufacturer),
    firmware_version: parameter(info.SoftwareVersion), wan_ip: wan, ssid,
  };
}

async function completeResponse(response: Response): Promise<NbiDevice[]> {
  if (response.status !== 200 || response.redirected || response.headers.has('content-range')
    || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('No se pudo verificar el inventario completo de GenieACS.');
  }
  // NBI 1.2.16 publica el total de la colección incluso cuando se solicita limit/skip.
  const header = response.headers.get('total');
  if (header == null || !/^(0|[1-9]\d*)$/.test(header) || !Number.isSafeInteger(Number(header))) {
    throw new Error('GenieACS no confirmó el total de dispositivos.');
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.length !== Number(header)) throw new Error('Respuesta incompleta de GenieACS.');
  const ids = new Set<string>();
  for (const value of data) {
    const row = object(value), id = text(row._id);
    if (!id || ids.has(id) || (row._lastInform != null && !Number.isFinite(Date.parse(String(row._lastInform))))) {
      throw new Error('Inventario de GenieACS inválido o duplicado.');
    }
    ids.add(id);
  }
  return data as NbiDevice[];
}

const projection = [
  '_id', '_deviceId', '_lastInform',
  ...['InternetGatewayDevice', 'Device'].flatMap(root => [
    ...['SerialNumber', 'ModelName', 'Manufacturer', 'SoftwareVersion'].map(p => `${root}.DeviceInfo.${p}`),
    // Estas ramas se reducen a IP/SSID al describir el CPE; nunca se devuelven claves.
    `${root}.WANDevice`, `${root}.LANDevice`,
  ]),
].join(',');

export async function readTr069Inventory(nbi: string, read: typeof fetch = fetch): Promise<Tr069InventorySnapshot> {
  const signal = AbortSignal.timeout(30_000);
  const url = new URL(nbi.replace(/\/$/, '') + '/devices');
  url.searchParams.set('projection', projection);
  const options = { signal, redirect: 'error' as const, cache: 'no-store' as const };
  const devices = await completeResponse(await read(url.toString(), options));
  // Una segunda enumeración de identidades detecta altas/bajas durante la lectura,
  // incluso si el número total no cambió. Una duda no acredita una ausencia.
  url.searchParams.set('projection', '_id');
  const verified = await completeResponse(await read(url.toString(), options));
  const ids = new Set(verified.map(d => d._id));
  if (ids.size !== devices.length || devices.some(d => !ids.has(d._id))) throw new Error('El inventario cambió durante la consulta; vuelve a actualizar.');
  return { checkedAt: new Date().toISOString(), total: devices.length, devices: devices.map(describe) };
}

export interface Tr069InventoryRepository {
  list(): Promise<{ id: string; genieacs_id: string }[]>;
  update(id: string, cache: Omit<Tr069LiveDevice, 'genieacs_id' | 'cpe_serial' | 'cpe_oui' | 'cpe_product_class'>): Promise<void>;
  insert(device: Tr069LiveDevice): Promise<void>;
}

/** Ausentes: no se escribe nada. Las asociaciones e históricos no se modifican. */
export async function synchronizeTr069Inventory(snapshot: Tr069InventorySnapshot, repository: Tr069InventoryRepository) {
  const existing = new Map((await repository.list()).map(row => [row.genieacs_id, row.id]));
  let synced = 0, created = 0;
  for (const device of snapshot.devices) {
    const id = existing.get(device.genieacs_id);
    if (id) {
      const { genieacs_id: _id, cpe_serial: _serial, cpe_oui: _oui, cpe_product_class: _product, ...cache } = device;
      await repository.update(id, cache);
      synced++;
    } else {
      await repository.insert(device);
      created++;
    }
  }
  return { ok: true as const, synced, created, total: snapshot.total, inventory: snapshot };
}
