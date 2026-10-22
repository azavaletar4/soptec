import { supabaseAdmin } from '../lib/supabaseAdmin';
import { runTelnetCommands } from '../telnet/client';
import { withOltLock, type OltLockPriority } from './oltTelnetLock';
import { oltEvents, type OltAlertEvent } from './oltEvents';
import { detectStatusAlert, detectSignalAlert } from './oltAlerts';
import { buildOltAlertLogRows } from './oltAlertLog';
import { type OltDeviceRow, telnetTargetFor } from '../lib/oltDevice';
import { persistOntMeasurement } from './oltTelemetryPersistence';
import { beginOltReadOperation, isOltReadOperationRunning } from './oltReadOperation';
import { collectOltTelemetry, evaluateOntEvidence, rememberOntEvidence, ontTelemetry } from './oltTelemetry';
import {
  listUnconfiguredOntsCommands,
  oltHealthCommands,
  type ZteInterfaceRef,
} from '../ssh/zteCommands';
import {
  parseUnconfiguredOnts,
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
  return runningDeviceIds.has(deviceId) || isOltReadOperationRunning(deviceId);
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
 * `includeSignal` (default true) decide si este ciclo pide la señal Rx/Tx de
 * cada puerto (~40 comandos, la parte cara) o se salta esa parte y solo
 * actualiza online/offline (barato, un escaneo global). Ver
 * OLT_SYNC_SIGNAL_EVERY_N_RUNS en oltSyncScheduler.ts — pensado para cuando
 * una herramienta externa (ej. SmartOLT) tambien usa la misma OLT en
 * paralelo y conviene que SmartRayco ocupe menos la sesion Telnet.
 *
 * Devuelve null sin hacer nada si ya hay un sync en curso para esta OLT
 * (evita encolar un segundo escaneo completo redundante).
 */
export async function runOltFullSync(
  device: OltDeviceRow,
  opts: { priority?: OltLockPriority; includeSignal?: boolean } = {},
): Promise<OltFullSyncResult | null> {
  if (runningDeviceIds.has(device.id)) return null;
  const release = beginOltReadOperation(device.id);
  if (!release) return null;
  runningDeviceIds.add(device.id);
  try {
    return await performFullSync(device, opts.priority ?? 'interactive', opts.includeSignal ?? true);
  } finally {
    runningDeviceIds.delete(device.id);
    release();
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
  serial: string;
  olt_device_id: string;
  frame: number;
  slot: number;
  port: number;
  ont_id: number;
  status: string;
  admin_state: string;
  rx_power: number | null;
  tx_power: number | null;
  // Fase 4 OLT — historial de alertas (ver oltAlertLog.ts): mismo snapshot
  // de vinculo verificado que ya usaba Fase B, leido de la MISMA consulta
  // que ya se hacia aqui (sin fila ni consulta nueva).
  client_id: string | null;
  contract_id: string | null;
}

interface PendingUpdate {
  id: string;
  status?: 'online' | 'offline';
  admin_state?: 'enable' | 'disable';
  rx_power?: number;
  tx_power?: number;
  last_synced_at: string;
}

async function performFullSync(
  device: OltDeviceRow,
  priority: OltLockPriority,
  includeSignal: boolean,
): Promise<OltFullSyncResult> {
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

  // Identity brackets cover state and all power reads; each session still yields the OLT lock.
  const scan = await collectOltTelemetry(
    (commands, timeoutMs) => withOltLock(device.id, () => runTelnetCommands(target, commands, { timeoutMs }), { priority }),
    { includeSignal },
  );
  const scanComplete = !!scan.before && !!scan.after && !!scan.states;
  const globalOnts = scan.states ?? [];
  const { data: knownRows } = await supabaseAdmin
    .from('olt_onts')
    .select('id, serial, olt_device_id, frame, slot, port, ont_id, status, admin_state, rx_power, tx_power, client_id, contract_id').is('retired_at', null)
    .eq('olt_device_id', device.id);
  const known = (knownRows ?? []) as KnownOnt[];
  // Fase 4 OLT — historial de alertas: mapa por id para resolver el
  // snapshot de vinculo de cada alerta sin volver a consultar nada.
  const knownById = new Map(known.map((r) => [r.id, r]));
  const updatesById = new Map<string, PendingUpdate>();
  // Fase 3 comercial OLT: alertas proactivas, ver oltAlerts.ts — antes de
  // cada "row" se sobreescriba abajo todavia representa lo YA persistido,
  // asi que es el "before" correcto para detectar una transicion real.
  const alerts: OltAlertEvent[] = [];
  const signalReadings: { row: KnownOnt; evidence: ReturnType<typeof evaluateOntEvidence> }[] = [];
  function pushAlert(row: KnownOnt, kind: ReturnType<typeof detectStatusAlert>, detail: string) {
    if (!kind) return;
    alerts.push({ oltDeviceId: device.id, ontDbId: row.id, kind, message: `ONT ${detail}`, at: now });
  }

  const online = scanComplete ? globalOnts.filter(o => o.runState === 'working').length : 0;
  const offline = scanComplete ? globalOnts.filter(o => ['offline', 'los', 'dyinggasp'].includes(o.runState)).length : 0;
  const disabledCount = scanComplete ? globalOnts.filter(o => o.adminState === 'disable').length : 0;
  const ports = scanComplete ? uniquePorts(globalOnts) : [];
  const failedPorts = scan.failedPorts;
  for (const row of known) {
    const previous = ontTelemetry.project(row);
    const evidence = evaluateOntEvidence(row, scan);
    rememberOntEvidence(row, evidence);
    if (evidence.outcome !== 'valid') continue; // historical row stays intact
    const update: PendingUpdate = { id: row.id, status: evidence.status as 'online' | 'offline', admin_state: evidence.adminState, last_synced_at: scan.checkedAt };
    const statusAlert = detectStatusAlert({ status: previous.status, adminState: row.admin_state }, { status: update.status!, adminState: update.admin_state! });
    pushAlert(row, statusAlert, `posición ${evidence.position} ${statusAlert === 'offline' ? 'se desconectó' : 'volvió a estar en línea'}`);
    if (evidence.signalOutcome === 'valid') {
      update.rx_power = evidence.rxPower!; update.tx_power = evidence.txPower!;
      const signalAlert = detectSignalAlert(ontTelemetry.signalReference(row), update.rx_power, LOW_SIGNAL_THRESHOLD_DBM);
      pushAlert(row, signalAlert, `posición ${evidence.position} señal ${update.rx_power} dBm`);
      signalReadings.push({ row, evidence });
    }
    if (row.status !== update.status || row.admin_state !== update.admin_state || (update.rx_power !== undefined && row.rx_power !== update.rx_power) || (update.tx_power !== undefined && row.tx_power !== update.tx_power)) updatesById.set(row.id, update);
  }
  // Conditional writes close the database identity race; unchanged historical values are not rewritten.
  const updates = [...updatesById.values()];
  // Alerts may be valid even when the DB already holds the observed value (e.g. manual reading).
  if (updates.length || alerts.length) {
    let error: { message: string } | null = null;
    for (const update of updates) {
      try { await persistOntMeasurement(knownById.get(update.id)!, update); }
      catch (failure) { error = { message: failure instanceof Error ? failure.message : 'No se pudo guardar telemetría' }; break; }
    }
    if (error) {
      // eslint-disable-next-line no-console
      console.error(`[olt-sync] ${device.name}: fallo la escritura protegida de olt_onts:`, error.message);
    } else {
      for (const { row, evidence } of signalReadings) ontTelemetry.rememberSignal(row, evidence);
      for (const u of updates) {
        oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: ontTelemetry.project({ ...knownById.get(u.id)!, ...u }) });
      }
      // Solo tras confirmar que el cambio que la originó quedo persistido
      // (si el bulk update fallo, no hay nada confirmado que alertar).
      if (alerts.length) {
        // Fase 4 OLT — historial (ver oltAlertLog.ts/ESTADO_DESARROLLO.md
        // 13at): best-effort, nunca bloquea ni retrasa la alerta en vivo.
        // onConflict+ignoreDuplicates sobre el indice unico
        // (olt_ont_id,kind,at) evita duplicar si este mismo evento exacto
        // ya se hubiera insertado antes (defensa en profundidad, ademas de
        // que runningDeviceIds ya impide 2 syncs paralelos de la misma OLT).
        const rows = buildOltAlertLogRows(alerts, knownById);
        const { error: logError } = await supabaseAdmin
          .from('olt_alert_log')
          .upsert(rows, { onConflict: 'olt_ont_id,kind,at', ignoreDuplicates: true });
        if (logError) {
          // Prefijo propio (distinto de "[olt-sync]") para que un error de
          // PERSISTIR el historial sea identificable aparte de un error de
          // SINCRONIZAR la OLT — nunca bloquea el sync ni la alerta en vivo
          // (que ya se emite igual, abajo), y nunca genera una alerta falsa
          // (la deteccion ya ocurrio antes e independiente de este insert).
          // eslint-disable-next-line no-console
          console.error(
            `[olt-alert-log] ${device.name} (device ${device.id}): fallo guardar ${rows.length} evento(s) de historial — code=${logError.code ?? 's/d'} mensaje=${logError.message}`,
          );
        }
      }
      for (const a of alerts) oltEvents.emitOltAlert(a);
    }
  }
  if (!updates.length && !alerts.length) {
    for (const { row, evidence } of signalReadings) ontTelemetry.rememberSignal(row, evidence);
  }
  // One atomic durable snapshot per cycle, never one disk write per ONT.
  ontTelemetry.flushSignalReferences();

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

  const lowSignal = known.map(row => ontTelemetry.project(row)).filter(row => typeof row.rx_power === 'number' && row.rx_power < LOW_SIGNAL_THRESHOLD_DBM).length;

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
    portsScanned: includeSignal ? ports.length : 0,
    failedPorts,
    updatedOnts: updates.length,
  };
}
