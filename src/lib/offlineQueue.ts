import { get, set, del, keys } from 'idb-keyval';
import { campoStore } from '@/lib/campoDatabase';
import { withClosureLock } from '@/lib/closureSubmission';
import { getErrorMessage } from '@/lib/errors';
import { WorkOrderFinalError, FINAL_ORDER_MESSAGE } from '@/lib/workOrderFinality';
import type { EquipmentPhotoType, JobType } from '@/types/domain';

/**
 * Cola de cierres de trabajo pendientes de sincronizar cuando el tecnico
 * recupera señal en campo. Se guarda en IndexedDB (no localStorage) porque
 * incluye Blobs de fotos y firma — localStorage no soporta binarios y tiene
 * un limite de ~5MB, insuficiente para un par de fotos.
 */
export interface QueuedPhoto {
  category: string;
  blob: Blob;
  fileName: string;
}

/** Fase 105 — fotos de serie de equipos en cola offline. */
export interface QueuedEquipmentPhoto {
  equipmentType: EquipmentPhotoType;
  blob: Blob;
  fileName: string;
}

export interface QueuedClosure {
  actorId?: string | null;
  closureOperationId?: string;
  localId: string;
  createdAt: number;
  jobType: JobType;
  jobId: string;
  /** Null en una rutina sin cliente puntual (Fase 101). */
  clientId: string | null;
  contractId: string | null;
  targetStatus: string;
  latitude: number | null;
  longitude: number | null;
  ontSerial: string | null;
  closureNotes: string | null;
  photos: QueuedPhoto[];
  equipmentPhotos: QueuedEquipmentPhoto[];
  signatureBlob: Blob | null;
  clientPhotoCategories: string[]; // categorias que ademas deben reflejarse en client_photos (instalaciones)
  /** Fase 95 — categorias del censo fotografico de una averia que quedan 'pending_approval' (no se aplican a client_photos hasta que un admin las apruebe). */
  pendingApprovalCategories: string[];
  motivoAveria: string | null; // Fase 49 — solo aplica a tickets, no a instalaciones
  motivoAveriaDetalle: string | null; // Fase 103 — texto libre cuando motivoAveria = 'other'
  justificacionCierre: string | null;
  /** Lectura manual de potencia optica (dBm) si la averia exigio recablear (Fase 95) — solo tickets. */
  potenciaDbm: number | null;
  /** Caja NAP — cambio de puerto opcional en tickets (Fase 95) u obligatoria al completar una instalación. */
  napElementoId: string | null;
  /** Zona/Sector de la Planta Externa, obligatoria al completar una instalación — se guarda en el contrato. */
  zoneId: string | null;
  /** Fase 159 — Rutina de traslado: "ONT reemplazada" (omite la sincronizacion automatica de zona de la ONT en la OLT). false en el resto de cierres. */
  ontReplaced: boolean;
  /** Fase 159 — Rutina de traslado: direccion NUEVA confirmada (reusa service_contracts.installation_address). Null en el resto de cierres. */
  installationAddress: string | null;
  /** Código de cliente / cintillo Drop (reusa service_contracts.client_code, Fase 39) — obligatorio al completar una instalación, opcional en tickets. */
  clientCode: string | null;
  /** Opcional para conservar colas anteriores; el servidor nunca deduce modalidad. */
  iptvInstallationMode?: import('@/lib/installationIptv').IptvInstallationMode | null;
  lastError?: string;
  /**
   * true SOLO cuando el ultimo intento fallo porque la orden ya tiene un
   * cierre administrativo definitivo (WorkOrderFinalError) — nunca por un
   * fallo transitorio (red, sesion, 5xx). Un envio en este estado ya no se
   * reintenta solo (ver flushQueue); el tecnico/administrador debe revisar
   * el contenido guardado y descartarlo explicitamente (discardFinalRejection).
   */
  rejectedFinal?: boolean;
}

const store = campoStore('closures');

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

export async function enqueueClosure(item: Omit<QueuedClosure, 'localId' | 'createdAt'>): Promise<QueuedClosure> {
  const queued: QueuedClosure = {
    ...item,
    localId: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  if (queued.jobType === 'installation' && !queued.closureOperationId) queued.closureOperationId = queued.localId;
  await set(queued.localId, queued, store);
  return queued;
}

export async function listQueuedClosures(): Promise<QueuedClosure[]> {
  const ids = await keys(store);
  const items = await Promise.all(ids.map((id) => get<QueuedClosure>(id, store)));
  return items.filter((i): i is QueuedClosure => !!i).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeQueuedClosure(localId: string) {
  await del(localId, store);
}

/** Un fallo transitorio (red, sesion, validacion) no marca `rejectedFinal` — se reintenta en el proximo flushQueue. */
export async function markQueuedError(item: QueuedClosure, message: string, rejectedFinal = false) {
  await changeQueued(item.localId, current => ({ ...current, lastError: message, rejectedFinal }));
}

/** true solo para WorkOrderFinalError (cierre administrativo definitivo) — nunca para red/sesion/validacion. */
export function isDefinitiveRejection(e: unknown): boolean {
  return e instanceof WorkOrderFinalError || (e instanceof Error && e.message === FINAL_ORDER_MESSAGE);
}

/**
 * Descarta explicitamente un envio con rechazo DEFINITIVO ya revisado (nunca
 * uno transitorio: la guarda de abajo lo impide incluso si se llama por error
 * o con datos viejos). El tecnico/administrador debe haber visto el
 * contenido (fotos/notas) antes de llamar esto — ver ClosureQueuePanel.vue.
 */
export async function discardFinalRejection(id: string, actorId?: string | null) {
  return withClosureLock('queue', async () => {
    const item = await get<QueuedClosure>(id, store);
    if (!item) return;
    if (item.actorId && item.actorId !== actorId) throw new Error('Este pendiente no corresponde a tu sesión.');
    if (!item.rejectedFinal) throw new Error('Solo puede descartarse un cierre con rechazo administrativo definitivo confirmado.');
    await del(id, store);
  });
}

function changeQueued(id: string, change: (current: QueuedClosure) => QueuedClosure): Promise<void> {
  return store('readwrite', objectStore => new Promise<void>((resolve, reject) => {
    const transaction = objectStore.transaction, request = objectStore.get(id);
    request.onsuccess = () => {
      try { if (request.result) objectStore.put(change(request.result), id); }
      catch (error) { transaction.abort(); reject(error); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el pendiente.'));
  }));
}

/** Corrección explícita de modalidad: conserva el resto del envío y sus Blobs. */
export async function setQueuedIptvMode(id: string, mode: import('@/lib/installationIptv').IptvInstallationMode, actorId?: string | null) {
  if (!['smart_tv_app','customer_device','rayco_tv_box'].includes(mode)) throw new Error('Modalidad IPTV inválida.');
  await withClosureLock('queue', () => changeQueued(id, item => {
    if (item.jobType !== 'installation' || (item.actorId && item.actorId !== actorId)) throw new Error('Este pendiente no corresponde a tu sesión.');
    return { ...item, iptvInstallationMode: mode, lastError: undefined };
  }));
}

function pauseAll(error: unknown) {
  const e = error as { code?: string; status?: number; name?: string; message?: string };
  return !isOnline() || e?.status === 401 || ['PGRST301','PGRST302'].includes(e?.code ?? '') ||
    e?.name === 'AbortError' || /failed to fetch|fetch failed|networkerror|network request failed|jwt expired/i.test(e?.message ?? '');
}

/**
 * Reintenta todos los cierres pendientes con la funcion de envio real
 * (inyectada para evitar un ciclo de importacion con el store de Pinia).
 * Un fallo retiene ese envío y bloquea solo las intenciones posteriores de
 * la MISMA orden. Red/sesión fallidas detienen el lote; otras órdenes siguen.
 */
export async function flushQueue(submit: (item: QueuedClosure) => Promise<void>, actorId?: string | null) {
  return withClosureLock('queue', async () => {
  if (!isOnline()) return { synced: 0, remaining: (await listQueuedClosures()).length };
  const pending = await listQueuedClosures();
  const blocked = new Set<string>();
  let synced = 0;
  for (const item of pending) {
    const job = item.jobType + ':' + item.jobId;
    if (blocked.has(job)) continue;
    if (item.actorId && item.actorId !== actorId) { blocked.add(job); continue; }
    // Rechazo definitivo ya confirmado en un intento anterior: reenviarlo
    // nunca va a funcionar (la orden ya tiene cierre administrativo). No
    // perder tiempo/datos reintentandolo solo — queda a la espera de que el
    // tecnico/administrador revise su contenido y lo descarte (ClosureQueuePanel).
    if (item.rejectedFinal) { blocked.add(job); continue; }
    try {
      await submit(item);
      await removeQueuedClosure(item.localId);
      synced++;
    } catch (e) {
      const final = isDefinitiveRejection(e);
      await markQueuedError(item, getErrorMessage(e, 'Error al sincronizar'), final);
      blocked.add(job);
      if (!final && pauseAll(e)) break;
    }
  }
  return { synced, remaining: (await listQueuedClosures()).length };
  });
}
