import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeGponSerial } from '../../../src/lib/gponSerial';
import type { HostsReadResult, HostsReadState } from '../../../src/lib/tr069Hosts';
import { readHostsDevice, hostsInventoryFromDevice, type HostsDevice } from './tr069Hosts';
import { applyHostsHistory } from './tr069HostsHistory';

type Node = Record<string, any>;
type RecordRead = { deviceId: string; serial: string; requestedAt: string; expiresAt: string;
  state: HostsReadState; taskId?: string; parameters: string[] };
const LAN = 'InternetGatewayDevice.LANDevice.1.';
const HOST_FIELDS = ['Active', 'InterfaceType', 'Layer2Interface', 'HostName', 'IPAddress', 'MACAddress', 'X_HW_RSSI', 'X_HW_RSSIUnit'];
const ASSOCIATED_FIELDS = ['AssociatedDeviceMACAddress', 'MACAddress', 'RSSI', 'RSSIUnit', 'SignalStrength', 'SignalStrengthUnit', 'X_HW_RSSI', 'X_HW_RSSIUnit'];
export const HOSTS_READ_LIFETIME_MS = 45_000;
/**
 * Una tarea ajena a esta lectura (de otro botón/función TR-069, p. ej. el
 * "Actualizar" general de la tarjeta) que lleva mucho tiempo sin resolverse
 * ya no representa una operación realmente en curso — bloquear Hosts para
 * siempre por ella sería un bloqueo permanente, no una protección real.
 * 5 minutos es varias veces el tiempo máximo que toma cualquier intento real
 * (connection_request 12 s + envío 15 s + un par de lecturas de cola, todo
 * bajo el minuto). Nunca se cancela ni se borra esa tarea desde aquí — solo
 * deja de impedir una lectura NUEVA y acotada de Hosts. Una tarea sin fecha
 * utilizable se trata como si pudiera seguir activa (nunca se asume vieja
 * sin poder confirmarlo).
 */
export const FOREIGN_TASK_STALE_AFTER_MS = 5 * 60_000;
export class HostsDemandError extends Error {}

/** Habilitación explícita por serial: el interruptor global no autoriza otras ONT. */
export function hostsDemandEnabledForSerial(raw: string): boolean {
  const serial = normalizeGponSerial(raw);
  return !!serial && process.env.TR069_HOSTS_ON_DEMAND_ENABLED === 'true' &&
    (process.env.TR069_HOSTS_ON_DEMAND_SERIALS ?? '').split(',').some(s => normalizeGponSerial(s) === serial);
}

/** Solo hojas concretas anunciadas; nunca prefijos, comodines, claves ni refresh del árbol. */
export function buildHostsReadPlan(device: HostsDevice): string[] {
  const lan = (device as Node).InternetGatewayDevice?.LANDevice?.[1];
  const parameters: string[] = [];
  const add = (node: Node, base: string, fields: string[]) => {
    for (const field of fields) if (node?.[field] && node[field]._object !== true) parameters.push(base + '.' + field);
  };
  const hosts = Object.entries(lan?.Hosts?.Host ?? {}).filter(([i]) => /^[1-9]\d*$/.test(i));
  if (!hosts.length || hosts.length > 64) throw new Error('La lista del equipo no permite una lectura acotada.');
  for (const [i, node] of hosts) add(node as Node, LAN + 'Hosts.Host.' + i, HOST_FIELDS);
  const wlans = lan?.WLANConfiguration ?? {};
  for (const [i, wlan] of Object.entries(wlans)) {
    if (!/^[1-9]\d*$/.test(i)) continue;
    for (const [j, node] of Object.entries((wlan as Node).AssociatedDevice ?? {})) {
      if (/^[1-9]\d*$/.test(j)) add(node as Node, LAN + 'WLANConfiguration.' + i + '.AssociatedDevice.' + j, ASSOCIATED_FIELDS);
    }
  }
  if (!parameters.some(p => p.endsWith('.Active')) || parameters.length > 512) throw new Error('El equipo no ofrece una lectura de Hosts segura y acotada.');
  for (const p of parameters) {
    if (!/^InternetGatewayDevice\.LANDevice\.1\.(Hosts\.Host\.[1-9]\d*\.(Active|InterfaceType|Layer2Interface|HostName|IPAddress|MACAddress|X_HW_RSSI|X_HW_RSSIUnit)|WLANConfiguration\.[1-9]\d*\.AssociatedDevice\.[1-9]\d*\.(AssociatedDeviceMACAddress|MACAddress|RSSI|RSSIUnit|SignalStrength|SignalStrengthUnit|X_HW_RSSI|X_HW_RSSIUnit))$/.test(p)) throw new Error('Lectura fuera del alcance de Hosts.');
  }
  return parameters;
}

export function createHostsOnDemand(deps: {
  request?: typeof fetch; now?: () => number; directory?: string; enabled?: (serial: string) => boolean;
} = {}) {
  const request = deps.request ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? Date.now;
  const directory = deps.directory ?? process.env.TR069_HOSTS_READS_DIR ?? '/var/lib/smartrayco-olt/hosts-reads';
  const enabled = deps.enabled ?? hostsDemandEnabledForSerial;
  const inFlight = new Map<string, Promise<HostsReadResult>>();

  async function collection(nbi: string, name: 'tasks' | 'faults', query: object) {
    const projection = name === 'tasks' ? '_id,name,device,timestamp,expiry,parameterNames' : '_id,code,timestamp,retries';
    const r = await request(`${nbi}/${name}/?query=${encodeURIComponent(JSON.stringify(query))}&projection=${encodeURIComponent(projection)}`,
      { method: 'GET', signal: AbortSignal.timeout(5_000) });
    if (!r.ok) throw new Error('No se pudo comprobar la lectura. No se enviará otra automáticamente.');
    return await r.json() as Node[];
  }
  const matchesTask = (task: Node, record: RecordRead) => task.name === 'getParameterValues' && task.device === record.deviceId &&
    task.expiry === record.expiresAt && JSON.stringify(task.parameterNames) === JSON.stringify(record.parameters);

  async function perform(nbi: string, serial: string): Promise<HostsReadResult> {
    if (!enabled(serial)) throw new HostsDemandError('La consulta bajo demanda no está habilitada para este equipo.');
    let device = await readHostsDevice(nbi, serial, request);
    if (!device) throw new HostsDemandError('No se encontró un único equipo para consultar sus dispositivos.');
    const beforeDevice = structuredClone(device);
    const deviceId = device._id;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, crypto.createHash('sha256').update(nbi + '\n' + deviceId).digest('hex') + '.json');
    let lock: number;
    try { lock = fs.openSync(file + '.lock', 'wx', 0o600); }
    catch { throw new HostsDemandError('Ya hay una lectura en curso para este equipo.'); }
    let record: RecordRead | null = null;
    const save = () => { const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 }); fs.renameSync(temp, file); };
    // El merge de historial solo decora la respuesta externa; la confirmación
    // de la lectura (abajo, en complete()) sigue comparando exclusivamente
    // contra los hosts que el equipo reportó en vivo, nunca contra fantasmas.
    const result = (state: HostsReadState, message: string): HostsReadResult => ({ state,
      requestedAt: record!.requestedAt, checkedAt: new Date(now()).toISOString(), message,
      inventory: applyHostsHistory(hostsInventoryFromDevice(device, serial), directory, now) });
    const cancel = async (task: Node) => {
      if (!record?.taskId || task._id !== record.taskId || !matchesTask(task, record)) throw new Error('No se pudo retirar de forma segura la lectura pendiente.');
      const r = await request(`${nbi}/tasks/${encodeURIComponent(record.taskId)}`, { method: 'DELETE', signal: AbortSignal.timeout(5_000) });
      if (!r.ok && r.status !== 404) throw new Error('No se pudo retirar la lectura. No repitas la solicitud.');
    };
    const complete = async () => {
      const refreshed = await readHostsDevice(nbi, serial, request);
      if (!refreshed || refreshed._id !== deviceId) throw new HostsDemandError('La identidad cambió durante la lectura; datos sin confirmar.');
      device = refreshed;
      const inv = hostsInventoryFromDevice(device, serial);
      const start = Date.parse(record!.requestedAt);
      // Un 200 o un Inform, por sí solos, nunca convierten una muestra vieja en nueva.
      const confirmed = inv.hosts.length > 0 && inv.hosts.every(h => typeof h.active === 'boolean' &&
        [h.activeReportedAt, h.connectionReportedAt, h.macReportedAt, h.layer2ReportedAt, h.reportedAt].every(t => !!t && Date.parse(t) >= start && Date.parse(t) <= now()));
      record!.state = confirmed ? 'completed' : 'failed'; save();
      if (!confirmed) device = beforeDevice; // No mezclar valores nuevos con MAC/nombre históricos de otra instancia.
      return result(record!.state, confirmed ? 'Lectura recibida del equipo.' : 'La lectura terminó sin confirmar todos los datos. Se conserva la información anterior.');
    };
    try {
      if (fs.existsSync(file)) {
        record = JSON.parse(fs.readFileSync(file, 'utf8')) as RecordRead;
        if (record.deviceId !== deviceId || record.serial !== serial || !Array.isArray(record.parameters)) throw new Error('Registro de lectura incompatible; no se enviará otra solicitud.');
      }
      let tasks = await collection(nbi, 'tasks', { device: deviceId });
      if (record && ['pending', 'uncertain'].includes(record.state)) {
        if (!record.taskId) {
          const candidates = tasks.filter(t => matchesTask(t, record!));
          if (candidates.length > 1) throw new Error('Hay lecturas ambiguas; no se enviará otra solicitud.');
          if (candidates.length === 1) { record.taskId = candidates[0]!._id; save(); }
        }
        const own = tasks.find(t => t._id === record!.taskId);
        const faults = record.taskId ? await collection(nbi, 'faults', { _id: deviceId + ':task_' + record.taskId }) : [];
        if (faults.length || now() >= Date.parse(record.expiresAt)) {
          if (own) await cancel(own);
          record.state = faults.length ? 'failed' : 'expired'; save();
          return result(record.state, faults.length ? 'El equipo no completó la lectura. No se reintentó.' : 'La lectura agotó su tiempo de espera. Se conservan los datos anteriores.');
        }
        if (own || !record.taskId) return result(record.state, record.taskId ? 'La lectura sigue pendiente. Pulsa Actualizar para comprobarla.' : 'El envío no está confirmado. Actualizar solo comprobará su estado, sin reenviarlo.');
        return await complete(); // Lectura final acotada de caché, manteniendo el lock; nunca otra tarea.
      }
      // Solo una tarea ajena realmente reciente bloquea — una vieja y atascada
      // (de otra función, nunca de esta lectura: aquí ya no quedan tareas
      // propias por el bloque anterior) ya no se trata como "en curso". Nunca
      // se cancela ni se borra ninguna tarea; solo se deja de esperarla.
      const nowForTasks = now();
      const blockingTasks = tasks.filter(t => {
        const age = nowForTasks - Date.parse(t.timestamp);
        return !Number.isFinite(age) || age < FOREIGN_TASK_STALE_AFTER_MS;
      });
      if (blockingTasks.length) throw new HostsDemandError('El equipo tiene otra operación pendiente. Espera antes de solicitar una lectura.');
      const informAge = now() - Date.parse(device._lastInform ?? '');
      if (!Number.isFinite(informAge) || informAge < 0 || informAge > 10 * 60_000) throw new HostsDemandError('El equipo no tiene comunicación reciente. Se conserva la información anterior.');
      const parameters = buildHostsReadPlan(device);
      record = { deviceId, serial, requestedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + HOSTS_READ_LIFETIME_MS).toISOString(), state: 'uncertain', parameters };
      save(); // Antes del POST: un timeout o reinicio de backend nunca debe causar reenvío ciego.
      let response: Response;
      try {
        response = await request(`${nbi}/devices/${encodeURIComponent(deviceId)}/tasks?timeout=12000&connection_request`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ name: 'getParameterValues', parameterNames: parameters, expiry: record.expiresAt }),
        });
        const body = await response.json() as Node;
        if (![200, 202].includes(response.status) || typeof body._id !== 'string' || !/^[a-f0-9]{24}$/i.test(body._id)) {
          return result('uncertain', 'No se pudo confirmar el envío. No se repetirá automáticamente.');
        }
        record.taskId = body._id; record.state = 'pending'; save();
      } catch { return result('uncertain', 'El envío agotó su espera o no pudo confirmarse. No se repetirá automáticamente.'); }
      tasks = await collection(nbi, 'tasks', { device: deviceId });
      const faults = await collection(nbi, 'faults', { _id: deviceId + ':task_' + record.taskId });
      const own = tasks.find(t => t._id === record!.taskId);
      if (faults.length) {
        if (own) await cancel(own);
        record.state = 'failed'; save(); return result('failed', 'El equipo no completó la lectura. No se reintentó.');
      }
      if (response.status === 200 && !own) return await complete();
      return result('pending', 'La lectura está pendiente del equipo. Pulsa Actualizar para comprobarla; no se enviará otra.');
    } finally { fs.closeSync(lock); fs.unlinkSync(file + '.lock'); }
  }

  function read(nbi: string, rawSerial: string): Promise<HostsReadResult> {
    const serial = normalizeGponSerial(rawSerial);
    if (!serial) return Promise.reject(new Error('Serial GPON inválido.'));
    const key = nbi + '\n' + serial;
    const running = inFlight.get(key);
    if (running) return running;
    const job = perform(nbi, serial).finally(() => { inFlight.delete(key); });
    inFlight.set(key, job);
    return job;
  }
  return { read };
}

export const hostsOnDemand = createHostsOnDemand();
