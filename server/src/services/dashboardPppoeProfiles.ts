import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { PPPOE_DASHBOARD_PROFILES, type PppoeProfileResult } from '../../../src/lib/pppoeProfileCounts';

export const PPPOE_CACHE_TTL_MS = 60_000;
export const PPPOE_SECRET_PATH = '/ppp/secret?.proplist=name,profile,service';
export const PPPOE_ACTIVE_PATH = '/ppp/active?.proplist=name,service,radius';
export const PPPOE_RESOURCE_PATH = '/system/resource?.proplist=board-name';
export interface PppoeAdminDevice {
  id: string; device_role: string; is_active: boolean;
  host: string; port: number; use_tls: boolean; username: string; password: string;
}
interface Dependencies {
  findAdmins: () => Promise<PppoeAdminDevice[]>;
  read: (target: MikrotikTarget, path: string) => Promise<unknown>;
  now?: () => number;
}
type Row = Record<string, unknown>;
const yes = (value: unknown) => value === true || value === 'true' || value === 'yes';
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw Error('INVALID_REPLY');
  return value;
}

// Solo agregados salen de esta funcion. Ni la cache ni los logs guardan listas.
export function aggregatePppoeProfiles(secretsReply: unknown, activeReply: unknown) {
  const profiles = PPPOE_DASHBOARD_PROFILES.map(profile => ({ ...profile, registered: 0, connected: 0 }));
  const byProfile = new Map<string, typeof profiles[number]>(profiles.map(row => [row.profile, row]));
  const byName = new Map<string, { profile: string; eligible: boolean }[]>();
  const secretIds = new Map<string, string>();
  for (const row of rows(secretsReply)) {
    if (typeof row.name !== 'string' || !row.name || typeof row.profile !== 'string' || !row.profile || typeof row.service !== 'string') throw Error('INVALID_SECRET_REPLY');
    // Un secret es un registro; incluye deshabilitados. Evita repetir el mismo ID.
    if (typeof row['.id'] === 'string') {
      const fingerprint = JSON.stringify([row.name, row.profile, row.service]);
      const previous = secretIds.get(row['.id']);
      if (previous && previous !== fingerprint) throw Error('CONFLICTING_SECRET_ID');
      if (previous) continue;
      secretIds.set(row['.id'], fingerprint);
    }
    const profile = byProfile.get(row.profile);
    if (profile) profile.registered++;
    const records = byName.get(row.name) ?? [];
    records.push({ profile: row.profile, eligible: row.service === 'pppoe' || row.service === 'any' });
    byName.set(row.name, records);
  }
  const users = new Map<string, { radius: boolean }>();
  for (const row of rows(activeReply)) {
    if (typeof row.service !== 'string') throw Error('INVALID_ACTIVE_REPLY');
    if (row.service !== 'pppoe') continue;
    if (typeof row.name !== 'string' || !row.name) throw Error('INVALID_ACTIVE_REPLY');
    users.set(row.name, { radius: yes(row.radius) || users.get(row.name)?.radius === true });
  }
  let unassigned = 0;
  for (const [name, session] of users) {
    const secrets = byName.get(name);
    const matches = new Set(secrets?.filter(row => row.eligible).map(row => row.profile));
    // /ppp/active no publica el perfil efectivo RADIUS: no inferirlo del secret.
    if (session.radius || matches.size !== 1) { unassigned++; continue; }
    const profile = byProfile.get([...matches][0]!);
    if (profile) profile.connected++;
  }
  return { profiles, partial: unassigned > 0 };
}

export async function readPppoeAdminProfiles(deps: Dependencies) {
  const devices = await deps.findAdmins();
  if (devices.length !== 1 || devices[0]!.device_role !== 'pppoe_admin' || devices[0]!.is_active !== true) throw Error('ADMIN_NOT_UNIQUE');
  const device = devices[0]!;
  const target: MikrotikTarget = { host: device.host, port: device.port, useTls: device.use_tls, username: device.username, password: device.password };
  const resource = await deps.read(target, PPPOE_RESOURCE_PATH);
  const board = Array.isArray(resource) ? resource.length === 1 ? resource[0] : null : resource;
  if (!board || typeof board !== 'object' || typeof board['board-name'] !== 'string' || !/^CCR2116(?:-|$)/.test(board['board-name'])) throw Error('ADMIN_NOT_CCR2116');
  const [secrets, active] = await Promise.all([deps.read(target, PPPOE_SECRET_PATH), deps.read(target, PPPOE_ACTIVE_PATH)]);
  return aggregatePppoeProfiles(secrets, active);
}

export function createDashboardPppoeReader(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  let cached: PppoeProfileResult | null = null;
  let nextReadAt = 0;
  let inFlight: Promise<PppoeProfileResult> | null = null;
  const copy = (value: PppoeProfileResult) => ({ ...value, profiles: value.profiles.map(row => ({ ...row })) });
  return async function getProfiles(): Promise<PppoeProfileResult> {
    if (inFlight) return copy(await inFlight);
    if (cached && now() < nextReadAt) return copy(cached);
    inFlight = Promise.resolve().then(async () => {
      try {
        const aggregate = await readPppoeAdminProfiles(deps);
        cached = { ...aggregate, status: 'fresh', lastSuccessAt: new Date(now()).toISOString(),
          message: aggregate.partial ? 'Lectura parcial: hay sesiones sin perfil local verificable.' : null };
      } catch {
        // No devolver errores RouterOS: pueden contener datos de usuarios o red.
        cached = cached?.lastSuccessAt ? { ...cached, status: 'stale', message: 'No se pudo actualizar desde el administrador. Se conserva la última lectura.' }
          : { status: 'unavailable', lastSuccessAt: null, partial: false,
            profiles: PPPOE_DASHBOARD_PROFILES.map(row => ({ ...row, registered: null, connected: null })),
            message: 'Sin datos: no se pudo leer el administrador CCR2116.' };
      }
      nextReadAt = now() + PPPOE_CACHE_TTL_MS;
      return cached;
    });
    try { return copy(await inFlight); } finally { inFlight = null; }
  };
}

export const getDashboardPppoeProfiles = createDashboardPppoeReader({
  findAdmins: async () => {
    const { data, error } = await supabaseAdmin.from('mikrotik_devices')
      .select('id,host,port,use_tls,username,password,device_role,is_active')
      .eq('is_active', true).eq('device_role', 'pppoe_admin').limit(2).abortSignal(AbortSignal.timeout(5_000));
    if (error) throw Error('ADMIN_LOOKUP_FAILED');
    return (data ?? []) as PppoeAdminDevice[];
  },
  read: (target, path) => mikrotikRequest(target, path, { method: 'GET', retries: 0, timeoutMs: 8_000 }),
});
