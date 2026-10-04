import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { useClientPhotosStore } from '@/stores/clientPhotos';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import type { ClientPhotoCategory, InventoryUnit, WorkOrderPhoto } from '@/types/domain';

const WORK_EVIDENCE_BUCKET = 'work-evidence';
const SIGNED_URL_TTL = 3600;

export interface PendingPhotoWithUrl extends WorkOrderPhoto {
  url: string | null;
}

/**
 * Aprobacion de lo que un tecnico captura/registra en una averia ANTES de
 * que pase a ser la ficha oficial del cliente (Fase 95) — a diferencia de
 * una instalacion, que aplica todo de inmediato al cerrar.
 */
export const useTicketApprovalsStore = defineStore('ticketApprovals', () => {
  const clientPhotosStore = useClientPhotosStore();
  const inventoryUnitsStore = useInventoryUnitsStore();
  const loading = ref(false);

  async function fetchPendingPhotos(ticketId: string): Promise<PendingPhotoWithUrl[]> {
    loading.value = true;
    try {
      const { data, error } = await supabase
        .from('work_order_photos')
        .select('*')
        .eq('job_type', 'ticket')
        .eq('job_id', ticketId)
        .eq('status', 'pending_approval')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as WorkOrderPhoto[];
      return await Promise.all(
        rows.map(async (row) => {
          const { data: signed } = await supabase.storage.from(WORK_EVIDENCE_BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_TTL);
          return { ...row, url: signed?.signedUrl ?? null };
        }),
      );
    } finally {
      loading.value = false;
    }
  }

  /** Copia la foto de work-evidence a client-photos (reemplaza el slot de esa categoria/contrato) y marca 'approved'. */
  async function approvePhoto(photo: WorkOrderPhoto, clientId: string, contractId: string) {
    const { data: blob, error: downloadError } = await supabase.storage.from(WORK_EVIDENCE_BUCKET).download(photo.storage_path);
    if (downloadError || !blob) throw downloadError ?? new Error('No se pudo descargar la foto');
    const fileName = photo.storage_path.split('/').pop() ?? `${photo.category}.jpg`;
    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });

    await clientPhotosStore.uploadPhoto(clientId, contractId, photo.category as ClientPhotoCategory, file);

    const { error: statusErr } = await supabase.from('work_order_photos').update({ status: 'approved' }).eq('id', photo.id);
    if (statusErr) throw statusErr;
  }

  async function rejectPhoto(photo: WorkOrderPhoto) {
    const { error } = await supabase.from('work_order_photos').update({ status: 'rejected' }).eq('id', photo.id);
    if (error) throw error;
  }

  async function fetchPendingEquipment(ticketId: string): Promise<InventoryUnit[]> {
    const units = await inventoryUnitsStore.fetchUnitsByTicket(ticketId);
    return units.filter((u) => u.status === 'pending_approval');
  }

  function approveEquipment(unit: InventoryUnit) {
    return inventoryUnitsStore.approveUnit(unit);
  }

  function rejectEquipment(unit: InventoryUnit) {
    return inventoryUnitsStore.rejectUnit(unit.id, 'Rechazado por administracion al revisar la averia');
  }

  return { loading, fetchPendingPhotos, approvePhoto, rejectPhoto, fetchPendingEquipment, approveEquipment, rejectEquipment };
});
