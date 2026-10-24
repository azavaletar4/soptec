import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';
import { computeInterfaceDelta } from '../mikrotik/borderTraffic';
import {
  classifyConnectionStatus,
  diffDiscoveredConnections,
  isBalancerDataStale,
  resolveConnectionTopology,
  type MacvlanRaw,
  type PppoeClientRaw,
  type ResolvedConnection,
} from '../mikrotik/balancerDiscovery';
import { decideWanLinkAlertTransition, wanLinkAlertKey } from '../mikrotik/balancerAlerts';
import {
  BALANCER_HISTORY_RANGES,
  bucketTicks,
  sumSamplesByTick,
  type BalancerHistoryRange,
  type BucketedPoint,
  type RawSample,
} from '../mikrotik/balancerTrafficSeries';

// Fase 174 — parte con I/O (Supabase + REST) del descubrimiento automatico
// de conexiones WAN del MikroTik BALANCEADOR. La logica de
// resolucion/clasificacion vive en mikrotik/balancerDiscovery.ts (sin I/O,
// con pruebas unitarias contra datos reales) — este archivo solo conecta
// esa logica con la base real y el router real.
//
// Alcance a proposito limitado a device_role='borde_balanceador'. Nunca
// escribe nada en el router (solo GET /interface, /interface/macvlan,
// /interface/pppoe-client).

export interface BalancerDeviceRow {
  id: string;
  name: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
}

export async function getConfiguredBalancerDevices(): Promise<BalancerDeviceRow[]> {
  const { data, error } = await supabaseAdmin
    .from('mikrotik_devices')
    .select('id, name, host, port, use_tls, username, password')
    .eq('device_role', 'borde_balanceador')
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return (data ?? []) as BalancerDeviceRow[];
}

function targetFor(device: BalancerDeviceRow): MikrotikTarget {
  return { host: device.host, port: device.port, useTls: device.use_tls, username: device.username, password: device.password };
}

interface InterfaceCountersRaw {
  name: string;
  type?: string;
  'rx-byte'?: string;
  'tx-byte'?: string;
  // Fase 174b: ya venian en esta misma respuesta de /interface (sin
  // consulta nueva al router) -- solo faltaba leerlos, para el estado del
  // PUERTO FISICO SFP (distinto del running/disabled de la sesion PPPoE).
  running?: string;
  disabled?: string;
}

/**
 * Un solo ciclo de descubrimiento + sincronizacion para UN balanceador:
 *  1) lee /interface/macvlan + /interface/pppoe-client (resuelve la cadena
 *     real fisico<-macvlan<-pppoe, nunca por nombre);
 *  2) UPSERT de lo encontrado en mikrotik_balancer_connections — altas
 *     nuevas se insertan, las que ya existian actualizan su estado;
 *  3) lo que YA estaba en la BD y dejo de aparecer se marca removed_at
 *     (nunca se borra la fila ni su historico — requisito 7);
 *  4) para cada conexion presente (no removida), calcula el delta de
 *     trafico usando UNICAMENTE el contador del nivel PPPoE-client (una
 *     sola fuente por conexion — requisito 6) y guarda una muestra.
 *
 * Si el router no responde este ciclo, NO TOCA NADA en la BD (ni marca
 * removidas las conexiones existentes, ni inventa un sample) — una falla
 * de red nunca se interpreta como "se cayeron todas las lineas".
 */
export async function discoverAndSyncBalancerConnections(device: BalancerDeviceRow, now: Date = new Date()): Promise<void> {
  const target = targetFor(device);

  let macvlans: MacvlanRaw[];
  let pppoeClients: PppoeClientRaw[];
  let interfaceCounters: InterfaceCountersRaw[];
  try {
    [macvlans, pppoeClients, interfaceCounters] = await Promise.all([
      mikrotikRequest<MacvlanRaw[]>(target, '/interface/macvlan'),
      mikrotikRequest<PppoeClientRaw[]>(target, '/interface/pppoe-client'),
      mikrotikRequest<InterfaceCountersRaw[]>(target, '/interface'),
    ]);
  } catch {
    // Solo perdida de monitoreo puntual -- nunca se toca la BD (ver doc del metodo).
    return;
  }

  const resolved = resolveConnectionTopology(macvlans, pppoeClients);
  const countersByName = new Map(interfaceCounters.map((i) => [i.name, i]));

  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from('mikrotik_balancer_connections')
    .select('id, pppoe_interface_name, removed_at')
    .eq('device_id', device.id);
  if (existingErr) throw new Error(existingErr.message);

  const previouslyKnownNames = (existingRows ?? []).filter((r) => !r.removed_at).map((r) => r.pppoe_interface_name);
  const diff = diffDiscoveredConnections(previouslyKnownNames, resolved.map((r) => r.pppoeInterfaceName));

  // Altas nuevas y las que ya existian: upsert de su estado actual.
  for (const conn of resolved) {
    await supabaseAdmin
      .from('mikrotik_balancer_connections')
      .upsert(
        {
          device_id: device.id,
          pppoe_interface_name: conn.pppoeInterfaceName,
          macvlan_interface_name: conn.macvlanInterfaceName,
          physical_interface_name: conn.physicalInterfaceName,
          pppoe_user: conn.pppoeUser,
          disabled: conn.disabled,
          running: conn.running,
          last_seen_at: now.toISOString(),
          removed_at: null, // si habia quedado marcada removida y volvio a aparecer, se reactiva
        },
        { onConflict: 'device_id,pppoe_interface_name' },
      );
  }

  // Lo que ya no aparece: se marca removida, NUNCA se borra (requisito 7).
  if (diff.removedNames.length) {
    await supabaseAdmin
      .from('mikrotik_balancer_connections')
      .update({ removed_at: now.toISOString() })
      .eq('device_id', device.id)
      .in('pppoe_interface_name', diff.removedNames)
      .is('removed_at', null);
  }

  // Trafico: una sola fuente por conexion (el contador del nivel
  // PPPoE-client) -- nunca se suma con la macvlan ni con el puerto fisico.
  const { data: connectionRows, error: connErr } = await supabaseAdmin
    .from('mikrotik_balancer_connections')
    .select('id, pppoe_interface_name, disabled')
    .eq('device_id', device.id)
    .is('removed_at', null);
  if (connErr) throw new Error(connErr.message);

  const connectionIds = (connectionRows ?? []).map((c) => c.id);
  const { data: stateRows } = await supabaseAdmin
    .from('mikrotik_balancer_connection_counters_state')
    .select('connection_id, last_rx_bytes, last_tx_bytes, updated_at')
    .in('connection_id', connectionIds.length ? connectionIds : ['00000000-0000-0000-0000-000000000000']);
  const stateByConnectionId = new Map((stateRows ?? []).map((s) => [s.connection_id, s]));

  for (const row of connectionRows ?? []) {
    // Una conexion deshabilitada no tiene trafico real que medir -- no es
    // una averia (requisito 8), simplemente no se muestrea.
    if (row.disabled) continue;
    const counters = countersByName.get(row.pppoe_interface_name);
    if (!counters) continue;

    const prevState = stateByConnectionId.get(row.id) ?? null;
    const intervalSecondsRaw = prevState ? Math.round((now.getTime() - new Date(prevState.updated_at).getTime()) / 1000) : 60;
    const curr = { rx: Number(counters['rx-byte'] ?? 0), tx: Number(counters['tx-byte'] ?? 0) };
    const delta = computeInterfaceDelta(prevState ? { rx: prevState.last_rx_bytes, tx: prevState.last_tx_bytes } : null, curr, intervalSecondsRaw);

    await supabaseAdmin.from('mikrotik_balancer_connection_samples').insert({
      connection_id: row.id,
      sampled_at: now.toISOString(),
      interval_seconds: delta.intervalSeconds,
      rx_bytes: delta.rxBytes,
      tx_bytes: delta.txBytes,
      rx_bps: delta.rxBps,
      tx_bps: delta.txBps,
      online: true,
    });
    await supabaseAdmin
      .from('mikrotik_balancer_connection_counters_state')
      .upsert({ connection_id: row.id, last_rx_bytes: curr.rx, last_tx_bytes: curr.tx }, { onConflict: 'connection_id' });
  }

  // Fase 174b (requiere la migracion de mikrotik_balancer_link_alerts,
  // ver supabase/migrations/20261024150000_*): si la tabla todavia no
  // existe en este entorno, se registra el error y el resto del ciclo
  // (que YA guardo conexiones/muestras arriba) sigue intacto -- esto nunca
  // debe poder romper el descubrimiento base.
  const connectionIdByPppoeName = new Map((connectionRows ?? []).map((c) => [c.pppoe_interface_name, c.id]));
  try {
    await evaluateAndPersistBalancerLinkAlerts(device, resolved, diff.removedNames, countersByName, connectionIdByPppoeName, now);
  } catch (e) {
    console.error(`[mikrotik-balancer-link-alerts] error en "${device.name}":`, e instanceof Error ? e.message : e);
  }
}

/**
 * Evalua y persiste las alertas de caida/recuperacion de enlaces WAN --
 * sesiones PPPoE (requisito: caida/recuperacion de la sesion) y puertos
 * fisicos SFP (requisito: el puerto deja de/vuelve a estar operativo),
 * SIEMPRE por separado (requisito: nunca asumir que una sesion caida
 * implica que su puerto fisico tambien lo esta). Solo se llama tras una
 * lectura fresca y exitosa del router (nunca con datos obsoletos).
 */
async function evaluateAndPersistBalancerLinkAlerts(
  device: BalancerDeviceRow,
  resolved: ResolvedConnection[],
  removedPppoeNames: string[],
  countersByName: Map<string, InterfaceCountersRaw>,
  connectionIdByPppoeName: Map<string, string>,
  now: Date,
): Promise<void> {
  const { data: activeAlertRows, error: activeErr } = await supabaseAdmin
    .from('mikrotik_balancer_link_alerts')
    .select('id, link_kind, link_name')
    .eq('device_id', device.id)
    .eq('status', 'active');
  if (activeErr) throw new Error(activeErr.message);
  const activeAlertIdByKey = new Map(
    (activeAlertRows ?? []).map((a) => [wanLinkAlertKey({ kind: a.link_kind as 'pppoe_connection' | 'physical_port', name: a.link_name }), a.id as string]),
  );

  async function fire(linkKind: 'pppoe_connection' | 'physical_port', linkName: string, connectionId: string | null, physicalInterfaceName: string | null) {
    await supabaseAdmin.from('mikrotik_balancer_link_alerts').insert({
      device_id: device.id,
      link_kind: linkKind,
      link_name: linkName,
      connection_id: connectionId,
      physical_interface_name: physicalInterfaceName,
      status: 'active',
      started_at: now.toISOString(),
    });
  }
  async function resolve(linkKind: 'pppoe_connection' | 'physical_port', linkName: string) {
    const id = activeAlertIdByKey.get(wanLinkAlertKey({ kind: linkKind, name: linkName }));
    if (!id) return;
    await supabaseAdmin.from('mikrotik_balancer_link_alerts').update({ status: 'resolved', resolved_at: now.toISOString() }).eq('id', id);
  }

  // Sesiones PPPoE-WAN presentes este ciclo.
  for (const conn of resolved) {
    const status = classifyConnectionStatus(conn.disabled, conn.running);
    const hasActive = activeAlertIdByKey.has(wanLinkAlertKey({ kind: 'pppoe_connection', name: conn.pppoeInterfaceName }));
    const transition = decideWanLinkAlertTransition(status, hasActive);
    if (transition.shouldFire) {
      await fire('pppoe_connection', conn.pppoeInterfaceName, connectionIdByPppoeName.get(conn.pppoeInterfaceName) ?? null, conn.physicalInterfaceName);
    } else if (transition.shouldResolve) {
      await resolve('pppoe_connection', conn.pppoeInterfaceName);
    }
  }

  // Sesiones retiradas este ciclo (ya no aparecen en `resolved`) -- si
  // tenian una averia activa, se cierra: una linea retirada no se queda
  // mostrada como caida para siempre (requisito 7 aplicado a alertas).
  for (const removedName of removedPppoeNames) {
    await resolve('pppoe_connection', removedName);
  }

  // Puertos fisicos SFP realmente en uso (los que al menos una conexion
  // referencia este ciclo -- nunca se vigilan puertos sin ninguna conexion
  // mapeada, mismo criterio de auto-descubrimiento que el resto de Fase 174).
  const physicalPortNames = new Set(resolved.map((r) => r.physicalInterfaceName).filter((n): n is string => !!n));
  for (const portName of physicalPortNames) {
    const counters = countersByName.get(portName);
    if (!counters) continue; // referenciado pero no visto en /interface este ciclo -- no se puede clasificar, se deja como estaba
    const status = classifyConnectionStatus(counters.disabled === 'true', counters.running === 'true');
    const hasActive = activeAlertIdByKey.has(wanLinkAlertKey({ kind: 'physical_port', name: portName }));
    const transition = decideWanLinkAlertTransition(status, hasActive);
    if (transition.shouldFire) {
      await fire('physical_port', portName, null, portName);
    } else if (transition.shouldResolve) {
      await resolve('physical_port', portName);
    }
  }
}

export interface BalancerConnectionSnapshot {
  id: string;
  pppoe_interface_name: string;
  macvlan_interface_name: string | null;
  physical_interface_name: string | null;
  pppoe_user: string | null;
  disabled: boolean;
  running: boolean;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
  latest_rx_bps: number | null;
  latest_tx_bps: number | null;
  latest_sampled_at: string | null;
}

export interface BalancerConnectionsHealth {
  connections: BalancerConnectionSnapshot[];
  // true cuando el ultimo descubrimiento exitoso fue hace demasiado (ver
  // isBalancerDataStale) -- el panel debe mostrar "estado desconocido" en
  // vez de reusar el ultimo running/disabled guardado como si fuera actual.
  isStale: boolean;
  lastDiscoveryAt: string | null;
}

/** Solo lectura: estado actual + ultima muestra de cada conexion conocida (incluidas las removidas, para que el historico siga consultable). */
export async function getBalancerConnectionsSnapshot(deviceId: string): Promise<BalancerConnectionsHealth> {
  const { data: connections, error } = await supabaseAdmin
    .from('mikrotik_balancer_connections')
    .select('id, pppoe_interface_name, macvlan_interface_name, physical_interface_name, pppoe_user, disabled, running, first_seen_at, last_seen_at, removed_at')
    .eq('device_id', deviceId)
    .order('pppoe_interface_name', { ascending: true });
  if (error) throw new Error(error.message);

  // La frescura se mide solo contra conexiones NO retiradas -- una retirada
  // deja de actualizar last_seen_at a proposito (requisito 7) y no debe
  // hacer parecer "obsoleto" el estado de las que si siguen activas.
  const lastDiscoveryAt = (connections ?? [])
    .filter((c) => !c.removed_at)
    .reduce<string | null>((max, c) => (!max || c.last_seen_at > max ? c.last_seen_at : max), null);
  const isStale = isBalancerDataStale(lastDiscoveryAt, Date.now());

  if (!connections?.length) return { connections: [], isStale, lastDiscoveryAt };

  const { data: latestSamples } = await supabaseAdmin
    .from('mikrotik_balancer_connection_samples')
    .select('connection_id, rx_bps, tx_bps, sampled_at')
    .in('connection_id', connections.map((c) => c.id))
    .order('sampled_at', { ascending: false });
  const latestByConnection = new Map<string, { rx_bps: number; tx_bps: number; sampled_at: string }>();
  for (const s of latestSamples ?? []) {
    if (!latestByConnection.has(s.connection_id)) latestByConnection.set(s.connection_id, s);
  }

  const withLatest = connections.map((c) => {
    const latest = latestByConnection.get(c.id);
    return {
      ...c,
      latest_rx_bps: latest?.rx_bps ?? null,
      latest_tx_bps: latest?.tx_bps ?? null,
      latest_sampled_at: latest?.sampled_at ?? null,
    };
  });
  return { connections: withLatest, isStale, lastDiscoveryAt };
}

export interface BalancerTrafficHistoryResult {
  range: BalancerHistoryRange;
  scope: 'total' | 'port' | 'connection';
  connectionCount: number;
  points: BucketedPoint[];
}

/**
 * Historico de trafico del balanceador, en 3 alcances posibles (nunca se
 * mezclan): total (todas las conexiones activas y habilitadas del
 * dispositivo), por puerto fisico (solo las conexiones de ese puerto), o
 * una sola conexion (individual, incluso si ya esta retirada -- su
 * historico sigue siendo consultable). Usa UNICAMENTE
 * mikrotik_balancer_connection_samples (el nivel PPPoE-client, la misma
 * fuente unica que ya usa el descubrimiento) -- nunca se mezcla con datos
 * del puerto fisico ni de la macvlan.
 */
export async function getBalancerTrafficHistory(
  deviceId: string,
  range: BalancerHistoryRange,
  scope: { port?: string; connectionId?: string } = {},
): Promise<BalancerTrafficHistoryResult> {
  const { sinceMinutes, bucketSeconds } = BALANCER_HISTORY_RANGES[range];
  const sinceIso = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

  let connectionIds: string[];
  let scopeLabel: 'total' | 'port' | 'connection';
  if (scope.connectionId) {
    connectionIds = [scope.connectionId];
    scopeLabel = 'connection';
  } else {
    let query = supabaseAdmin
      .from('mikrotik_balancer_connections')
      .select('id')
      .eq('device_id', deviceId)
      .eq('disabled', false)
      .is('removed_at', null);
    if (scope.port) query = query.eq('physical_interface_name', scope.port);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    connectionIds = (data ?? []).map((c) => c.id);
    scopeLabel = scope.port ? 'port' : 'total';
  }

  if (!connectionIds.length) return { range, scope: scopeLabel, connectionCount: 0, points: [] };

  const { data: samples, error: samplesErr } = await supabaseAdmin
    .from('mikrotik_balancer_connection_samples')
    .select('connection_id, sampled_at, rx_bps, tx_bps, online')
    .in('connection_id', connectionIds)
    .gte('sampled_at', sinceIso)
    .order('sampled_at', { ascending: true });
  if (samplesErr) throw new Error(samplesErr.message);

  const samplesByConnection = new Map<string, RawSample[]>(connectionIds.map((id) => [id, []]));
  for (const s of samples ?? []) {
    const bucket = samplesByConnection.get(s.connection_id);
    bucket?.push({ sampledAt: s.sampled_at, rxBps: s.rx_bps, txBps: s.tx_bps, online: s.online });
  }

  const ticks = sumSamplesByTick([...samplesByConnection.values()]);
  const points = bucketTicks(ticks, bucketSeconds);
  return { range, scope: scopeLabel, connectionCount: connectionIds.length, points };
}

// ---- Fase 174b: alertas de caida/recuperacion de enlaces WAN ----
// Requiere la migracion 20261024150000_fase174_balancer_link_alerts.sql
// (tabla mikrotik_balancer_link_alerts) -- preparada pero NO aplicada
// todavia en produccion (pendiente de autorizacion). Hasta entonces, estas
// funciones fallan con un error claro ("relation ... does not exist") que
// la ruta/el frontend manejan sin romper el resto del panel.

export interface BalancerLinkAlertRow {
  id: string;
  link_kind: 'pppoe_connection' | 'physical_port';
  link_name: string;
  physical_interface_name: string | null;
  status: 'active' | 'resolved';
  started_at: string;
  resolved_at: string | null;
}

export interface BalancerLinkAlertsResult {
  active: BalancerLinkAlertRow[];
  // Resueltas recientes, mas nuevas primero -- nunca se borran (requisito:
  // conservar historial de caida y recuperacion), solo se limita cuanto se
  // manda de una vez al panel.
  history: BalancerLinkAlertRow[];
}

const LINK_ALERT_HISTORY_LIMIT = 100;

/** Solo lectura: alertas activas + historial reciente de enlaces WAN (sesiones PPPoE y puertos fisicos). */
export async function getBalancerLinkAlerts(deviceId: string): Promise<BalancerLinkAlertsResult> {
  const columns = 'id, link_kind, link_name, physical_interface_name, status, started_at, resolved_at';

  const { data: active, error: activeErr } = await supabaseAdmin
    .from('mikrotik_balancer_link_alerts')
    .select(columns)
    .eq('device_id', deviceId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });
  if (activeErr) throw new Error(activeErr.message);

  const { data: history, error: historyErr } = await supabaseAdmin
    .from('mikrotik_balancer_link_alerts')
    .select(columns)
    .eq('device_id', deviceId)
    .eq('status', 'resolved')
    .order('resolved_at', { ascending: false })
    .limit(LINK_ALERT_HISTORY_LIMIT);
  if (historyErr) throw new Error(historyErr.message);

  return { active: (active ?? []) as BalancerLinkAlertRow[], history: (history ?? []) as BalancerLinkAlertRow[] };
}
