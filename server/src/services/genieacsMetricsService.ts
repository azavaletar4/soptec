import { supabaseAdmin } from '../lib/supabaseAdmin';

// Adaptado de REPLICA-TR069-GENIEACS.md seccion 9: rutas TR-069 candidatas
// por metrica (multi-marca) — el indice de la ruta que matcheo indica el
// fabricante, y de ahi la unidad real del valor (ver normalizePower/Temp).
const RX_POWER_PATHS = [
  'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower', // Huawei (typo intencional del fabricante)
  'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower', // ZTE/CMCC
  'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower', // China Telecom
];
const TX_POWER_PATHS = [
  'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower',
  'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.TXPower',
  'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower',
];
const TEMPERATURE_PATHS = [
  'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TransceiverTemperature',
  'InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.TransceiverTemperature',
];
const UPTIME_PATHS = ['InternetGatewayDevice.DeviceInfo.UpTime', 'Device.DeviceInfo.UpTime'];
const CONNECTION_STATUS_PATHS = [
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionStatus',
  'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus',
];

// index 0 = Huawei (valor ya en la unidad final). index 1/2 = ZTE/CMCC/China
// Telecom (unidades crudas SFF-8472, hay que convertir).
const HUAWEI_PATH_INDEX = 0;

export function getPath(dev: unknown, path: string): { _value?: unknown } | undefined {
  return path.split('.').reduce<unknown>((obj, key) => {
    if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
    return undefined;
  }, dev) as { _value?: unknown } | undefined;
}

function findRaw(dev: unknown, paths: string[]): { value: number; pathIndex: number } | null {
  for (let i = 0; i < paths.length; i++) {
    const param = getPath(dev, paths[i]);
    if (param?._value !== undefined && param._value !== null && param._value !== '') {
      const num = Number(param._value);
      if (!Number.isNaN(num)) return { value: num, pathIndex: i };
    }
  }
  return null;
}

/** Potencia optica: Huawei ya viene en dBm; ZTE/CMCC viene en decimas de µW (SFF-8472). */
function normalizePower(raw: { value: number; pathIndex: number }): number {
  if (raw.pathIndex === HUAWEI_PATH_INDEX) return raw.value;
  if (raw.value <= 0) return raw.value; // evita log(0)/negativos raros
  return 10 * Math.log10(raw.value / 10000);
}

/** Temperatura: Huawei en grados C; ZTE en 1/256 de grado C. */
function normalizeTemperature(raw: { value: number; pathIndex: number }): number {
  if (raw.pathIndex === HUAWEI_PATH_INDEX) return raw.value;
  return raw.value / 256;
}

export interface ExtractedMetrics {
  rxPower: number | null;
  txPower: number | null;
  temperature: number | null;
  uptime: number | null;
  connectionStatus: string | null;
}

export function extractMetricsFromGenieAcs(dev: unknown): ExtractedMetrics {
  const rx = findRaw(dev, RX_POWER_PATHS);
  const tx = findRaw(dev, TX_POWER_PATHS);
  const temp = findRaw(dev, TEMPERATURE_PATHS);
  const uptimeRaw = findRaw(dev, UPTIME_PATHS);
  const statusParam = CONNECTION_STATUS_PATHS.map((p) => getPath(dev, p)).find((p) => p?._value !== undefined);

  return {
    rxPower: rx ? Number(normalizePower(rx).toFixed(2)) : null,
    txPower: tx ? Number(normalizePower(tx).toFixed(2)) : null,
    temperature: temp ? Number(normalizeTemperature(temp).toFixed(2)) : null,
    uptime: uptimeRaw ? Math.round(uptimeRaw.value) : null,
    connectionStatus: statusParam?._value != null ? String(statusParam._value) : null,
  };
}

/** Consulta un device puntual al NBI de GenieACS por su _id. */
export async function fetchGenieAcsDevice(nbiUrl: string, genieacsId: string): Promise<unknown | null> {
  const query = encodeURIComponent(JSON.stringify({ _id: genieacsId }));
  const res = await fetch(`${nbiUrl}/devices/?query=${query}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GenieACS NBI respondio ${res.status}`);
  const rows = (await res.json()) as unknown[];
  return rows[0] ?? null;
}

/** Recolecta y guarda metricas para un tr069_device ya registrado en SmartRayco. */
export async function collectMetricsForDevice(nbiUrl: string, tr069DeviceId: string, genieacsId: string) {
  const dev = await fetchGenieAcsDevice(nbiUrl, genieacsId);
  if (!dev) return { ok: false, error: 'Dispositivo no encontrado en GenieACS' };

  const metrics = extractMetricsFromGenieAcs(dev);
  const { error } = await supabaseAdmin.from('tr069_performance_metrics').insert({
    tr069_device_id: tr069DeviceId,
    rx_power: metrics.rxPower,
    tx_power: metrics.txPower,
    temperature: metrics.temperature,
    uptime: metrics.uptime,
    connection_status: metrics.connectionStatus,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, metrics };
}
