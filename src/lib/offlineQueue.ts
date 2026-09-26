import { createStore, get, set, del, keys } from 'idb-keyval';
import type { JobType } from '@/types/domain';

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

export interface QueuedClosure {
  localId: string;
  createdAt: number;
  jobType: JobType;
  jobId: string;
  clientId: string;
  contractId: string | null;
  targetStatus: string;
  latitude: number | null;
  longitude: number | null;
  ontSerial: string | null;
  closureNotes: string | null;
  photos: QueuedPhoto[];
  signatureBlob: Blob | null;
  clientPhotoCategories: string[]; // categorias que ademas deben reflejarse en client_photos (instalaciones)
  lastError?: string;
}

const store = createStore('smartrayco-campo', 'closures');

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

export async function enqueueClosure(item: Omit<QueuedClosure, 'localId' | 'createdAt'>): Promise<QueuedClosure> {
  const queued: QueuedClosure = {
    ...item,
    localId: crypto.randomUUID(),
    createdAt: Date.now(),
  };
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

export async function markQueuedError(item: QueuedClosure, message: string) {
  await set(item.localId, { ...item, lastError: message }, store);
}

/**
 * Reintenta todos los cierres pendientes con la funcion de envio real
 * (inyectada para evitar un ciclo de importacion con el store de Pinia).
 * Se detiene ante el primer fallo de un item para no perder el orden ni
 * generar reintentos en cascada contra un backend que sigue caido.
 */
export async function flushQueue(submit: (item: QueuedClosure) => Promise<void>) {
  if (!isOnline()) return { synced: 0, remaining: (await listQueuedClosures()).length };
  const pending = await listQueuedClosures();
  let synced = 0;
  for (const item of pending) {
    try {
      await submit(item);
      await removeQueuedClosure(item.localId);
      synced++;
    } catch (e) {
      await markQueuedError(item, e instanceof Error ? e.message : 'Error al sincronizar');
      break;
    }
  }
  return { synced, remaining: (await listQueuedClosures()).length };
}
