import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

export interface TechnicianRankingRow {
  technician_id: string;
  technician_name: string;
  installations_count: number;
  averias_count: number;
  reconexiones_count: number;
  rutinas_count: number;
  reincidencias_count: number;
  total_points: number;
  ranking: number;
}
export type RankingPeriod = 'day' | 'week' | 'month';
export interface RankingPeriodResult {
  period: RankingPeriod;
  start: string;
  end: string;
  timezone: string;
  asOf: string;
  ranking: TechnicianRankingRow[];
}

// Ranking mensual de tecnicos de campo (Fase 27) — todo se calcula fresco
// en la funcion SQL get_technician_ranking via el backend, no se guarda
// nada en el frontend entre meses.
export const useSoporteRankingStore = defineStore('soporteRanking', () => {
  const ranking = ref<TechnicianRankingRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const periodResult = ref<RankingPeriodResult | null>(null);
  let requestId = 0;

  async function fetchPeriodRanking(period: RankingPeriod, date: string) {
    const request = ++requestId;
    loading.value = true;
    error.value = null;
    ranking.value = [];
    periodResult.value = null;
    try {
      const params = new URLSearchParams({ periodo: period, fecha: date });
      const res = await apiFetch<RankingPeriodResult>(`/api/soporte/ranking-tecnicos?${params}`);
      if (request === requestId) { ranking.value = res.ranking; periodResult.value = res; }
    } catch (e) {
      if (request === requestId) error.value = e instanceof Error ? e.message : 'No se pudo consultar el ranking';
    } finally {
      if (request === requestId) loading.value = false;
    }
  }

  async function fetchRanking(mes: number, anio: number) {
    loading.value = true;
    error.value = null;
    try {
      const res = await apiFetch<{ mes: number; anio: number; ranking: TechnicianRankingRow[] }>(
        `/api/soporte/ranking-tecnicos?mes=${mes}&anio=${anio}`,
      );
      ranking.value = res.ranking;
      return res;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return { ranking, loading, error, periodResult, fetchRanking, fetchPeriodRanking };
});
