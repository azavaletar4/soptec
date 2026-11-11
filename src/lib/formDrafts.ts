import { get, set, del } from 'idb-keyval';
import { campoStore } from '@/lib/campoDatabase';

/**
 * Borradores locales del formulario de cierre de trabajo (App de Campo):
 * Android mata el proceso cuando la app pasa a 2do plano (ej. el tecnico
 * abre WhatsApp o la camara nativa a mitad de un cierre) y se perdia todo lo
 * avanzado. Se guarda en IndexedDB (no localStorage, que no soporta
 * Blobs/Files y tiene un limite de ~5MB) indexado por job, igual que la cola
 * offline de cierres (ver offlineQueue.ts) — pero en su propio object store,
 * porque un borrador no es un cierre ya enviado.
 */
const store = campoStore('drafts');

export async function saveDraft<T>(key: string, data: T): Promise<void> {
  await set(key, { data, savedAt: Date.now() }, store);
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  const entry = await get<{ data: T; savedAt: number }>(key, store);
  return entry?.data ?? null;
}

export async function clearDraft(key: string, savedBefore?: number): Promise<void> {
  if (savedBefore === undefined) { await del(key, store); return; }
  await store('readwrite', objectStore => new Promise<void>((resolve, reject) => {
    const request = objectStore.get(key), transaction = objectStore.transaction;
    request.onsuccess = () => {
      if (request.result && request.result.savedAt < savedBefore) objectStore.delete(key);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  }));
}
