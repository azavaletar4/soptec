import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Client, Prospect, ProspectFollowup } from '@/types/domain';

export interface ProspectConversionReceipt {
  prospect_id: string;
  client_id: string;
  contract_id: string;
  installation_id: string;
  initial_points: 0;
  replayed: boolean;
}
type ConversionClient = Pick<Client, 'document_type' | 'document_number' | 'first_name' | 'last_name' | 'phone' | 'phone_2' | 'email' | 'address' | 'status'>;

const PROSPECT_SELECT = '*, zones(id, name), plans(id, name)';

/** Fase 140 — Prospectos y seguimiento comercial. Estructuras separadas de
 *  clients/service_contracts (ver migracion); solo se vuelve cliente real al
 *  convertir desde ClientesView.vue. */
export const useProspectsStore = defineStore('prospects', () => {
  const prospects = ref<Prospect[]>([]);
  const loading = ref(false);

  async function fetchProspects() {
    loading.value = true;
    try {
      const { data, error } = await supabase.from('prospects').select(PROSPECT_SELECT).order('created_at', { ascending: false });
      if (error) throw error;
      prospects.value = (data ?? []) as unknown as Prospect[];
    } finally {
      loading.value = false;
    }
  }

  async function createProspect(payload: Partial<Prospect>) {
    const { data, error } = await supabase.from('prospects').insert(payload).select(PROSPECT_SELECT).single();
    if (error) throw error;
    const created = data as unknown as Prospect;
    prospects.value.unshift(created);
    return created;
  }

  /** Una sola transacción y recibo por Prospecto; nunca crear las tres filas desde el navegador. */
  async function convertToClient(prospectId: string, client: ConversionClient, referrerId: string | null = null) {
    const { data, error } = await supabase.rpc('convert_prospect_with_installation', {
      p_prospect_id: prospectId, p_client: client, p_referrer_id: referrerId,
    });
    if (error) throw error;
    const receipt = data as unknown as ProspectConversionReceipt;
    if (!receipt?.client_id || !receipt.contract_id || !receipt.installation_id || receipt.prospect_id !== prospectId || receipt.initial_points !== 0) {
      throw new Error('No se recibió el recibo de conversión. Reintenta el mismo Prospecto para recuperar su resultado.');
    }
    const existing = prospects.value.find(p => p.id === prospectId);
    if (existing) { existing.estado = 'convertido'; existing.converted_client_id = receipt.client_id; }
    return receipt;
  }

  async function updateProspect(id: string, payload: Partial<Prospect>) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('prospects')
      .update({ ...payload, updated_by: user?.id ?? null })
      .eq('id', id)
      .select(PROSPECT_SELECT)
      .single();
    if (error) throw error;
    const updated = data as unknown as Prospect;
    const idx = prospects.value.findIndex((p) => p.id === id);
    if (idx !== -1) prospects.value[idx] = updated;
    return updated;
  }

  /** Punto 8/9 del pedido: solo se llama DESPUES de confirmar que el cliente
   *  se creo correctamente — nunca antes. */
  async function markConverted(prospectId: string, clientId: string) {
    return updateProspect(prospectId, { estado: 'convertido', converted_client_id: clientId });
  }

  async function fetchFollowups(prospectId: string): Promise<ProspectFollowup[]> {
    const { data, error } = await supabase
      .from('prospect_followups')
      .select('*, profiles:author_id(id, full_name, email)')
      .eq('prospect_id', prospectId)
      .order('fecha', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as ProspectFollowup[];
  }

  async function addFollowup(prospectId: string, notas: string): Promise<ProspectFollowup> {
    const { data, error } = await supabase
      .from('prospect_followups')
      .insert({ prospect_id: prospectId, notas })
      .select('*, profiles:author_id(id, full_name, email)')
      .single();
    if (error) throw error;
    return data as unknown as ProspectFollowup;
  }

  return {
    prospects,
    loading,
    fetchProspects,
    createProspect,
    convertToClient,
    updateProspect,
    markConverted,
    fetchFollowups,
    addFollowup,
  };
});
