import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

export interface TrafficKpis {
  monthDownloadBytes: number;
  monthUploadBytes: number;
  monthTotalBytes: number;
  peakTotalBps: number;
  peakAt: string | null;
  bottleneckCount: number;
  anomalyCount: number;
}

// Lo que realmente devuelve /api/analytics/traffic/kpis — bottleneckCount/
// anomalyCount ya no viajan ahi (el backend dejo de recalcular
// fn_traffic_bottlenecks/fn_traffic_anomalies por segunda vez; fetchAll() ya
// pide esas 2 listas completas por su cuenta, el conteo es su .length).
type TrafficKpisResponse = Omit<TrafficKpis, 'bottleneckCount' | 'anomalyCount'>;

export interface MonthlyTotal {
  month_start: string;
  download_bytes: number;
  upload_bytes: number;
}

export interface TopClient {
  contract_id: string;
  contract_number: string | null;
  client_name: string;
  download_bytes: number;
  upload_bytes: number;
  total_bytes: number;
}

export interface Bottleneck {
  contract_id: string;
  contract_number: string | null;
  client_name: string;
  download_bps: number;
  upload_bps: number;
  download_capacity_bps: number;
  upload_capacity_bps: number;
  usage_pct: number;
  sampled_at: string;
}

export interface Anomaly {
  contract_id: string;
  contract_number: string | null;
  client_name: string;
  baseline_bps: number;
  current_bps: number;
  ratio: number;
  last_seen: string;
}

export interface TrafficSampleReport {
  ranAt: string;
  runId: string;
  devicesChecked: number;
  contractsChecked: number;
  samplesInserted: number;
  baselinesInitialized: number;
  errors: { deviceName: string; message: string }[];
}

export interface ClientDailyTotal {
  day: string;
  download_bytes: number;
  upload_bytes: number;
}

export const useAnalyticsStore = defineStore('analytics', () => {
  const kpis = ref<TrafficKpis | null>(null);
  const monthly = ref<MonthlyTotal[]>([]);
  const topClients = ref<TopClient[]>([]);
  const bottlenecks = ref<Bottleneck[]>([]);
  const anomalies = ref<Anomaly[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  function fetchSampleReport() {
    return apiFetch<TrafficSampleReport | null>('/api/analytics/traffic/sample-report');
  }

  function runSampleNow() {
    return apiFetch<TrafficSampleReport>('/api/analytics/traffic/sample-now', { method: 'POST' });
  }

  function fetchClientDaily(contractId: string, days = 30) {
    return apiFetch<ClientDailyTotal[]>(`/api/analytics/traffic/clients/${contractId}/daily?days=${days}`);
  }

  async function fetchAll() {
    loading.value = true;
    error.value = null;
    try {
      const [kpisRes, monthlyRes, topRes, bottleneckRes, anomalyRes] = await Promise.all([
        apiFetch<TrafficKpisResponse>('/api/analytics/traffic/kpis'),
        apiFetch<MonthlyTotal[]>('/api/analytics/traffic/monthly?months=6'),
        apiFetch<TopClient[]>('/api/analytics/traffic/top-clients?limit=10'),
        apiFetch<Bottleneck[]>('/api/analytics/traffic/bottlenecks?threshold=85'),
        apiFetch<Anomaly[]>('/api/analytics/traffic/anomalies'),
      ]);
      kpis.value = { ...kpisRes, bottleneckCount: bottleneckRes.length, anomalyCount: anomalyRes.length };
      monthly.value = monthlyRes;
      topClients.value = topRes;
      bottlenecks.value = bottleneckRes;
      anomalies.value = anomalyRes;
      lastUpdated.value = new Date();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al cargar la analitica de trafico';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    kpis,
    monthly,
    topClients,
    bottlenecks,
    anomalies,
    loading,
    error,
    lastUpdated,
    fetchAll,
    fetchSampleReport,
    runSampleNow,
    fetchClientDaily,
  };
});
