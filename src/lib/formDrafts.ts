import { createStore, get, set, del } from 'idb-keyval';

/**
 * Borradores locales del formulario de cierre de trabajo (App de Campo):
 * Android mata el proceso cuando la app pasa a 2do plano (ej. el tecnico
 * abre WhatsApp o la camara nativa a mitad de un cierre) y se perdia todo lo
 * avanzado. Se guarda en IndexedDB (no localStorage, que no soporta
 * Blobs/Files y tiene un limite de ~5MB) indexado por job, igual que la cola
 * offline de cierres (ver offlineQueue.ts) — pero en su propio object store,
 * porque un borrador no es un cierre ya enviado.
 */
const store = createStore('smartrayco-campo', 'drafts');

export async function saveDraft<T>(key: string, data: T): Promise<void> {
  await set(key, { data, savedAt: Date.now() }, store);
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  const entry = await get<{ data: T; savedAt: number }>(key, store);
  return entry?.data ?? null;
}

export async function clearDraft(key: string): Promise<void> {
  await del(key, store);
}
