import fs from 'node:fs';
import path from 'node:path';
import { normalizeGponSerial } from '../../../src/lib/gponSerial';
import type { WifiInventory } from '../../../src/lib/tr069WifiPlan';
import type { WifiTrialOperation, WifiTrialRecord, WifiTrialStatus } from '../../../src/lib/tr069WifiTrial';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { readWifiInventory, WIFI_TEST_DEVICE, WIFI_TEST_SERIAL } from './tr069WifiPreparation';

export const WIFI_TRIAL_PATH = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5';
export const WIFI_TRIAL_PARAMETER = WIFI_TRIAL_PATH + '.SSID';
const CONTRACT_ID = 'bf6b0f88-3c55-4c9b-aca2-5dfa739e738c';
export const WIFI_TRIAL_CONTRACT = 'CTR-2026-00214';
const ONT_ID = '8d3eb272-b90b-48b9-b834-2176e6003b6b';

export async function validateWifiTrialContract() {
  const { data: onts, error } = await supabaseAdmin.from('olt_onts')
    .select('id,serial,contract_id,client_id,retired_at').eq('contract_id', CONTRACT_ID).is('retired_at', null);
  if (error || onts?.length !== 1 || onts[0].id !== ONT_ID || normalizeGponSerial(onts[0].serial) !== WIFI_TEST_SERIAL) {
    throw new Error('La ONT o el contrato exacto no coinciden; operación bloqueada');
  }
  const { data: contract, error: ce } = await supabaseAdmin.from('service_contracts')
    .select('id,contract_number,client_id,status').eq('id', CONTRACT_ID).maybeSingle();
  if (ce || !contract || contract.contract_number !== WIFI_TRIAL_CONTRACT || contract.status !== 'active' ||
    !onts[0].client_id || onts[0].client_id !== contract.client_id) throw new Error('Contrato/cliente sin concordancia verificada');
  const { data: rows, error: te } = await supabaseAdmin.from('tr069_devices')
    .select('genieacs_id,cpe_serial,service_contract_id').eq('genieacs_id', WIFI_TEST_DEVICE);
  // El vínculo TR-069 nulo se admite solo por la cadena exacta ONT/contrato/cliente anterior.
  // No hay escrituras de asociación ni búsqueda por nombre del cliente.
  if (te || rows?.length !== 1 || normalizeGponSerial(rows[0].cpe_serial) !== WIFI_TEST_SERIAL ||
    (rows[0].service_contract_id !== null && rows[0].service_contract_id !== CONTRACT_ID)) throw new Error('Asociación TR-069 distinta o ambigua');
}

interface Dependencies {
  file?: string;
  enabled?: () => boolean;
  contract?: () => Promise<void>;
  inventory?: (nbi: string, serial: string) => Promise<WifiInventory>;
  request?: typeof fetch;
}

/** Cada envío nace de una acción explícita del panel. GET/status nunca encola tareas. */
export function createWifiTrial(deps: Dependencies = {}) {
  const file = deps.file ?? process.env.TR069_WIFI_TRIAL_JOURNAL ?? '/var/lib/smartrayco-olt/tr069-wifi-trial.json';
  const enabled = deps.enabled ?? (() => process.env.TR069_WIFI_TRIAL_ENABLED === WIFI_TEST_SERIAL + ':' + WIFI_TRIAL_CONTRACT);
  const contract = deps.contract ?? validateWifiTrialContract;
  const inventory = deps.inventory ?? readWifiInventory;
  const request = deps.request ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  function read(): WifiTrialRecord | null {
    if (!fs.existsSync(file)) return null;
    const r = JSON.parse(fs.readFileSync(file, 'utf8')) as WifiTrialRecord;
    if (r.version !== 1 || r.serial !== WIFI_TEST_SERIAL || r.deviceId !== WIFI_TEST_DEVICE || r.path !== WIFI_TRIAL_PATH ||
      r.contractNumber !== WIFI_TRIAL_CONTRACT || !Array.isArray(r.operations) || r.operations.length > 2) throw new Error('Respaldo persistente no válido; detener');
    return r;
  }
  function save(record: WifiTrialRecord) {
    const tmp = file + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }
  async function lock<T>(work: () => Promise<T>): Promise<T> {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let fd: number;
    try { fd = fs.openSync(file + '.lock', 'wx', 0o600); } catch { throw new Error('Hay una operación en curso o bloqueo pendiente de revisión'); }
    try { return await work(); } finally { fs.closeSync(fd); fs.unlinkSync(file + '.lock'); }
  }
  function scope(serial: string) {
    if (!enabled()) throw new Error('Prueba WiFi no habilitada');
    if (normalizeGponSerial(serial) !== WIFI_TEST_SERIAL) throw new Error('Prueba limitada a HWTC1D3691B7');
  }
  async function current(nbi: string) {
    const inv = await inventory(nbi, WIFI_TEST_SERIAL);
    if (inv.deviceId !== WIFI_TEST_DEVICE || inv.serial !== WIFI_TEST_SERIAL) throw new Error('Identidad GenieACS distinta; detener');
    const net = inv.networks.find(n => n.path === WIFI_TRIAL_PATH);
    if (!net || typeof net.ssid !== 'string' || !net.ssid || !net.timestamp || !Number.isFinite(Date.parse(net.timestamp)) ||
      net.enabled === false || net.writable !== true) throw new Error('SSID sin respaldo recuperable o capacidad anunciada de escritura');
    return { inv, net };
  }
  async function collection(nbi: string, name: string, query: unknown) {
    const r = await request(`${nbi}/${name}/?query=${encodeURIComponent(JSON.stringify(query))}`, { method: 'GET', signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error('No se pudo consultar estado de tareas; no repetir el envío');
    return await r.json() as Record<string, unknown>[];
  }
  async function pending(nbi: string) { return collection(nbi, 'tasks', { device: WIFI_TEST_DEVICE }); }
  async function faults(nbi: string) {
    // Prefijo de dispositivo completo escapado: cualquier fault de esta ONT exige revisión.
    // No depender de un formato de canal/task específico del firmware o versión del ACS.
    // Constante fija sin metacaracteres regex; nunca se concatena entrada del usuario.
    return collection(nbi, 'faults', { _id: { $regex: '^' + WIFI_TEST_DEVICE + ':' } });
  }
  async function enqueue(nbi: string, task: object) {
    // Sin connection_request: no cambiar gestión ni forzar una sesión CPE.
    const r = await request(`${nbi}/devices/${encodeURIComponent(WIFI_TEST_DEVICE)}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task), signal: AbortSignal.timeout(20_000),
    });
    if (![200, 202].includes(r.status)) throw new Error('No se pudo confirmar el envío; revisar estado antes de repetir');
    const body = await r.json() as { _id?: unknown };
    if (typeof body._id !== 'string' || !body._id) throw new Error('Respuesta sin identificador de tarea; detener');
    return body._id;
  }
  async function inspect(nbi: string): Promise<WifiTrialStatus> {
    const record = read();
    if (!record) return { enabled: enabled(), record, message: 'Sin cambios enviados. El respaldo se guardará antes del primer envío.' };
    const op = record.operations.at(-1)!;
    if (op.state === 'uncertain' || op.state === 'sending') return { enabled: enabled(), record, message: 'Resultado incierto: no repetir ni restaurar a ciegas; requiere revisión de la tarea.' };
    const tasks = await pending(nbi);
    if ((await faults(nbi)).length) {
      op.state = 'failed'; save(record);
      return { enabled: enabled(), record, message: 'GenieACS informa un fallo. No hay cambio confirmado; no acumular tareas.' };
    }
    if (tasks.some(t => t._id === op.taskId || t._id === op.readTaskId)) return { enabled: enabled(), record, message: 'Pendiente del próximo Inform o de completar la tarea; todavía no confirmado.' };
    if (!op.readTaskId) return { enabled: enabled(), record, message: 'Tarea de cambio ya no pendiente. Pulsa Verificar resultado para leer este SSID.' };
    const { inv, net } = await current(nbi);
    const after = Date.parse(op.readSentAt!);
    if (Date.parse(inv.lastInform ?? '') > Date.parse(op.sentAt) && Date.parse(net.timestamp!) >= after && net.ssid === op.after) {
      op.state = 'verified'; op.verifiedAt = new Date().toISOString(); save(record);
      return { enabled: enabled(), record, message: op.kind === 'restore'
        ? 'SSID anterior verificado en GenieACS. Comprueba también la red y navegación.'
        : 'Nuevo SSID verificado en GenieACS. Comprueba también la red y navegación.' };
    }
    return { enabled: enabled(), record, message: 'Pendiente: falta un Inform nuevo o una lectura posterior con el SSID esperado.' };
  }
  function input(raw: unknown, keys: string[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Solicitud inválida');
    const b = raw as Record<string, unknown>;
    if (Object.keys(b).some(k => !keys.includes(k)) || b.confirmed !== true || typeof b.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(b.requestId)) throw new Error('Confirmación o identificador inválido; solo un SSID permitido');
    return b;
  }
  async function change(nbi: string, serial: string, raw: unknown, actorId: string, restore = false) {
    scope(serial);
    const b = input(raw, restore ? ['requestId', 'confirmed'] : ['requestId', 'confirmed', 'deviceId', 'path', 'ssid', 'expectedSsid', 'expectedTimestamp']);
    return lock(async () => {
      await contract();
      let record = read();
      if (record?.operations.some(o => o.requestId === b.requestId)) return inspect(nbi); // Nunca reenvía por timeout del navegador.
      const last = record?.operations.at(-1);
      if (!restore && record) throw new Error('La prueba ya tiene un cambio. Verifica o restaura el respaldo antes de otra operación.');
      if (restore && (!record || !last || last.kind !== 'change' || last.state !== 'verified')) throw new Error('Primero verifica el cambio; no restaurar sobre una tarea pendiente');
      const { net } = await current(nbi);
      if ((await pending(nbi)).length) throw new Error('Hay tareas pendientes en este equipo; no se envió otro cambio');
      if ((await faults(nbi)).length) throw new Error('Hay fallos GenieACS de este equipo pendientes de revisión; no se envió cambio');
      const target = restore ? record!.originalSsid : b.ssid;
      if (typeof target !== 'string' || !target.trim() || Buffer.byteLength(target, 'utf8') > 32 || /[\x00-\x1f\x7f]/.test(target)) throw new Error('SSID inválido: 1 a 32 bytes, sin controles');
      if (!restore && (b.deviceId !== WIFI_TEST_DEVICE || b.path !== WIFI_TRIAL_PATH || b.expectedSsid !== net.ssid || b.expectedTimestamp !== net.timestamp)) throw new Error('La identidad, instancia o SSID actual cambió; vuelve a consultar');
      if (restore && net.ssid !== last!.after) throw new Error('El SSID cambió fuera de esta prueba; no restaurar automáticamente');
      if (target === net.ssid) throw new Error('El SSID ya tiene ese nombre; no se envió tarea');
      if (!record) record = { version: 1, serial: WIFI_TEST_SERIAL, deviceId: WIFI_TEST_DEVICE, contractNumber: WIFI_TRIAL_CONTRACT,
        path: WIFI_TRIAL_PATH, originalSsid: net.ssid!, originalTimestamp: net.timestamp!, operations: [] };
      const op: WifiTrialOperation = { requestId: b.requestId as string, kind: restore ? 'restore' : 'change', actorId,
        before: net.ssid!, after: target, sentAt: new Date().toISOString(), state: 'sending' };
      record.operations.push(op); save(record); // Si no se puede respaldar, nunca se llega al POST.
      try { op.taskId = await enqueue(nbi, { name: 'setParameterValues', parameterValues: [[WIFI_TRIAL_PARAMETER, target, 'xsd:string']] }); op.state = 'queued'; }
      catch { op.state = 'uncertain'; }
      save(record);
      return { enabled: enabled(), record, message: op.state === 'queued' ? 'Cambio encolado, no confirmado. Espera el próximo Inform y pulsa Verificar resultado.' : 'Envío incierto. No repitas el cambio; revisa el estado.' };
    });
  }
  return {
    status: (nbi: string, serial: string) => { scope(serial); return lock(() => inspect(nbi)); },
    change: (nbi: string, serial: string, raw: unknown, actor: string) => change(nbi, serial, raw, actor),
    restore: (nbi: string, serial: string, raw: unknown, actor: string) => change(nbi, serial, raw, actor, true),
    verify: async (nbi: string, serial: string) => {
      scope(serial);
      return lock(async () => {
        await contract(); const status = await inspect(nbi); const op = status.record?.operations.at(-1);
        if (!op || op.state !== 'queued' || op.readTaskId || (await pending(nbi)).length || (await faults(nbi)).length) return status;
        op.readSentAt = new Date().toISOString(); save(status.record!);
        try { op.readTaskId = await enqueue(nbi, { name: 'getParameterValues', parameterNames: [WIFI_TRIAL_PARAMETER] }); }
        catch { op.state = 'uncertain'; }
        save(status.record!);
        return { ...status, message: op.state === 'uncertain' ? 'Lectura con resultado incierto; no repetir tareas.' : 'Lectura puntual encolada. Espera un nuevo Inform y consulta el estado.' };
      });
    },
  };
}
export const wifiTrial = createWifiTrial();
