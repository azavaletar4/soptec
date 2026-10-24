import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';
import {
  computeInterfaceDelta,
  decideAlertTransition,
  evaluateSaturation,
  findInterfaceByName,
  SATURATION_MIN_DURATION_SECONDS,
  type MikrotikInterfaceRaw,
  type SaturationSample,
} from '../mikrotik/borderTraffic';

// Fase 169 — parte con I/O (Supabase + REST) del monitoreo de trafico del
// MikroTik de borde DEDICADO. La logica de calculo/decision vive en
// mikrotik/borderTraffic.ts (sin I/O, con pruebas unitarias) — este archivo
// solo conecta esa logica con la base real y el router real.
//
// Alcance a proposito limitado a device_role='borde_dedicado' — el
// balanceador (Fase 168) no entra aqui todavia, queda intacto.

export interface BorderDeviceRow {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
  monitored_interface_name: string;
  uplink_interface_name: string | null;
  capacity_download_mbps: number;
  capacity_upload_mbps: number;
}

export async function getConfiguredBorderDevices(): Promise<BorderDeviceRow[]> {
  const { data, error } = await supabaseAdmin
    .from('mikrotik_devices')
    .select('id, name, host, port, use_tls, username, password, monitored_interface_name, uplink_interface_name, capacity_download_mbps, capacity_upload_mbps')
    .eq('device_role', 'borde_dedicado')
    .eq('is_active', true)
    .not('monitored_interface_name', 'is', null);
  if (error) throw new Error(error.message);
  return (data ?? []) as BorderDeviceRow[];
}

function targetFor(device: BorderDeviceRow): MikrotikTarget {
  return { host: device.host, port: device.port, useTls: device.use_tls, username: device.username, password: device.password };
}

export interface LiveReading {
  fetchedAt: Date;
  interfaces: MikrotikInterfaceRaw[];
  resource: { version?: string; 'board-name'?: string; uptime?: string; 'cpu-load'?: string; 'free-memory'?: string; 'total-memory'?: string } | null;
}

/** Solo lectura: /interface + /system/resource. Nunca escribe nada en el router. */
export async function fetchLiveReading(device: BorderDeviceRow): Promise<LiveReading | null> {
  try {
    const target = targetFor(device);
    const [interfaces, resource] = await Promise.all([
      mikrotikRequest<MikrotikInterfaceRaw[]>(target, '/interface'),
      mikrotikRequest<Record<string, unknown>>(target, '/system/resource'),
    ]);
    return { fetchedAt: new Date(), interfaces, resource: resource as LiveReading['resource'] };
  } catch {
    return null;
  }
}

// ---- Cache en memoria para la vista "en vivo" (Fase 169) ----
// Un solo proceso backend (sin balanceo, igual criterio que el resto de
// schedulers de este repo) sondea el router cada pocos segundos UNA sola
// vez; cualquier cantidad de pestañas/admins viendo el panel leen esta
// misma cache en vez de generar una consulta cada una — evita saturar el
// CCR2004 con N consultas REST simultaneas.

export type MonitoredLinkStatus = 'ok' | 'not_configured' | 'offline';

export interface LiveSnapshot {
  status: MonitoredLinkStatus;
  fetchedAt: string;
  monitoredInterfaceName: string;
  uplinkInterfaceName: string | null;
  monitoredRunning: boolean;
  monitoredDisabled: boolean;
  rxBps: number;
  txBps: number;
  version: string | null;
  boardName: string | null;
  uptime: string | null;
  cpuLoadPercent: number | null;
  freeMemoryBytes: number | null;
  totalMemoryBytes: number | null;
}

const liveCache = new Map<string, LiveSnapshot>();
// Contador crudo visto en el ultimo tick (separado del estado persistido en
// Supabase) — solo para el numero "ahora mismo", nunca se guarda en la BD.
const liveRawCounters = new Map<string, { rx: number; tx: number; at: number }>();

export function getLiveSnapshot(deviceId: string): LiveSnapshot | null {
  return liveCache.get(deviceId) ?? null;
}

export function updateLiveSnapshotFromReading(device: BorderDeviceRow, reading: LiveReading | null): void {
  if (!reading) {
    const prev = liveCache.get(device.id);
    liveCache.set(device.id, {
      status: 'offline',
      fetchedAt: new Date().toISOString(),
      monitoredInterfaceName: device.monitored_interface_name,
      uplinkInterfaceName: device.uplink_interface_name,
      monitoredRunning: false,
      monitoredDisabled: prev?.monitoredDisabled ?? false,
      rxBps: 0,
      txBps: 0,
      version: prev?.version ?? null,
      boardName: prev?.boardName ?? null,
      uptime: prev?.uptime ?? null,
      cpuLoadPercent: prev?.cpuLoadPercent ?? null,
      freeMemoryBytes: prev?.freeMemoryBytes ?? null,
      totalMemoryBytes: prev?.totalMemoryBytes ?? null,
    });
    return;
  }

  const iface = findInterfaceByName(reading.interfaces, device.monitored_interface_name);
  const nowMs = reading.fetchedAt.getTime();
  let rxBps = 0;
  let txBps = 0;
  if (iface) {
    const curr = { rx: Number(iface['rx-byte'] ?? 0), tx: Number(iface['tx-byte'] ?? 0) };
    const prevRaw = liveRawCounters.get(device.id) ?? null;
    if (prevRaw) {
      const elapsedSeconds = (nowMs - prevRaw.at) / 1000;
      const delta = computeInterfaceDelta({ rx: prevRaw.rx, tx: prevRaw.tx }, curr, elapsedSeconds);
      rxBps = delta.rxBps;
      txBps = delta.txBps;
    }
    liveRawCounters.set(device.id, { rx: curr.rx, tx: curr.tx, at: nowMs });
  }

  const resource = reading.resource;
  liveCache.set(device.id, {
    status: iface ? 'ok' : 'not_configured',
    fetchedAt: reading.fetchedAt.toISOString(),
    monitoredInterfaceName: device.monitored_interface_name,
    uplinkInterfaceName: device.uplink_interface_name,
    monitoredRunning: iface?.running === 'true',
    monitoredDisabled: iface?.disabled === 'true',
    rxBps,
    txBps,
    version: resource?.version ?? null,
    boardName: resource?.['board-name'] ?? null,
    uptime: resource?.uptime ?? null,
    cpuLoadPercent: resource?.['cpu-load'] != null ? Number(resource['cpu-load']) : null,
    freeMemoryBytes: resource?.['free-memory'] != null ? Number(resource['free-memory']) : null,
    totalMemoryBytes: resource?.['total-memory'] != null ? Number(resource['total-memory']) : null,
  });
}

// ---- Persistencia + alertas (cada ciclo largo, ej. 60s) ----

interface CounterStateRow {
  device_id: string;
  interface_name: string;
  last_rx_bytes: number;
  last_tx_bytes: number;
  updated_at: string;
}

const MIN_PERSIST_INTERVAL_SECONDS = 5;
const MAX_PERSIST_INTERVAL_SECONDS = 6 * 3600;

/**
 * Guarda una muestra de la interfaz monitoreada (delta calculado contra el
 * estado persistido anterior, nunca contra la cache en memoria) y evalua
 * saturacion de los ultimos `SATURATION_MIN_DURATION_SECONDS`. Si el ultimo
 * sondeo fallo (`reading` null), guarda una fila "online=false" (hueco
 * visible en el historico) sin tocar el estado de contadores — asi el
 * proximo ciclo exitoso calcula el delta desde el ultimo valor BUENO
 * conocido, no desde uno inventado.
 */
export async function persistSampleAndEvaluateAlerts(device: BorderDeviceRow, reading: LiveReading | null, now: Date = new Date()): Promise<void> {
  const { data: stateRow } = await supabaseAdmin
    .from('mikrotik_interface_counters_state')
    .select('device_id, interface_name, last_rx_bytes, last_tx_bytes, updated_at')
    .eq('device_id', device.id)
    .eq('interface_name', device.monitored_interface_name)
    .maybeSingle();
  const prevState = stateRow as CounterStateRow | null;

  const intervalSecondsRaw = prevState
    ? Math.round((now.getTime() - new Date(prevState.updated_at).getTime()) / 1000)
    : MIN_PERSIST_INTERVAL_SECONDS;
  const intervalSeconds = Math.min(MAX_PERSIST_INTERVAL_SECONDS, Math.max(MIN_PERSIST_INTERVAL_SECONDS, intervalSecondsRaw));

  const iface = reading ? findInterfaceByName(reading.interfaces, device.monitored_interface_name) : null;

  if (!reading || !iface) {
    await supabaseAdmin.from('mikrotik_interface_samples').insert({
      device_id: device.id,
      interface_name: device.monitored_interface_name,
      sampled_at: now.toISOString(),
      interval_seconds: intervalSeconds,
      rx_bytes: 0,
      tx_bytes: 0,
      rx_bps: 0,
      tx_bps: 0,
      online: false,
    });
  } else {
    const curr = { rx: Number(iface['rx-byte'] ?? 0), tx: Number(iface['tx-byte'] ?? 0) };
    const delta = computeInterfaceDelta(
      prevState ? { rx: prevState.last_rx_bytes, tx: prevState.last_tx_bytes } : null,
      curr,
      intervalSeconds,
    );
    await supabaseAdmin.from('mikrotik_interface_samples').insert({
      device_id: device.id,
      interface_name: device.monitored_interface_name,
      sampled_at: now.toISOString(),
      interval_seconds: delta.intervalSeconds,
      rx_bytes: delta.rxBytes,
      tx_bytes: delta.txBytes,
      rx_bps: delta.rxBps,
      tx_bps: delta.txBps,
      online: true,
    });
    await supabaseAdmin
      .from('mikrotik_interface_counters_state')
      .upsert(
        { device_id: device.id, interface_name: device.monitored_interface_name, last_rx_bytes: curr.rx, last_tx_bytes: curr.tx },
        { onConflict: 'device_id,interface_name' },
      );
  }

  await evaluateAndPersistAlerts(device, now);
}

async function evaluateAndPersistAlerts(device: BorderDeviceRow, now: Date): Promise<void> {
  const since = new Date(now.getTime() - SATURATION_MIN_DURATION_SECONDS * 1000).toISOString();
  const { data: recentRows, error: recentErr } = await supabaseAdmin
    .from('mikrotik_interface_samples')
    .select('sampled_at, rx_bps, tx_bps, online')
    .eq('device_id', device.id)
    .eq('interface_name', device.monitored_interface_name)
    .gte('sampled_at', since)
    .order('sampled_at', { ascending: true });
  if (recentErr || !recentRows) return;

  const samples: SaturationSample[] = recentRows.map((r) => ({ sampledAt: r.sampled_at, rxBps: r.rx_bps, txBps: r.tx_bps, online: r.online }));
  const capacityDownloadBps = Number(device.capacity_download_mbps) * 1_000_000;
  const capacityUploadBps = Number(device.capacity_upload_mbps) * 1_000_000;
  const decision = evaluateSaturation(samples, now, capacityDownloadBps, capacityUploadBps);

  const { data: activeAlerts } = await supabaseAdmin
    .from('mikrotik_saturation_alerts')
    .select('id, direction')
    .eq('device_id', device.id)
    .eq('interface_name', device.monitored_interface_name)
    .eq('status', 'active');
  const activeByDirection = new Map((activeAlerts ?? []).map((a) => [a.direction as 'download' | 'upload', a.id as string]));

  for (const direction of ['download', 'upload'] as const) {
    const hasActive = activeByDirection.has(direction);
    const transition = decideAlertTransition(decision[direction], hasActive);
    if (transition.shouldFire) {
      const peakBps = Math.max(...samples.filter((s) => s.online).map((s) => (direction === 'download' ? s.rxBps : s.txBps)), 0);
      const thresholdBps = Math.round((direction === 'download' ? capacityDownloadBps : capacityUploadBps) * 0.85);
      await supabaseAdmin.from('mikrotik_saturation_alerts').insert({
        device_id: device.id,
        interface_name: device.monitored_interface_name,
        direction,
        status: 'active',
        started_at: now.toISOString(),
        peak_bps: peakBps,
        threshold_bps: thresholdBps,
      });
    } else if (transition.shouldResolve) {
      const id = activeByDirection.get(direction);
      if (id) await supabaseAdmin.from('mikrotik_saturation_alerts').update({ status: 'resolved', resolved_at: now.toISOString() }).eq('id', id);
    }
  }
}

// ---- Retencion (Fase 169): controlar crecimiento de registros ----

const RETENTION_DAYS = Number(process.env.MIKROTIK_BORDER_TRAFFIC_RETENTION_DAYS ?? 45);

export async function cleanupOldSamples(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await supabaseAdmin.from('mikrotik_interface_samples').delete().lt('sampled_at', cutoff);
}
