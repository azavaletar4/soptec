import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';

// Adaptado de REPLICA-TR069-GENIEACS.md seccion 8: sincroniza la lista de
// dispositivos de GenieACS hacia public.tr069_devices. Sin tenant_id
// (SmartRayco es single-tenant) — a diferencia de fosmikro, no hay que
// resolver tenant del usuario ni filtrar por el.
export const tr069SyncRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;

tr069SyncRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

interface GenieAcsParam {
  _value?: unknown;
}

function pick(param: GenieAcsParam | undefined): string | null {
  return param?._value !== undefined ? String(param._value) : null;
}

function wanIp(dev: Record<string, unknown>): string | null {
  const igd = dev?.InternetGatewayDevice as Record<string, unknown> | undefined;
  const wanDevices = (igd?.WANDevice ?? {}) as Record<string, unknown>;
  for (const wcd of Object.values(wanDevices) as Record<string, unknown>[]) {
    const wanConnDevices = (wcd?.WANConnectionDevice ?? {}) as Record<string, unknown>;
    for (const wip of Object.values(wanConnDevices) as Record<string, unknown>[]) {
      for (const conn of Object.values((wip?.WANPPPConnection ?? {}) as Record<string, unknown>)) {
        const ip = pick((conn as Record<string, unknown>)?.ExternalIPAddress as GenieAcsParam);
        if (ip) return ip;
      }
      for (const conn of Object.values((wip?.WANIPConnection ?? {}) as Record<string, unknown>)) {
        const ip = pick((conn as Record<string, unknown>)?.ExternalIPAddress as GenieAcsParam);
        if (ip) return ip;
      }
    }
  }
  return null;
}

function ssid(dev: Record<string, unknown>): string | null {
  const igd = dev?.InternetGatewayDevice as Record<string, unknown> | undefined;
  const lanDevices = (igd?.LANDevice ?? {}) as Record<string, unknown>;
  for (const lan of Object.values(lanDevices) as Record<string, unknown>[]) {
    for (const wlan of Object.values((lan?.WLANConfiguration ?? {}) as Record<string, unknown>)) {
      const s = pick((wlan as Record<string, unknown>)?.SSID as GenieAcsParam);
      if (s) return s;
    }
  }
  return null;
}

export type Tr069SyncResult =
  | { ok: true; synced: number; created: number; total: number }
  | { ok: false; error: string };

/**
 * Sincroniza la lista de dispositivos de GenieACS hacia tr069_devices.
 * Extraido de la ruta POST / para poder llamarlo tanto desde el panel
 * (boton "Sincronizar") como desde el scheduler automatico (ver
 * server/src/services/tr069Scheduler.ts).
 */
export async function syncTr069Devices(): Promise<Tr069SyncResult> {
  const NBI = process.env.GENIEACS_NBI || 'http://localhost:7557';

  try {
    const genieRes = await fetch(`${NBI}/devices`, { signal: AbortSignal.timeout(30_000) });
    if (!genieRes.ok) return { ok: false, error: 'GenieACS NBI no disponible' };
    const devices = (await genieRes.json()) as Record<string, unknown>[];

    const { data: existing } = await supabaseAdmin.from('tr069_devices').select('id, genieacs_id');
    const recMap = new Map((existing ?? []).map((r) => [r.genieacs_id as string, r.id as string]));

    let synced = 0;
    let created = 0;
    for (const dev of devices) {
      const genieacsId = dev._id as string;
      const info = ((dev.InternetGatewayDevice as Record<string, unknown>)?.DeviceInfo ?? {}) as Record<string, GenieAcsParam>;
      const cache = {
        last_seen_at: (dev._lastInform as string) ?? null,
        model_name: pick(info.ModelName) ?? pick(info.Manufacturer),
        firmware_version: pick(info.SoftwareVersion),
        wan_ip: wanIp(dev),
        ssid: ssid(dev),
      };

      const recId = recMap.get(genieacsId);
      if (recId) {
        await supabaseAdmin.from('tr069_devices').update(cache).eq('id', recId);
        synced += 1;
      } else {
        const parts = genieacsId.split('-');
        await supabaseAdmin.from('tr069_devices').insert({
          genieacs_id: genieacsId,
          cpe_oui: parts[0] ?? null,
          cpe_product_class: parts.length > 2 ? parts.slice(1, -1).join('-').replace(/%2D/gi, '-') : null,
          cpe_serial: pick(info.SerialNumber) ?? parts[parts.length - 1] ?? genieacsId,
          ...cache,
        });
        created += 1;
      }
    }

    return { ok: true, synced, created, total: devices.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al sincronizar' };
  }
}

tr069SyncRoutes.post('/', async (c) => {
  const result = await syncTr069Devices();
  return c.json(result, result.ok ? 200 : 502);
});
