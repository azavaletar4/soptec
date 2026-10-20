import { fullRunningConfigCommand, listAllOntsCommands, bulkOnuRxCommands, bulkOnuTxCommands, type ZteInterfaceRef } from '../ssh/zteCommands';
import { parseFullRunningConfig, parseGlobalOntState, parseBulkPower, type GlobalOnt, type FullConfigOnt } from '../ssh/zteParsers';
import { oltEvents } from './oltEvents';

export interface OntIdentity { id: string; olt_device_id: string; serial: string; frame: number; slot: number; port: number; ont_id: number }
export type EvidenceOutcome = 'valid' | 'failed' | 'absent' | 'moved' | 'conflict' | 'ambiguous' | 'unconfirmed';
export const ontPosition = (o: Pick<OntIdentity, 'frame' | 'slot' | 'port' | 'ont_id'>) => `${o.frame}/${o.slot}/${o.port}:${o.ont_id}`;
const serialKey = (s: string) => s.trim().toUpperCase();
type Bindings = Map<string, FullConfigOnt>;
export interface TelemetryScan {
  before: Bindings | null; after: Bindings | null; states: GlobalOnt[] | null;
  rx: Map<string, Map<number, number>>; tx: Map<string, Map<number, number>>;
  failedPorts: string[]; signalRequested: boolean; checkedAt: string;
  stateReadAt: string | null; signalReadAt: Map<string, string>;
}
type Read = (commands: string[], timeoutMs: number) => Promise<string[]>;
function bindings(raw: string): Bindings {
  const count = [...raw.matchAll(/^\s*onu \d+ type \S+ sn \S+/gm)].length;
  const parsed = new Map([...parseFullRunningConfig(raw)].filter(([, v]) => !!v.serial));
  // A transport success with empty/truncated/unrecognised output is NOT proof of absence.
  if (!count || count !== parsed.size) throw Error('Configuración de identidad incompleta o ambigua');
  return parsed;
}
/** Bracket all observations with full serial inventories. Never writes or configures an OLT. */
export async function collectOltTelemetry(read: Read, options: { includeSignal: boolean; port?: ZteInterfaceRef }): Promise<TelemetryScan> {
  const result: TelemetryScan = { before: null, after: null, states: null, rx: new Map(), tx: new Map(), failedPorts: [], signalRequested: options.includeSignal, checkedAt: new Date().toISOString(), stateReadAt: null, signalReadAt: new Map() };
  try { result.before = bindings((await read(fullRunningConfigCommand(), 120000)).join('\n')); } catch { return result; }
  try {
    const raw = (await read(listAllOntsCommands(), 60000)).join('\n');
    if (!/OnuIndex/i.test(raw) || !/ONU Number/i.test(raw)) throw Error('Estado incompleto');
    result.states = parseGlobalOntState(raw);
    result.stateReadAt = new Date().toISOString();
    const positions = result.states.map(s => `${s.frame}/${s.slot}/${s.port}:${s.onuId}`);
    if (new Set(positions).size !== positions.length) result.states = null;
  } catch { /* failed state stays null, never offline */ }
  const ports = new Map<string, ZteInterfaceRef>();
  for (const s of result.states ?? []) {
    if (options.port && (s.frame !== options.port.shelf || s.slot !== options.port.slot || s.port !== options.port.port)) continue;
    ports.set(`${s.frame}/${s.slot}/${s.port}`, { shelf: s.frame, slot: s.slot, port: s.port });
  }
  for (const [key, ref] of options.includeSignal ? ports : []) {
    try {
      // Separate sessions: this firmware hangs if RX and TX share one connection.
      result.rx.set(key, parseBulkPower((await read(bulkOnuRxCommands(ref), 30000))[1] ?? ''));
      result.tx.set(key, parseBulkPower((await read(bulkOnuTxCommands(ref), 30000))[1] ?? ''));
      result.signalReadAt.set(key, new Date().toISOString());
    } catch { result.failedPorts.push(key); result.rx.delete(key); result.tx.delete(key); }
  }
  try { result.after = bindings((await read(fullRunningConfigCommand(), 120000)).join('\n')); } catch { /* cannot attribute observations without closing identity check */ }
  result.checkedAt = new Date().toISOString();
  return result;
}
export interface OntEvidence {
  oltDeviceId: string;
  stateReadAt: string | null; signalReadAt: string | null;
  outcome: EvidenceOutcome; checkedAt: string; validUntil: string; position: string;
  serial: string; observedSerial: string | null; observedPosition?: string;
  status: 'online' | 'offline' | 'unknown'; adminState?: 'enable' | 'disable';
  rxPower: number | null; txPower: number | null; signalOutcome: 'valid' | 'failed' | 'not-read';
}
const ttl = () => Math.max(60000, Math.min(65, Number(process.env.OLT_SYNC_INTERVAL_MINUTES ?? 20) + 5) * 60000);
export function evaluateOntEvidence(row: OntIdentity, scan: TelemetryScan): OntEvidence {
  const position = ontPosition(row), serial = serialKey(row.serial), after = scan.after?.get(position);
  const e: OntEvidence = { oltDeviceId: row.olt_device_id, stateReadAt: scan.stateReadAt, signalReadAt: null, outcome: 'failed', checkedAt: scan.checkedAt, validUntil: new Date(Date.parse(scan.stateReadAt ?? scan.checkedAt) + ttl()).toISOString(), position, serial: row.serial, observedSerial: after?.serial ?? null, status: 'unknown', rxPower: null, txPower: null, signalOutcome: scan.signalRequested ? 'failed' : 'not-read' };
  if (!scan.before || !scan.after) return e;
  const beforeMatches = [...scan.before].filter(([, b]) => serialKey(b.serial) === serial);
  const afterMatches = [...scan.after].filter(([, b]) => serialKey(b.serial) === serial);
  if (beforeMatches.length > 1 || afterMatches.length > 1) { e.outcome = 'ambiguous'; return e; }
  if (after && serialKey(after.serial) !== serial) {
    e.outcome = 'conflict'; e.observedPosition = afterMatches[0]?.[0]; return e;
  }
  if (afterMatches[0]?.[0] !== position) {
    e.outcome = afterMatches.length ? 'moved' : 'absent'; e.observedPosition = afterMatches[0]?.[0]; return e;
  }
  if (beforeMatches[0]?.[0] !== position || serialKey(scan.before.get(position)?.serial ?? '') !== serial) { e.outcome = 'conflict'; return e; }
  const state = scan.states?.find(s => `${s.frame}/${s.slot}/${s.port}:${s.onuId}` === position);
  if (!state) return e;
  if (!['enable', 'disable'].includes(state.adminState)) return e;
  if (!['working', 'offline', 'los', 'dyinggasp'].includes(state.runState.toLowerCase())) return e;
  e.outcome = 'valid'; e.status = state.runState === 'working' ? 'online' : 'offline'; e.adminState = state.adminState;
  const key = `${row.frame}/${row.slot}/${row.port}`;
  const rx = scan.rx.get(key)?.get(row.ont_id), tx = scan.tx.get(key)?.get(row.ont_id);
  if (scan.signalRequested && rx !== undefined && tx !== undefined && e.status === 'online') {
    e.rxPower = rx; e.txPower = tx; e.signalOutcome = 'valid';
    e.signalReadAt = scan.signalReadAt.get(key) ?? null;
  }
  return e;
}

/** Ephemeral evidence: restart/expiry/failure never upgrades historical database values to live. */
export class OntTelemetryEvidence {
  private evidence = new Map<string, OntEvidence>();
  constructor(private now: () => number = Date.now) {}
  remember(row: OntIdentity, evidence: OntEvidence) { this.evidence.set(row.id, evidence); }
  invalidate(id: string) { this.evidence.delete(id); }
  project<T extends { id: string; olt_device_id?: string; serial?: string; frame?: number; slot?: number; port?: number; ont_id?: number; status?: unknown; rx_power?: unknown; tx_power?: unknown; last_synced_at?: unknown }>(row: T) {
    const saved = this.evidence.get(row.id);
    const valid = saved && row.olt_device_id === saved.oltDeviceId && serialKey(row.serial ?? '') === serialKey(saved.serial) && ontPosition(row as unknown as OntIdentity) === saved.position && this.now() <= Date.parse(saved.validUntil);
    const e = valid ? saved : null;
    const historical = 'telemetry' in row ? (row.telemetry as { historical?: unknown } | undefined)?.historical : undefined;
    return { ...row, status: e?.status ?? 'unknown', rx_power: e?.signalOutcome === 'valid' ? e.rxPower : null, tx_power: e?.signalOutcome === 'valid' ? e.txPower : null,
      telemetry: { outcome: e?.outcome ?? 'unconfirmed', checkedAt: e?.checkedAt ?? null, stateReadAt: e?.stateReadAt ?? null, signalReadAt: e?.signalReadAt ?? null, validUntil: e?.validUntil ?? null, observedSerial: e?.observedSerial ?? null, observedPosition: e?.observedPosition ?? null, signalOutcome: e?.signalOutcome ?? 'not-read',
        historical: historical ?? { status: row.status, rxPower: row.rx_power, txPower: row.tx_power, at: row.last_synced_at } } };
  }
}
export const ontTelemetry = new OntTelemetryEvidence();
export function presentOntData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(presentOntData) as T;
  if (value && typeof value === 'object' && 'id' in value && 'serial' in value && 'ont_id' in value) {
    return ontTelemetry.project(value as unknown as OntIdentity) as T;
  }
  return value;
}
export function rememberOntEvidence(row: OntIdentity, e: OntEvidence) {
  ontTelemetry.remember(row, e);
  if (e.outcome !== 'valid') {
    // Only allowlisted identifiers; no raw config, descriptions, client data or credentials.
    const safe = (s: string | null | undefined) => s?.replace(/[^a-zA-Z0-9_/:.-]/g, '').slice(0, 80) ?? null;
    console.warn('[olt-identity]', JSON.stringify({ device: safe(row.olt_device_id), position: safe(e.position), expectedSerial: safe(row.serial), observedSerial: safe(e.observedSerial), observedPosition: safe(e.observedPosition), outcome: e.outcome, checkedAt: e.checkedAt }));
  }
  oltEvents.emitOntChanged({ oltDeviceId: row.olt_device_id, ont: ontTelemetry.project(row) });
}
