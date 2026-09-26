import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';

// Analitica de trafico (Fase 36) — muestrea la interfaz PPPoE dinamica de
// cada cliente activo (creada por RouterOS con el mismo nombre que el
// usuario PPPoE) para construir series de tiempo de consumo, sin depender
// de simple queues ni de un dashboard externo. Ver la migracion
// 20260930030000_fase36_analitica_trafico.sql para el porque de las
// columnas download_bytes/upload_bytes (ya normalizadas al punto de vista
// del cliente, no al de "rx/tx" del router).

interface MikrotikDeviceRow {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
}

interface ContractRow {
  id: string;
  pppoe_username: string;
}

interface CounterStateRow {
  contract_id: string;
  last_rx_bytes: number;
  last_tx_bytes: number;
  updated_at: string;
}

interface MikrotikInterface {
  name: string;
  type?: string;
  running?: string;
  'rx-byte'?: string;
  'tx-byte'?: string;
}

// RouterOS nombra la interfaz dinamica de cada sesion PPPoE como
// "<pppoe-USUARIO>" (confirmado contra un router real en produccion,
// 2026-09-24) — no como el username plano. Sin este parseo, el cruce contra
// service_contracts.pppoe_username nunca encuentra coincidencias.
function pppoeUsernameFromInterfaceName(name: string): string | null {
  const match = /^<pppoe-(.+)>$/.exec(name);
  return match ? match[1] : null;
}

export interface TrafficSampleReport {
  ranAt: string;
  runId: string;
  devicesChecked: number;
  contractsChecked: number;
  samplesInserted: number;
  baselinesInitialized: number;
  errors: { deviceName: string; message: string }[];
}

let lastReport: TrafficSampleReport | null = null;

export function getLastTrafficSampleReport(): TrafficSampleReport | null {
  return lastReport;
}

function targetFor(device: MikrotikDeviceRow): MikrotikTarget {
  return { host: device.host, port: device.port, useTls: device.use_tls, username: device.username, password: device.password };
}

// El intervalo real entre muestras puede variar (backend reiniciado, un
// ciclo que tardo mas de lo normal) — se calcula del timestamp guardado en
// vez de asumir el intervalo nominal del scheduler. Se acota a un minimo de
// 30s (evita division por un intervalo casi cero si algo dispara el
// muestreo dos veces seguidas) y a un maximo de 6h (si el backend estuvo
// caido mas tiempo que eso, un delta de bytes acumulado en tantas horas ya
// no sirve como "tasa" representativa — se descarta esa muestra).
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 6 * 60 * 60;

/**
 * Corre un ciclo de muestreo contra todos los MikroTik activos. Pensado para
 * llamarse desde trafficAnalyticsScheduler (setInterval), igual que
 * reconcileMikrotik. Sigue con el siguiente router si uno falla.
 */
export async function sampleTrafficUsage(): Promise<TrafficSampleReport> {
  const runId = randomUUID();
  const now = new Date();

  const { data: devices, error: devErr } = await supabaseAdmin
    .from('mikrotik_devices')
    .select('id, name, host, port, use_tls, username, password')
    .eq('is_active', true);
  if (devErr) throw new Error(devErr.message);

  const errors: { deviceName: string; message: string }[] = [];
  let contractsChecked = 0;
  let samplesInserted = 0;
  let baselinesInitialized = 0;

  // Secuencial (no Promise.all): son routers distintos asi que no hay el
  // problema de sesion unica que si aplica a Telnet/OLT, pero de todas
  // formas evita saturar CPEs de gama baja con N requests REST simultaneos.
  for (const device of (devices ?? []) as MikrotikDeviceRow[]) {
    const target = targetFor(device);

    let interfaces: MikrotikInterface[];
    try {
      interfaces = await mikrotikRequest<MikrotikInterface[]>(target, '/interface');
    } catch (e) {
      errors.push({ deviceName: device.name, message: e instanceof Error ? e.message : 'Error al consultar el router' });
      continue;
    }

    const ifaceByUsername = new Map<string, MikrotikInterface>();
    for (const iface of interfaces) {
      if (iface.type !== 'pppoe-in') continue;
      const username = pppoeUsernameFromInterfaceName(iface.name);
      if (username) ifaceByUsername.set(username, iface);
    }
    if (ifaceByUsername.size === 0) continue;

    const { data: contracts, error: ctErr } = await supabaseAdmin
      .from('service_contracts')
      .select('id, pppoe_username')
      .eq('mikrotik_device_id', device.id)
      .eq('status', 'active')
      .not('pppoe_username', 'is', null);
    if (ctErr) {
      errors.push({ deviceName: device.name, message: ctErr.message });
      continue;
    }
    const relevantContracts = (contracts ?? []) as ContractRow[];
    if (relevantContracts.length === 0) continue;

    const { data: statesData, error: stErr } = await supabaseAdmin
      .from('mikrotik_traffic_counters_state')
      .select('contract_id, last_rx_bytes, last_tx_bytes, updated_at')
      .in('contract_id', relevantContracts.map((c) => c.id));
    if (stErr) {
      errors.push({ deviceName: device.name, message: stErr.message });
      continue;
    }
    const stateByContract = new Map((statesData as CounterStateRow[] | null ?? []).map((s) => [s.contract_id, s]));

    const samplesToInsert: Record<string, unknown>[] = [];
    const statesToUpsert: Record<string, unknown>[] = [];

    for (const contract of relevantContracts) {
      const iface = ifaceByUsername.get(contract.pppoe_username);
      if (!iface) continue; // cliente sin sesion PPPoE activa ahora mismo
      contractsChecked++;

      // "rx" del router = subida del cliente; "tx" del router = bajada del
      // cliente (ver comentario en la migracion).
      const rawRx = Number(iface['rx-byte'] ?? 0);
      const rawTx = Number(iface['tx-byte'] ?? 0);
      const uploadBytesRaw = Number.isFinite(rawRx) ? rawRx : 0;
      const downloadBytesRaw = Number.isFinite(rawTx) ? rawTx : 0;

      const prevState = stateByContract.get(contract.id);
      statesToUpsert.push({
        contract_id: contract.id,
        last_rx_bytes: uploadBytesRaw,
        last_tx_bytes: downloadBytesRaw,
      });

      if (!prevState) {
        // Primera vez que se ve este contrato: no hay una lectura anterior
        // con la que calcular un delta valido, asi que solo se guarda el
        // punto de partida (la sesion PPPoE puede llevar dias activa con
        // contadores ya altos, y tratar eso como "consumo de este
        // intervalo" inflaria el primer reporte).
        baselinesInitialized++;
        continue;
      }

      const intervalSeconds = Math.min(
        MAX_INTERVAL_SECONDS,
        Math.max(MIN_INTERVAL_SECONDS, Math.round((now.getTime() - new Date(prevState.updated_at).getTime()) / 1000)),
      );

      // Si el contador actual es menor al anterior, la interfaz se recreo
      // (el cliente se reconecto) — el contador arranco de 0, asi que el
      // valor actual completo es el delta de esta ventana.
      const downloadDelta = downloadBytesRaw >= prevState.last_tx_bytes ? downloadBytesRaw - prevState.last_tx_bytes : downloadBytesRaw;
      const uploadDelta = uploadBytesRaw >= prevState.last_rx_bytes ? uploadBytesRaw - prevState.last_rx_bytes : uploadBytesRaw;

      samplesToInsert.push({
        contract_id: contract.id,
        device_id: device.id,
        run_id: runId,
        sampled_at: now.toISOString(),
        interval_seconds: intervalSeconds,
        download_bytes: downloadDelta,
        upload_bytes: uploadDelta,
        download_bps: Math.round((downloadDelta * 8) / intervalSeconds),
        upload_bps: Math.round((uploadDelta * 8) / intervalSeconds),
        online: iface.running === 'true',
      });
    }

    if (samplesToInsert.length > 0) {
      const { error: insErr } = await supabaseAdmin.from('mikrotik_traffic_samples').insert(samplesToInsert);
      if (insErr) {
        errors.push({ deviceName: device.name, message: `No se pudieron guardar las muestras: ${insErr.message}` });
      } else {
        samplesInserted += samplesToInsert.length;
      }
    }
    if (statesToUpsert.length > 0) {
      const { error: upsErr } = await supabaseAdmin.from('mikrotik_traffic_counters_state').upsert(statesToUpsert, { onConflict: 'contract_id' });
      if (upsErr) {
        errors.push({ deviceName: device.name, message: `No se pudo actualizar el estado de contadores: ${upsErr.message}` });
      }
    }
  }

  lastReport = {
    ranAt: now.toISOString(),
    runId,
    devicesChecked: (devices ?? []).length,
    contractsChecked,
    samplesInserted,
    baselinesInitialized,
    errors,
  };
  return lastReport;
}

// ---- Consultas para /api/analytics (todas via RPC, ver la migracion) ----

function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export interface MonthlyTotal {
  month_start: string;
  download_bytes: number;
  upload_bytes: number;
}
export async function getMonthlyTotals(months = 6): Promise<MonthlyTotal[]> {
  const { data, error } = await supabaseAdmin.rpc('fn_traffic_monthly_totals', { p_months: months });
  if (error) throw new Error(error.message);
  return (data ?? []) as MonthlyTotal[];
}

export interface ClientDailyTotal {
  day: string;
  download_bytes: number;
  upload_bytes: number;
}
export async function getClientDailyTotals(contractId: string, sinceIso: string): Promise<ClientDailyTotal[]> {
  const { data, error } = await supabaseAdmin.rpc('fn_traffic_client_daily', { p_contract_id: contractId, p_since: sinceIso });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientDailyTotal[];
}

export interface TopClient {
  contract_id: string;
  contract_number: string | null;
  client_name: string;
  download_bytes: number;
  upload_bytes: number;
  total_bytes: number;
}
export async function getTopClients(limit = 10, sinceIso: string = monthStartIso()): Promise<TopClient[]> {
  const { data, error } = await supabaseAdmin.rpc('fn_traffic_top_clients', { p_since: sinceIso, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as TopClient[];
}

export interface Bottleneck {
  contract_id: string;
  contract_number: string | null;
  client_name: string;
  download_bps: number;
  upload_bps: number;
  download_capacity_bps: number;
  upload_capacity_bps: number;
  usage_pct: number;
  sampled_at: string;
}
export async function getBottlenecks(thresholdPct = 85): Promise<Bottleneck[]> {
  const { data, error } = await supabaseAdmin.rpc('fn_traffic_bottlenecks', { p_threshold_pct: thresholdPct, p_max_age_minutes: 60 });
  if (error) throw new Error(error.message);
  return (data ?? []) as Bottleneck[];
}

export interface Anomaly {
  contract_id: string;
  contract_number: string | null;
  client_name: string;
  baseline_bps: number;
  current_bps: number;
  ratio: number;
  last_seen: string;
}
export async function getAnomalies(): Promise<Anomaly[]> {
  const { data, error } = await supabaseAdmin.rpc('fn_traffic_anomalies', { p_ratio: 2.0, p_min_current_bps: 2_000_000 });
  if (error) throw new Error(error.message);
  return (data ?? []) as Anomaly[];
}

export interface TrafficKpis {
  monthDownloadBytes: number;
  monthUploadBytes: number;
  monthTotalBytes: number;
  peakTotalBps: number;
  peakAt: string | null;
  bottleneckCount: number;
  anomalyCount: number;
}
export async function getTrafficKpis(): Promise<TrafficKpis> {
  const since = monthStartIso();
  const [monthly, peakRes, bottlenecks, anomalies] = await Promise.all([
    getMonthlyTotals(1),
    supabaseAdmin.rpc('fn_traffic_peak', { p_since: since }),
    getBottlenecks(85),
    getAnomalies(),
  ]);
  if (peakRes.error) throw new Error(peakRes.error.message);
  const peak = (peakRes.data as { total_bps: number; sampled_at: string }[] | null)?.[0] ?? null;
  const thisMonth = monthly[0];

  return {
    monthDownloadBytes: thisMonth?.download_bytes ?? 0,
    monthUploadBytes: thisMonth?.upload_bytes ?? 0,
    monthTotalBytes: (thisMonth?.download_bytes ?? 0) + (thisMonth?.upload_bytes ?? 0),
    peakTotalBps: peak?.total_bps ?? 0,
    peakAt: peak?.sampled_at ?? null,
    bottleneckCount: bottlenecks.length,
    anomalyCount: anomalies.length,
  };
}
