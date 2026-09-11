import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Installation, InstallationStatus } from '@/types/domain';

const INSTALLATION_SELECT =
  '*, clients(id, first_name, last_name, phone, address, latitude, longitude), contracts:service_contracts(id, contract_number), assigned_profile:profiles!installations_assigned_to_fkey(id, full_name, email)';

export const useInstallationsStore = defineStore('installations', () => {
  const installations = ref<Installation[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchInstallations() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('installations')
      .select(INSTALLATION_SELECT)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    installations.value = (data ?? []) as unknown as Installation[];
  }

  async function createInstallation(payload: Partial<Installation>) {
    const { data, error: err } = await supabase
      .from('installations')
      .insert(payload)
      .select(INSTALLATION_SELECT)
      .single();
    if (err) throw err;
    installations.value.unshift(data as unknown as Installation);
    return data as unknown as Installation;
  }

  async function updateInstallation(id: string, payload: Partial<Installation>) {
    const { data, error: err } = await supabase
      .from('installations')
      .update(payload)
      .eq('id', id)
      .select(INSTALLATION_SELECT)
      .single();
    if (err) throw err;
    const idx = installations.value.findIndex((i) => i.id === id);
    if (idx !== -1) installations.value[idx] = data as unknown as Installation;
    return data as unknown as Installation;
  }

  async function updateStatus(id: string, status: InstallationStatus) {
    return updateInstallation(id, { status });
  }

  async function deleteInstallation(id: string) {
    const { error: err } = await supabase.from('installations').delete().eq('id', id);
    if (err) throw err;
    installations.value = installations.value.filter((i) => i.id !== id);
  }

  return {
    installations,
    loading,
    error,
    fetchInstallations,
    createInstallation,
    updateInstallation,
    updateStatus,
    deleteInstallation,
  };
});
