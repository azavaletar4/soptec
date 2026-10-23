import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Client } from '@/types/domain';
import { CLIENT_LIFECYCLE_SELECT, readAllClientPages, type ClientLifecycle } from '@/lib/clientLifecycle';

export type ClientWithLifecycle = Client & ClientLifecycle;

export const useClientsStore = defineStore('clients', () => {
  const clients = ref<ClientWithLifecycle[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchClients() {
    loading.value = true;
    error.value = null;
    try {
      clients.value = await readAllClientPages<ClientWithLifecycle>((from, to) => supabase
        .from('clients')
        .select(`*, zones(id, name), ${CLIENT_LIFECYCLE_SELECT}`, { count: 'exact' })
        .order('created_at', { ascending: false }).order('id')
        .range(from, to));
    } catch (err) {
      error.value = err instanceof Error ? err.message : (err as { message?: string }).message ?? 'Error al cargar clientes';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  // Un solo cliente por id, sin traer el listado completo — usado por la App
  // de Campo (Fase 32) para mostrar la ficha del cliente al tecnico.
  async function fetchClientById(id: string) {
    const { data, error: err } = await supabase.from('clients').select('*, zones(id, name)').eq('id', id).single();
    if (err) throw err;
    return data as Client;
  }

  async function createClient(payload: Partial<Client>) {
    const { data, error: err } = await supabase
      .from('clients')
      .insert(payload)
      .select(`*, zones(id, name), ${CLIENT_LIFECYCLE_SELECT}`)
      .single();
    if (err) throw err;
    clients.value.unshift(data as ClientWithLifecycle);
    return data as Client;
  }

  async function updateClient(id: string, payload: Partial<Client>) {
    const { data, error: err } = await supabase
      .from('clients')
      .update(payload)
      .eq('id', id)
      .select(`*, zones(id, name), ${CLIENT_LIFECYCLE_SELECT}`)
      .single();
    if (err) throw err;
    const idx = clients.value.findIndex((c) => c.id === id);
    if (idx !== -1) clients.value[idx] = data as ClientWithLifecycle;
    return data as Client;
  }

  async function deleteClient(id: string) {
    const { error: err } = await supabase.from('clients').delete().eq('id', id);
    if (err) throw err;
    clients.value = clients.value.filter((c) => c.id !== id);
  }

  return { clients, loading, error, fetchClients, fetchClientById, createClient, updateClient, deleteClient };
});
