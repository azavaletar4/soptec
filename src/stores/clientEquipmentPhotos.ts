import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { compressImage } from '@/lib/imageCompression';
import type { ClientEquipmentPhoto, EquipmentPhotoType } from '@/types/domain';

const BUCKET = 'client-photos';
const SIGNED_URL_TTL = 3600;

export interface ClientEquipmentPhotoWithUrl extends ClientEquipmentPhoto {
  url: string | null;
}

/**
 * Galeria de fotos de serie/MAC por equipo (Fase 105) — a diferencia de
 * clientPhotos.ts (slot unico por categoria), esto es una lista real: un
 * contrato puede tener varias filas (modem + tv box + mesh...).
 */
export const useClientEquipmentPhotosStore = defineStore('clientEquipmentPhotos', () => {
  const loading = ref(false);

  async function fetchByContract(contractId: string): Promise<ClientEquipmentPhotoWithUrl[]> {
    loading.value = true;
    try {
      const { data, error } = await supabase
        .from('client_equipment_photos')
        .select('*')
        .eq('contract_id', contractId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as ClientEquipmentPhoto[];
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

  /** Admin/tecnico agrega una foto directo desde la Ficha del Cliente o el cierre de una instalacion — sin paso de aprobacion, el que la sube ya esta autorizando. */
  async function uploadDirect(
    clientId: string,
    contractId: string,
    equipmentType: EquipmentPhotoType,
    file: File,
    jobType?: 'ticket' | 'installation',
    jobId?: string,
  ): Promise<ClientEquipmentPhotoWithUrl> {
    const compressed = await compressImage(file);
    const ext = compressed.name.includes('.') ? compressed.name.split('.').pop() : 'jpg';
    const path = `${clientId}/${contractId}/equipment-${equipmentType}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, compressed, { upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from('client_equipment_photos')
      .insert({
        client_id: clientId,
        contract_id: contractId,
        equipment_type: equipmentType,
        storage_path: path,
        status: 'approved',
        job_type: jobType ?? null,
        job_id: jobId ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    return { ...(data as ClientEquipmentPhoto), url: signed?.signedUrl ?? null };
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    const { error } = await supabase.from('client_equipment_photos').delete().eq('id', photoId);
    if (error) throw error;
  }

  return { loading, fetchByContract, uploadDirect, deletePhoto };
});
