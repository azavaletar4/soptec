import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { InfraElemento, InfraElementoTipo } from '@/types/domain';

const BUCKET = 'infra-photos';
const SIGNED_URL_TTL = 3600;

export interface InfraElementoWithUrl extends InfraElemento {
  photoUrl: string | null;
}

async function withPhotoUrl(row: InfraElemento): Promise<InfraElementoWithUrl> {
  if (!row.photo_path) return { ...row, photoUrl: null };
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(row.photo_path, SIGNED_URL_TTL);
  return { ...row, photoUrl: data?.signedUrl ?? null };
}

export const useInfraElementosStore = defineStore('infraElementos', () => {
  const elementos = ref<InfraElementoWithUrl[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchElementos() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase.from('infra_elementos').select('*').order('name');
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    elementos.value = await Promise.all(((data ?? []) as InfraElemento[]).map(withPhotoUrl));
  }

  async function createElemento(payload: {
    name: string;
    tipo: InfraElementoTipo;
    potencia?: string | null;
    spliteo?: string | null;
    is_active?: boolean;
    latitude: number;
    longitude: number;
    notes?: string | null;
  }) {
    const { data, error: err } = await supabase.from('infra_elementos').insert(payload).select().single();
    if (err) throw err;
    const withUrl = await withPhotoUrl(data as InfraElemento);
    elementos.value.push(withUrl);
    return withUrl;
  }

  async function updateElemento(id: string, payload: Partial<InfraElemento>) {
    const { data, error: err } = await supabase.from('infra_elementos').update(payload).eq('id', id).select().single();
    if (err) throw err;
    const withUrl = await withPhotoUrl(data as InfraElemento);
    const idx = elementos.value.findIndex((e) => e.id === id);
    if (idx !== -1) elementos.value[idx] = withUrl;
    return withUrl;
  }

  /** Guarda coordenadas — usado por el drag&drop del mapa, sin boton de guardar. */
  function updateCoords(id: string, latitude: number, longitude: number) {
    return updateElemento(id, { latitude, longitude });
  }

  async function deleteElemento(id: string) {
    const existing = elementos.value.find((e) => e.id === id);
    if (existing?.photo_path) await supabase.storage.from(BUCKET).remove([existing.photo_path]);
    const { error: err } = await supabase.from('infra_elementos').delete().eq('id', id);
    if (err) throw err;
    elementos.value = elementos.value.filter((e) => e.id !== id);
  }

  async function uploadPhoto(id: string, file: File, previousPath?: string | null) {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const path = `${id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;

    const updated = await updateElemento(id, { photo_path: path });
    if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]);
    return updated;
  }

  return {
    elementos,
    loading,
    error,
    fetchElementos,
    createElemento,
    updateElemento,
    updateCoords,
    deleteElemento,
    uploadPhoto,
  };
});
