import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { ContractStatus, ServiceContract } from '@/types/domain';
import { readAllClientPages } from '@/lib/clientLifecycle';

const PLAN_FIELDS = 'id, name, download_speed, upload_speed, price, mikrotik_profile, olt_tcont_profile, olt_traffic_profile';

const CONTRACT_SELECT = `*, clients(id, first_name, last_name, document_number), plans(${PLAN_FIELDS}), zones(id, name)`;

export const useContractsStore = defineStore('contracts', () => {
  const contracts = ref<ServiceContract[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchContracts() {
    loading.value = true;
    error.value = null;
    try {
      contracts.value = await readAllClientPages<ServiceContract>((from, to) => supabase
        .from('service_contracts').select(CONTRACT_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false }).order('id').range(from, to));
    } catch (err) {
      error.value = (err as { message?: string }).message ?? 'Error al cargar contratos';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchContractsByClient(clientId: string) {
    const { data, error: err } = await supabase
      .from('service_contracts')
      .select(`*, plans(${PLAN_FIELDS}), zones(id, name)`)
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

  async function deleteContract(id: string) {
    const { error: err } = await supabase.from('service_contracts').delete().eq('id', id);
    if (err) throw err;
    contracts.value = contracts.value.filter((c) => c.id !== id);
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
    deleteContract,
  };
});
