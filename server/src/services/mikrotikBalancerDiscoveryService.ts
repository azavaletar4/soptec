import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';
import { computeInterfaceDelta } from '../mikrotik/borderTraffic';
import { diffDiscoveredConnections, resolveConnectionTopology, type MacvlanRaw, type PppoeClientRaw } from '../mikrotik/balancerDiscovery';

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

/** Solo lectura: estado actual + ultima muestra de cada conexion conocida (incluidas las removidas, para que el historico siga consultable). */
export async function getBalancerConnectionsSnapshot(deviceId: string): Promise<BalancerConnectionSnapshot[]> {
  const { data: connections, error } = await supabaseAdmin
    .from('mikrotik_balancer_connections')
    .select('id, pppoe_interface_name, macvlan_interface_name, physical_interface_name, pppoe_user, disabled, running, first_seen_at, last_seen_at, removed_at')
    .eq('device_id', deviceId)
    .order('pppoe_interface_name', { ascending: true });
  if (error) throw new Error(error.message);
  if (!connections?.length) return [];

  const { data: latestSamples } = await supabaseAdmin
    .from('mikrotik_balancer_connection_samples')
    .select('connection_id, rx_bps, tx_bps, sampled_at')
    .in('connection_id', connections.map((c) => c.id))
    .order('sampled_at', { ascending: false });
  const latestByConnection = new Map<string, { rx_bps: number; tx_bps: number; sampled_at: string }>();
  for (const s of latestSamples ?? []) {
    if (!latestByConnection.has(s.connection_id)) latestByConnection.set(s.connection_id, s);
  }

  return connections.map((c) => {
    const latest = latestByConnection.get(c.id);
    return {
      ...c,
      latest_rx_bps: latest?.rx_bps ?? null,
      latest_tx_bps: latest?.tx_bps ?? null,
      latest_sampled_at: latest?.sampled_at ?? null,
    };
  });
}
