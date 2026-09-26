import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { ClientPhoto, ClientPhotoCategory } from '@/types/domain';

const BUCKET = 'client-photos';
const SIGNED_URL_TTL = 3600;

export interface ClientPhotoWithUrl extends ClientPhoto {
  url: string | null;
}

export const useClientPhotosStore = defineStore('clientPhotos', () => {
  const loading = ref(false);

  /** Fotos de UN servicio puntual (Fase 38) — cada linea tiene su propio slot por categoria. */
  async function fetchPhotos(contractId: string): Promise<ClientPhotoWithUrl[]> {
    loading.value = true;
    try {
      const { data, error } = await supabase.from('client_photos').select('*').eq('contract_id', contractId);
      if (error) throw error;
      const rows = (data ?? []) as ClientPhoto[];
      return await Promise.all(
        rows.map(async (row) => {
          const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_TTL);
          return { ...row, url: signed?.signedUrl ?? null };
        }),
      );
    } finally {
      loading.value = false;
    }
  }

  async function uploadPhoto(
    clientId: string,
    contractId: string,
    category: ClientPhotoCategory,
    file: File,
    previousPath?: string | null,
  ): Promise<ClientPhotoWithUrl> {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const path = `${clientId}/${contractId}/${category}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from('client_photos')
      .upsert({ client_id: clientId, contract_id: contractId, category, storage_path: path }, { onConflict: 'contract_id,category' })
      .select()
      .single();
    if (error) throw error;

    if (previousPath) {
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    return { ...(data as ClientPhoto), url: signed?.signedUrl ?? null };
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    const { error } = await supabase.from('client_photos').delete().eq('id', photoId);
    if (error) throw error;
  }

  return { loading, fetchPhotos, uploadPhoto, deletePhoto };
});
