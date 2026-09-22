import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

export interface TechnicianRankingRow {
  technician_id: string;
  technician_name: string;
  installations_count: number;
  averias_count: number;
  reconexiones_count: number;
  reincidencias_count: number;
  total_points: number;
  ranking: number;
}

// Ranking mensual de tecnicos de campo (Fase 27) — todo se calcula fresco
// en la funcion SQL get_technician_ranking via el backend, no se guarda
// nada en el frontend entre meses.
export const useSoporteRankingStore = defineStore('soporteRanking', () => {
  const ranking = ref<TechnicianRankingRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

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

  return { ranking, loading, error, fetchRanking };
});
