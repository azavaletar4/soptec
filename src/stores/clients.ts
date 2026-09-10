import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Client } from '@/types/domain';

export const useClientsStore = defineStore('clients', () => {
  const clients = ref<Client[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchClients() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('clients')
      .select('*, zones(id, name)')
      .order('created_at', { ascending: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    clients.value = (data ?? []) as Client[];
  }

  async function createClient(payload: Partial<Client>) {
    const { data, error: err } = await supabase
      .from('clients')
      .insert(payload)
      .select('*, zones(id, name)')
      .single();
    if (err) throw err;
    clients.value.unshift(data as Client);
    return data as Client;
  }

  async function updateClient(id: string, payload: Partial<Client>) {
    const { data, error: err } = await supabase
      .from('clients')
      .update(payload)
      .eq('id', id)
      .select('*, zones(id, name)')
      .single();
    if (err) throw err;
    const idx = clients.value.findIndex((c) => c.id === id);
    if (idx !== -1) clients.value[idx] = data as Client;
    return data as Client;
  }

  async function deleteClient(id: string) {
    const { error: err } = await supabase.from('clients').delete().eq('id', id);
    if (err) throw err;
    clients.value = clients.value.filter((c) => c.id !== id);
  }

  return { clients, loading, error, fetchClients, createClient, updateClient, deleteClient };
});
