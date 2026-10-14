/**
 * Fase 5 OLT — Centro de monitoreo visual, pestaña "Estado actual" (ver
 * ESTADO_DESARROLLO.md 13aw/13ax). Pura presentación/agregación sobre datos
 * YA cargados en el panel (`oltStore.onts`, Fase B; `summary`, ya existente)
 * — sin consulta, tabla ni endpoint nuevo.
 *
 * Mismo criterio de vínculo verificado que Fase B/13as/13au: una ONT solo
 * cuenta como vinculada a un cliente cuando `client_id` Y `contract_id`
 * existen Y el contrato fue efectivamente resuelto (`service_contracts`
 * embebido) — nunca por nombre/descripción/posición física. Una ONT sin
 * ese vínculo verificable es "sin vincular", independientemente de su
 * `status`/`admin_state` — nunca se cuenta como "cliente desconectado" ni
 * como "suspendido".
 *
 * 13ax — caso real (Danner Ávalos Ventura, CTR-2026-00356, 2026-10-14):
 * una ONU con `admin_state='disable'` (suspendida/cortada, igual que
 * reporta SmartOLT como "admin-disabled mode") también queda con
 * `status='offline'` — sin esta distinción, se contaba y listaba igual que
 * una caída real. `admin_state` SIEMPRE tiene prioridad sobre `status`: una
 * ONU deshabilitada nunca es "conectada" ni "desconectada", es
 * "suspendida", sin importar qué `status` haya quedado (incluso uno viejo
 * de antes de deshabilitarla).
 */

export interface ConnectionStatusOnt {
  id: string;
  serial: string;
  description: string | null;
  slot: number;
  port: number;
  ont_id: number;
  status: 'online' | 'offline' | 'unknown';
  admin_state: 'enable' | 'disable';
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

type LinkedBucket = 'online' | 'offline' | 'unknown' | 'suspended';

/** `admin_state='disable'` manda SIEMPRE, antes de mirar `status` — ver nota 13ax arriba. */
function classifyLinked(o: ConnectionStatusOnt): LinkedBucket {
  if (o.admin_state === 'disable') return 'suspended';
  if (o.status === 'online') return 'online';
  if (o.status === 'offline') return 'offline';
  return 'unknown';
}

export interface ConnectionStatusCounts {
  /** Vinculados (cliente+contrato verificados), online y NO suspendidos. */
  linkedOnline: number;
  /** Vinculados, offline y NO suspendidos — estos son los "clientes sin conexión" reales. */
  linkedOffline: number;
  /** Vinculados pero sin un status confiable todavía (nunca se cuenta como "sin conexión"). */
  linkedUnknown: number;
  /** Vinculados y con `admin_state='disable'` — suspendidos/cortados administrativamente, nunca mezclados con "sin conexión" ni con "conectados". */
  linkedSuspended: number;
  /** Sin vínculo verificable (migración SmartOLT u otro) — por separado, nunca mezclado con ningún otro conteo. */
  unlinked: number;
}

/** Cada ONT cae en EXACTAMENTE un conteo — nunca dos a la vez (ver pruebas de "ausencia de doble conteo"). */
export function computeConnectionStatusCounts(onts: readonly ConnectionStatusOnt[]): ConnectionStatusCounts {
  let linkedOnline = 0;
  let linkedOffline = 0;
  let linkedUnknown = 0;
  let linkedSuspended = 0;
  let unlinked = 0;
  for (const o of onts) {
    if (!isLinked(o)) {
      unlinked++;
      continue;
    }
    switch (classifyLinked(o)) {
      case 'suspended':
        linkedSuspended++;
        break;
      case 'online':
        linkedOnline++;
        break;
      case 'offline':
        linkedOffline++;
        break;
      default:
        linkedUnknown++;
    }
  }
  return { linkedOnline, linkedOffline, linkedUnknown, linkedSuspended, unlinked };
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

/** Misma forma que `DisconnectedClientEntry` — lista separada, nunca el mismo listado. */
export type SuspendedClientEntry = DisconnectedClientEntry;

function buildLinkedClientEntry(o: ConnectionStatusOnt): DisconnectedClientEntry {
  const contract = o.service_contracts!;
  return {
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
  };
}

/** Solo ONTs vinculadas (verificado), offline y NO suspendidas — nunca una sin vínculo, nunca una suspendida, nunca una en estado desconocido. */
export function listDisconnectedLinkedClients(onts: readonly ConnectionStatusOnt[]): DisconnectedClientEntry[] {
  const out: DisconnectedClientEntry[] = [];
  for (const o of onts) {
    if (!isLinked(o) || classifyLinked(o) !== 'offline') continue;
    out.push(buildLinkedClientEntry(o));
  }
  return out.sort((a, b) => a.client.name.localeCompare(b.client.name));
}

/** Solo ONTs vinculadas (verificado) y suspendidas (`admin_state='disable'`) — nunca una sin vínculo, nunca aparece también en `listDisconnectedLinkedClients`. */
export function listSuspendedLinkedClients(onts: readonly ConnectionStatusOnt[]): SuspendedClientEntry[] {
  const out: SuspendedClientEntry[] = [];
  for (const o of onts) {
    if (!isLinked(o) || classifyLinked(o) !== 'suspended') continue;
    out.push(buildLinkedClientEntry(o));
  }
  return out.sort((a, b) => a.client.name.localeCompare(b.client.name));
}

/**
 * Motivo de suspensión — SOLO "Por deuda / mora" si hay evidencia confiable
 * (el cruce ya existente con `service_contracts.debt_hold_status='suspended'`,
 * ver `GET /:id/onts/disabled` y `reason` en `oltStore.fetchDisabledOnts`,
 * reutilizado sin cambios). `admin_state='disable'` por sí solo NUNCA
 * alcanza para decir "deuda" — caso real verificado (Danner Ávalos
 * Ventura, 13ax): admin-disabled con `debt_hold_status='none'`, es decir
 * sin evidencia de mora en el propio sistema. Ante cualquier duda (reason
 * ausente, aún no cargó, o es 'manual'), el texto es el genérico.
 */
export type SuspensionReason = 'manual' | 'billing' | 'both';
export function suspensionReasonLabel(reason: SuspensionReason | null | undefined): string {
  if (reason === 'billing' || reason === 'both') return 'Suspendido — por deuda / mora';
  return 'Suspendido administrativamente';
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
