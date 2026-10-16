import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { useClientPhotosStore } from '@/stores/clientPhotos';
import { useClientEquipmentPhotosStore } from '@/stores/clientEquipmentPhotos';
import { useAuthStore } from '@/stores/auth';
import { readOrderInventory } from '@/lib/orderInventory';
import { executeFieldInventory, pendingFieldInventory } from '@/lib/fieldInventoryOperation';
import type { FieldInventoryContext } from '@/types/fieldInventory';
import type { ClientPhotoCategory, EquipmentPhotoType, InventoryUnit, JobType, WorkOrderPhoto } from '@/types/domain';

const WORK_EVIDENCE_BUCKET = 'work-evidence';
const SIGNED_URL_TTL = 3600;

export interface PendingPhotoWithUrl extends WorkOrderPhoto {
  url: string | null;
}

/** 'equipment_sticker__modem' -> 'modem' (Fase 105) — ver campoStore.performClosureSubmit, donde se arma este prefijo. */
const EQUIPMENT_CATEGORY_PREFIX = 'equipment_sticker__';
const EQUIPMENT_TYPES = ['modem', 'tv_box', 'mesh', 'otro'] as const;
export function parseEquipmentType(category: string): EquipmentPhotoType | null {
  if (!category.startsWith(EQUIPMENT_CATEGORY_PREFIX)) return null;
  const suffix = category.slice(EQUIPMENT_CATEGORY_PREFIX.length);
  return (EQUIPMENT_TYPES as readonly string[]).includes(suffix) ? (suffix as EquipmentPhotoType) : null;
}

/**
 * Aprobacion de lo que un tecnico captura/registra en una averia ANTES de
 * que pase a ser la ficha oficial del cliente (Fase 95) — a diferencia de
 * una instalacion, que aplica todo de inmediato al cerrar.
 */
export const useTicketApprovalsStore = defineStore('ticketApprovals', () => {
  const clientPhotosStore = useClientPhotosStore();
  const clientEquipmentPhotosStore = useClientEquipmentPhotosStore();
  const auth = useAuthStore();
  const reviewEpoch = ref(0);
  const reviewNamespace = 'office-ticket-inventory:v1';
  function actor() {
    if (!auth.user) throw Object.assign(new Error('Inicia sesion nuevamente.'), { status: 401 });
    return auth.user.id;
  }
  function reviewContext(ticketId: string): FieldInventoryContext {
    return { actorId: actor(), jobType: 'ticket', jobId: ticketId, clientId: null, contractId: null };
  }
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

  /** Todas las fotos de una orden (ticket/instalacion/rutina) ya subidas, sin importar su status
   *  (menos las rechazadas) — usado por el acceso rapido a evidencias del Historico de Atendidos,
   *  a diferencia de fetchPendingPhotos que es solo el censo pendiente de aprobar de una averia. */
  async function fetchJobPhotos(jobType: JobType, jobId: string): Promise<PendingPhotoWithUrl[]> {
    const { data, error } = await supabase
      .from('work_order_photos')
      .select('*')
      .eq('job_type', jobType)
      .eq('job_id', jobId)
      .neq('status', 'rejected')
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as WorkOrderPhoto[];
    return await Promise.all(
      rows.map(async (row) => {
        const { data: signed } = await supabase.storage.from(WORK_EVIDENCE_BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_TTL);
        return { ...row, url: signed?.signedUrl ?? null };
      }),
    );
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

  /** Igual que approvePhoto, pero para una foto de serie de equipo (Fase 105) — en vez de
   *  upsertear el slot unico de client_photos, inserta una fila mas en la galeria
   *  client_equipment_photos (nunca reemplaza, un contrato puede tener varias). */
  async function approveEquipmentPhoto(photo: WorkOrderPhoto, clientId: string, contractId: string) {
    const equipmentType = parseEquipmentType(photo.category);
    if (!equipmentType) throw new Error(`Categoria de equipo invalida: ${photo.category}`);

    const { data: blob, error: downloadError } = await supabase.storage.from(WORK_EVIDENCE_BUCKET).download(photo.storage_path);
    if (downloadError || !blob) throw downloadError ?? new Error('No se pudo descargar la foto');
    const fileName = photo.storage_path.split('/').pop() ?? `${photo.category}.jpg`;
    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });

    await clientEquipmentPhotosStore.uploadDirect(clientId, contractId, equipmentType, file, 'ticket', photo.job_id);

    const { error: statusErr } = await supabase.from('work_order_photos').update({ status: 'approved' }).eq('id', photo.id);
    if (statusErr) throw statusErr;
  }

  async function rejectPhoto(photo: WorkOrderPhoto) {
    const { error } = await supabase.from('work_order_photos').update({ status: 'rejected' }).eq('id', photo.id);
    if (error) throw error;
  }

  async function fetchPendingEquipment(ticketId: string): Promise<InventoryUnit[]> {
    const id = actor();
    return (await readOrderInventory<InventoryUnit>(supabase, id, 'ticket', ticketId, 'pending', () => auth.user?.id === id)).items;
  }

  async function review(ticketId: string, action: 'approve' | 'reject', unitId: string) {
    const id = actor();
    const { context } = await readOrderInventory(supabase, id, 'ticket', ticketId, 'pending', () => auth.user?.id === id);
    try {
      return await executeFieldInventory(localStorage, context, action, { unitId },
        async request => await supabase.rpc('inventory_ticket_review', request), () => crypto.randomUUID(), reviewNamespace);
    } finally { reviewEpoch.value++; }
  }
  function approveEquipment(unit: InventoryUnit) {
    if (!unit.ticket_id) throw Error('El equipo no tiene averia vinculada.');
    return review(unit.ticket_id, 'approve', unit.id);
  }
  function rejectEquipment(unit: InventoryUnit) {
    if (!unit.ticket_id) throw Error('El equipo no tiene averia vinculada.');
    return review(unit.ticket_id, 'reject', unit.id);
  }
  function pendingEquipmentReview(ticketId: string) {
    void reviewEpoch.value;
    return auth.user ? pendingFieldInventory(localStorage, reviewContext(ticketId), reviewNamespace) : null;
  }
  function retryEquipmentReview(ticketId: string) {
    const request = pendingEquipmentReview(ticketId);
    if (!request || !['approve', 'reject'].includes(request.p_action) || typeof request.p_payload.unitId !== 'string') throw Error('No hay revision pendiente valida.');
    return review(ticketId, request.p_action as 'approve' | 'reject', request.p_payload.unitId);
  }

  return {
    loading,
    fetchPendingPhotos,
    fetchJobPhotos,
    approvePhoto,
    approveEquipmentPhoto,
    rejectPhoto,
    fetchPendingEquipment,
    approveEquipment,
    rejectEquipment,
    pendingEquipmentReview,
    retryEquipmentReview,
  };
});
