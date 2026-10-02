import { supabaseAdmin } from '../lib/supabaseAdmin';
import { runTelnetCommands } from '../telnet/client';
import { withOltLock, type OltLockPriority } from './oltTelnetLock';
import { oltEvents } from './oltEvents';
import { type OltDeviceRow, telnetTargetFor } from '../lib/oltDevice';
import {
  listUnconfiguredOntsCommands,
  listAllOntsCommands,
  bulkOnuRxCommands,
  bulkOnuTxCommands,
  oltHealthCommands,
  type ZteInterfaceRef,
} from '../ssh/zteCommands';
import {
  parseUnconfiguredOnts,
  parseGlobalOntState,
  parseBulkPower,
  parseUptime,
  parseCardTemperatures,
  parseProcessorLoad,
  type GlobalOnt,
} from '../ssh/zteParsers';

// Rango de senal optica GPON aceptable segun el glosario del curso: -8 a -27 dBm.
export const LOW_SIGNAL_THRESHOLD_DBM = -27;

export interface CachedUnconfiguredOnt {
  serial: string;
  interfaceRef: string;
  frame: number;
  slot: number | null;
  port: number | null;
}

export interface OltFullSyncResult {
  unconfigured: number;
  online: number;
  offline: number;
  disabled: number;
  lowSignal: number;
  scanComplete: boolean;
  portsScanned: number;
  failedPorts: string[];
  updatedOnts: number;
}

// El escaneo global ("show gpon onu uncfg"/"show gpon onu state") ya trae
// todas las ONUs de una vez; solo faltaria correr esto UNA vez por OLT para
// tener el resumen completo, pero se ejecuta secuencial (nunca en paralelo)
// porque comparte la misma sesion Telnet en turnos con cualquier accion
// manual — ver oltTelnetLock.ts.
const runningDeviceIds = new Set<string>();

export function isOltSyncRunning(deviceId: string): boolean {
  return runningDeviceIds.has(deviceId);
}

/**
 * Sync completo de una OLT en segundo plano: estado online/offline, potencia
 * optica Rx/Tx, salud del chasis y ONUs sin autorizar — todo por Telnet
 * (unico protocolo habilitado en este equipo), secuencial, protegido por
 * withOltLock para no chocar con acciones manuales de un tecnico. Al
 * terminar, deja todo en cache (olt_onts + olt_sync_cache); nunca se sirve
 * directo al frontend en vivo.
 *
 * `priority` decide como hace cola cada paso contra el resto del trafico
 * Telnet de esta OLT (ver oltTelnetLock.ts): 'background' (el scheduler
 * automatico, oltSyncScheduler.ts) cede el turno a cualquier accion
 * 'interactive' entre paso y paso — ya no acapara la sesion ~6 minutos
 * seguidos. El boton manual "Escanear todos los puertos" sigue pidiendo
 * 'interactive' (default), porque ahi si hay alguien esperando en el panel.
 *
 * Devuelve null sin hacer nada si ya hay un sync en curso para esta OLT
 * (evita encolar un segundo escaneo completo redundante).
 */
export async function runOltFullSync(
  device: OltDeviceRow,
  priority: OltLockPriority = 'interactive',
): Promise<OltFullSyncResult | null> {
  if (runningDeviceIds.has(device.id)) return null;
  runningDeviceIds.add(device.id);
  try {
    return await performFullSync(device, priority);
  } finally {
    runningDeviceIds.delete(device.id);
  }
}

function mapUnconfigured(list: { interfaceRef: string; serial: string }[]): CachedUnconfiguredOnt[] {
  // "gpon-onu_1/2/2:1" -> { frame: 1, slot: 2, port: 2 } (el sufijo ":N" NO
  // es un onu-id libre confiable, ver advertencia en routes/olt.ts).
  return list.map((o) => {
    const m = o.interfaceRef.match(/^gpon-onu_(\d+)\/(\d+)\/(\d+):/);
    return {
      serial: o.serial,
      interfaceRef: o.interfaceRef,
      frame: m ? Number(m[1]) : 1,
      slot: m ? Number(m[2]) : null,
      port: m ? Number(m[3]) : null,
    };
  });
}

function uniquePorts(onts: GlobalOnt[]): ZteInterfaceRef[] {
  const ports = new Map<string, ZteInterfaceRef>();
  for (const o of onts) {
    const key = `${o.frame}/${o.slot}/${o.port}`;
    if (!ports.has(key)) ports.set(key, { shelf: o.frame, slot: o.slot, port: o.port });
  }
  return [...ports.values()];
}

interface KnownOnt {
  id: string;
  frame: number;
  slot: number;
  port: number;
  ont_id: number;
  status: string;
  admin_state: string;
  rx_power: number | null;
  tx_power: number | null;
}

interface PendingUpdate {
  id: string;
  status?: 'online' | 'offline';
  admin_state?: 'enable' | 'disable';
  rx_power?: number;
  tx_power?: number;
  last_synced_at: string;
}

async function performFullSync(device: OltDeviceRow, priority: OltLockPriority): Promise<OltFullSyncResult> {
  const now = new Date().toISOString();
  const target = telnetTargetFor(device);

  // Cada paso pide el lock POR SEPARADO (en vez de uno solo envolviendo todo
  // el sync) — asi, entre paso y paso, una accion 'interactive' en espera
  // puede colarse antes de que este sync siga con el siguiente (ver
  // oltTelnetLock.ts). Nunca corta un comando ya en vuelo, solo decide que
  // arranca cuando la sesion vuelve a quedar libre.

  // 1) ONUs detectadas pero sin autorizar todavia.
  let unconfiguredList: CachedUnconfiguredOnt[] = [];
  try {
    const outputs = await withOltLock(
      device.id,
      () => runTelnetCommands(target, listUnconfiguredOntsCommands(), { timeoutMs: 20000 }),
      { priority },
    );
    unconfiguredList = mapUnconfigured(parseUnconfiguredOnts(outputs.join('\n')));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[olt-sync] ${device.name}: fallo el escaneo de ONUs sin autorizar:`, e);
  }

  // 2) Estado online/offline de TODAS las ONUs de una sola vez.
  let globalOnts: GlobalOnt[] = [];
  let scanComplete = false;
  try {
    const outputs = await withOltLock(
      device.id,
      () => runTelnetCommands(target, listAllOntsCommands(), { timeoutMs: 45000 }),
      { priority },
    );
    globalOnts = parseGlobalOntState(outputs.join('\n'));
    scanComplete = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[olt-sync] ${device.name}: fallo el escaneo global de estado:`, e);
  }

  const { data: knownRows } = await supabaseAdmin
    .from('olt_onts')
    .select('id, frame, slot, port, ont_id, status, admin_state, rx_power, tx_power')
    .eq('olt_device_id', device.id);
  const known = (knownRows ?? []) as KnownOnt[];
  const byPos = new Map(known.map((r) => [`${r.frame}/${r.slot}/${r.port}:${r.ont_id}`, r]));
  const updatesById = new Map<string, PendingUpdate>();

  let online = 0;
  let offline = 0;
  let disabledCount = 0;
  if (scanComplete) {
    online = globalOnts.filter((o) => o.runState === 'working').length;
    offline = globalOnts.length - online;
    disabledCount = globalOnts.filter((o) => o.adminState === 'disable').length;

    for (const o of globalOnts) {
      const row = byPos.get(`${o.frame}/${o.slot}/${o.port}:${o.onuId}`);
      if (!row) continue;
      const newStatus = o.runState === 'working' ? 'online' : 'offline';
      const update: PendingUpdate = { id: row.id, last_synced_at: now };
      let changed = false;
      if (newStatus !== row.status) {
        update.status = newStatus;
        changed = true;
      }
      if (o.adminState !== row.admin_state) {
        update.admin_state = o.adminState;
        changed = true;
      }
      if (changed) updatesById.set(row.id, update);
    }
  } else {
    // Respaldo: si el escaneo global falla (timeout, etc.), reportar lo ya
    // sincronizado localmente en vez de dejar el resumen en cero.
    const rows = known;
    online = rows.filter((r) => r.status === 'online').length;
    offline = rows.filter((r) => r.status === 'offline').length;
    disabledCount = rows.filter((r) => r.admin_state === 'disable').length;
  }

  // 3) Potencia optica Rx/Tx por puerto PON (solo si tenemos la lista de
  // puertos reales del escaneo global). Secuencial y NUNCA rx+tx en la misma
  // conexion: el equipo real se cuelga sin devolver el prompt si se
  // encadenan (ver advertencia en zteCommands.ts).
  const ports = scanComplete ? uniquePorts(globalOnts) : [];
  const failedPorts: string[] = [];
  for (const ref of ports) {
    const portKey = `${ref.shelf}/${ref.slot}/${ref.port}`;
    try {
      // rx+tx de ESTE puerto quedan bajo UN solo turno de lock (son dos
      // comandos chicos y seguidos para el mismo puerto) — el punto de cesion
      // real para una accion 'interactive' en espera es ENTRE puertos, no
      // en medio de este par.
      const [rxOut, txOut] = await withOltLock(
        device.id,
        async () => {
          const rx = await runTelnetCommands(target, bulkOnuRxCommands(ref), { timeoutMs: 30000 });
          const tx = await runTelnetCommands(target, bulkOnuTxCommands(ref), { timeoutMs: 30000 });
          return [rx, tx] as const;
        },
        { priority },
      );
      const rxByOnu = parseBulkPower(rxOut[1] ?? '');
      const txByOnu = parseBulkPower(txOut[1] ?? '');

      const portRows = known.filter((r) => r.frame === ref.shelf && r.slot === ref.slot && r.port === ref.port);
      for (const row of portRows) {
        const rx = rxByOnu.get(row.ont_id);
        const tx = txByOnu.get(row.ont_id);
        if (rx === undefined && tx === undefined) continue;
        if (rx === row.rx_power && tx === row.tx_power) continue;

        const existing = updatesById.get(row.id) ?? { id: row.id, last_synced_at: now };
        if (rx !== undefined) existing.rx_power = rx;
        if (tx !== undefined) existing.tx_power = tx;
        updatesById.set(row.id, existing);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[olt-sync] ${device.name}: fallo el puerto ${portKey}:`, e);
      failedPorts.push(portKey);
    }
  }

  // 4) Bulk upsert de TODO lo que realmente cambio, en una sola llamada
  // (ver bulk_update_ont_status_power en la migracion de la Fase 40).
  const updates = [...updatesById.values()];
  if (updates.length) {
    const { error } = await supabaseAdmin.rpc('bulk_update_ont_status_power', { updates });
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`[olt-sync] ${device.name}: fallo el bulk update de olt_onts:`, error.message);
    } else {
      for (const u of updates) {
        oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: u });
      }
    }
  }

  // 5) Salud del chasis: uptime, temperatura y CPU/RAM por tarjeta.
  let uptimeHours: number | null = null;
  let uptimeRaw: string | null = null;
  let temperature: unknown[] = [];
  let load: unknown[] = [];
  try {
    const outputs = await withOltLock(device.id, () => runTelnetCommands(target, oltHealthCommands()), { priority });
    const uptime = parseUptime(outputs[1] ?? '');
    uptimeHours = uptime?.totalHours ?? null;
    uptimeRaw = uptime?.raw ?? null;
    temperature = parseCardTemperatures(outputs[2] ?? '');
    load = parseProcessorLoad(outputs[3] ?? '');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[olt-sync] ${device.name}: fallo la lectura de salud del chasis:`, e);
  }

  // 6) Senal baja: sobre el estado de rx_power YA actualizado arriba.
  const { data: signalRows } = await supabaseAdmin
    .from('olt_onts')
    .select('rx_power')
    .eq('olt_device_id', device.id)
    .not('rx_power', 'is', null);
  const lowSignal = (signalRows ?? []).filter((r) => (r.rx_power as number) < LOW_SIGNAL_THRESHOLD_DBM).length;

  await supabaseAdmin.from('olt_sync_cache').upsert({
    olt_device_id: device.id,
    unconfigured: unconfiguredList.length,
    online,
    offline,
    disabled: disabledCount,
    low_signal: lowSignal,
    scan_complete: scanComplete,
    uptime_hours: uptimeHours,
    uptime_raw: uptimeRaw,
    temperature,
    load,
    unconfigured_onts: unconfiguredList,
    checked_at: now,
  });

  oltEvents.emitSummaryChanged({ oltDeviceId: device.id });

  return {
    unconfigured: unconfiguredList.length,
    online,
    disabled: disabledCount,
    offline,
    lowSignal,
    scanComplete,
    portsScanned: ports.length,
    failedPorts,
    updatedOnts: updates.length,
  };
}
