import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';
import type { DebtHoldEvent, ServiceContract } from '@/types/domain';

export interface StepResult {
  ok: boolean;
  error?: string;
}

export interface ApplyResult {
  ok: boolean;
  mikrotik: StepResult;
  olt: StepResult;
}

export const useDebtHoldStore = defineStore('debtHold', () => {
  const pending = ref<ServiceContract[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchPending() {
    loading.value = true;
    error.value = null;
    try {
      pending.value = await apiFetch<ServiceContract[]>('/api/debt-hold/pending');
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function fetchEvents(contractId: string) {
    return apiFetch<DebtHoldEvent[]>(`/api/debt-hold/${contractId}/events`);
  }

  function runScan() {
    return apiFetch<{ scanned: number; flagged: number; errors: number }>('/api/debt-hold/scan', { method: 'POST' });
  }

  async function applyHold(contractId: string) {
    const result = await apiFetch<ApplyResult>(`/api/debt-hold/${contractId}/apply`, { method: 'POST' });
    await fetchPending();
    return result;
  }

  async function reactivate(contractId: string) {
    const result = await apiFetch<ApplyResult>(`/api/debt-hold/${contractId}/reactivate`, { method: 'POST' });
    await fetchPending();
    return result;
  }

  return { pending, loading, error, fetchPending, fetchEvents, runScan, applyHold, reactivate };
});
