import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { ClientStatus } from '@/types/domain';

export interface NetworkStatusGroup {
  total: number;
  ok: number;
  down: number;
  untested: number;
}

export interface NetworkStatus {
  olt: NetworkStatusGroup;
  mikrotik: NetworkStatusGroup;
  problems: { kind: string; name: string; host: string }[];
}

export interface RecentClient {
  id: string;
  first_name: string;
  last_name: string;
  status: ClientStatus;
  created_at: string;
}

export interface DashboardSummary {
  clients: { active: number; suspended: number; prospect: number; retired: number };
  activeContracts: number;
  network: NetworkStatus;
  recentClients: RecentClient[];
}

async function countClients(status: ClientStatus): Promise<number> {
  const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', status);
  return count ?? 0;
}

export const useDashboardStore = defineStore('dashboard', () => {
  const summary = ref<DashboardSummary | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  async function fetchSummary() {
    loading.value = true;
    error.value = null;
    try {
      const [active, suspended, prospect, retired, contractsRes, network, recentRes] = await Promise.all([
        countClients('active'),
        countClients('suspended'),
        countClients('prospect'),
        countClients('retired'),
        supabase.from('service_contracts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        apiFetch<NetworkStatus>('/api/dashboard/network-status'),
        supabase
          .from('clients')
          .select('id, first_name, last_name, status, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      summary.value = {
        clients: { active, suspended, prospect, retired },
        activeContracts: contractsRes.count ?? 0,
        network,
        recentClients: (recentRes.data ?? []) as RecentClient[],
      };
      lastUpdated.value = new Date();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al cargar el dashboard';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return { summary, loading, error, lastUpdated, fetchSummary };
});
