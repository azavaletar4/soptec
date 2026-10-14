/**
 * Fase 5 OLT — Centro de monitoreo visual, pestaña "Estado actual" (ver
 * ESTADO_DESARROLLO.md 13aw). Pura presentación/agregación sobre datos YA
 * cargados en el panel (`oltStore.onts`, Fase B; `summary`, ya existente)
 * — sin consulta, tabla ni endpoint nuevo.
 *
 * Mismo criterio de vínculo verificado que Fase B/13as/13au: una ONT solo
 * cuenta como vinculada a un cliente cuando `client_id` Y `contract_id`
 * existen Y el contrato fue efectivamente resuelto (`service_contracts`
 * embebido) — nunca por nombre/descripción/posición física. Una ONT sin
 * ese vínculo verificable es "sin vincular", independientemente de su
 * `status` — nunca se cuenta como "cliente desconectado".
 */

export interface ConnectionStatusOnt {
  id: string;
  serial: string;
  description: string | null;
  slot: number;
  port: number;
  ont_id: number;
  status: 'online' | 'offline' | 'unknown';
  client_id: string | null;
  contract_id?: string | null;
  clients?: { id: string; first_name: string; last_name: string } | null;
  service_contracts?: {
    id: string;
    contract_number: string | null;
    client_code: string | null;
    zones?: { id: string; name: string } | null;
  } | null;
}

function isLinked(o: ConnectionStatusOnt): boolean {
  return Boolean(o.client_id) && Boolean(o.contract_id) && Boolean(o.service_contracts);
}

export interface ConnectionStatusCounts {
  /** Vinculados (cliente+contrato verificados) y online. */
  linkedOnline: number;
  /** Vinculados y offline — estos son los "clientes sin conexión". */
  linkedOffline: number;
  /** Vinculados pero sin un status confiable todavía (nunca se cuenta como "sin conexión"). */
  linkedUnknown: number;
  /** Sin vínculo verificable (migración SmartOLT u otro) — por separado, nunca mezclado con "sin conexión". */
  unlinked: number;
}

export function computeConnectionStatusCounts(onts: readonly ConnectionStatusOnt[]): ConnectionStatusCounts {
  let linkedOnline = 0;
  let linkedOffline = 0;
  let linkedUnknown = 0;
  let unlinked = 0;
  for (const o of onts) {
    if (!isLinked(o)) {
      unlinked++;
      continue;
    }
    if (o.status === 'online') linkedOnline++;
    else if (o.status === 'offline') linkedOffline++;
    else linkedUnknown++;
  }
  return { linkedOnline, linkedOffline, linkedUnknown, unlinked };
}

export interface DisconnectedClientEntry {
  ontDbId: string;
  client: { id: string; name: string };
  contract: { id: string; contractNumber: string | null; clientCode: string | null };
  zoneId: string | null;
  zoneName: string | null;
  serial: string;
  description: string | null;
  slot: number;
  port: number;
  ontId: number;
}

/** Solo ONTs vinculadas (verificado) y offline — nunca una sin vínculo, nunca una en estado desconocido. */
export function listDisconnectedLinkedClients(onts: readonly ConnectionStatusOnt[]): DisconnectedClientEntry[] {
  const out: DisconnectedClientEntry[] = [];
  for (const o of onts) {
    if (!isLinked(o) || o.status !== 'offline') continue;
    const contract = o.service_contracts!;
    out.push({
      ontDbId: o.id,
      client: { id: o.clients!.id, name: `${o.clients!.first_name} ${o.clients!.last_name}`.trim() },
      contract: { id: contract.id, contractNumber: contract.contract_number, clientCode: contract.client_code },
      zoneId: contract.zones?.id ?? null,
      zoneName: contract.zones?.name ?? null,
      serial: o.serial,
      description: o.description,
      slot: o.slot,
      port: o.port,
      ontId: o.ont_id,
    });
  }
  return out.sort((a, b) => a.client.name.localeCompare(b.client.name));
}

/** Filtro simple por zona (id exacto) y búsqueda de texto por nombre de cliente — sobre datos ya resueltos, sin consulta nueva. */
export function filterDisconnectedClients(
  entries: readonly DisconnectedClientEntry[],
  filters: { zoneId?: string | null; search?: string },
): readonly DisconnectedClientEntry[] {
  let result = entries;
  if (filters.zoneId) result = result.filter((e) => e.zoneId === filters.zoneId);
  const q = filters.search?.trim().toLowerCase();
  if (q) result = result.filter((e) => e.client.name.toLowerCase().includes(q));
  return result;
}

export interface SyncFreshnessSource {
  checkedAt: string | null;
  scanComplete: boolean;
}

export interface SyncFreshness {
  checkedAtIso: string | null;
  minutesAgo: number | null;
  /** false = el último intento de sincronización no pudo leer la OLT por completo (ver scanComplete en oltSyncService.ts) — los datos mostrados son del último escaneo que SÍ se completó, no se inventa uno nuevo. */
  scanComplete: boolean;
  /** true = pasó más tiempo del esperado desde la última sincronización (ver staleAfterMinutes). */
  stale: boolean;
}

/**
 * "Última sincronización válida" + aviso de datos desactualizados
 * (requisito explícito). `summary.checkedAt` se actualiza en CADA intento
 * (éxito o no, ver `olt_sync_cache`/`oltSyncService.ts`) — por eso nunca se
 * inventa un "último éxito" aparte: se muestra el último intento real, y
 * se avisa por separado si ese intento no completó el escaneo
 * (`scanComplete=false`) o si ya pasó demasiado tiempo.
 */
export function evaluateSyncFreshness(
  summary: SyncFreshnessSource | null,
  nowMs: number,
  staleAfterMinutes = 60,
): SyncFreshness {
  if (!summary || !summary.checkedAt) {
    return { checkedAtIso: null, minutesAgo: null, scanComplete: false, stale: true };
  }
  const minutesAgo = Math.floor((nowMs - new Date(summary.checkedAt).getTime()) / 60000);
  return {
    checkedAtIso: summary.checkedAt,
    minutesAgo,
    scanComplete: summary.scanComplete,
    stale: minutesAgo > staleAfterMinutes,
  };
}
