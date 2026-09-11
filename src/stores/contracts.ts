import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { ContractStatus, ServiceContract } from '@/types/domain';

const CONTRACT_SELECT =
  '*, clients(id, first_name, last_name, document_number), plans(id, name, download_speed, upload_speed, price)';

export const useContractsStore = defineStore('contracts', () => {
  const contracts = ref<ServiceContract[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchContracts() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('service_contracts')
      .select(CONTRACT_SELECT)
      .order('created_at', { ascending: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    contracts.value = (data ?? []) as unknown as ServiceContract[];
  }

  async function fetchContractsByClient(clientId: string) {
    const { data, error: err } = await supabase
      .from('service_contracts')
      .select('*, plans(id, name, download_speed, upload_speed, price)')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as ServiceContract[];
  }

  async function createContract(payload: Partial<ServiceContract>) {
    const { data, error: err } = await supabase
      .from('service_contracts')
      .insert(payload)
      .select(CONTRACT_SELECT)
      .single();
    if (err) throw err;
    contracts.value.unshift(data as unknown as ServiceContract);
    return data as unknown as ServiceContract;
  }

  async function updateContractStatus(id: string, status: ContractStatus) {
    return updateContract(id, { status });
  }

  async function updateContract(id: string, payload: Partial<ServiceContract>) {
    const { data, error: err } = await supabase
      .from('service_contracts')
      .update(payload)
      .eq('id', id)
      .select(CONTRACT_SELECT)
      .single();
    if (err) throw err;
    const idx = contracts.value.findIndex((c) => c.id === id);
    if (idx !== -1) contracts.value[idx] = data as unknown as ServiceContract;
    return data as unknown as ServiceContract;
  }

  return {
    contracts,
    loading,
    error,
    fetchContracts,
    fetchContractsByClient,
    createContract,
    updateContract,
    updateContractStatus,
  };
});
