import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Prospect, ProspectFollowup } from '@/types/domain';

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
    updateProspect,
    markConverted,
    fetchFollowups,
    addFollowup,
  };
});
