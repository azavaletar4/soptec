import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Plan, Zone } from '@/types/domain';

/** Catalogos de referencia (zonas, planes), cacheados en memoria para toda la app. */
export const useCatalogsStore = defineStore('catalogs', () => {
  const zones = ref<Zone[]>([]);
  const plans = ref<Plan[]>([]);

  async function fetchZones() {
    if (zones.value.length) return;
    const { data, error } = await supabase.from('zones').select('*').order('name');
    if (error) throw error;
    zones.value = data ?? [];
  }

  async function fetchPlans() {
    if (plans.value.length) return;
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('price');
    if (error) throw error;
    plans.value = data ?? [];
  }

  function resetZones() {
    zones.value = [];
  }

  function resetPlans() {
    plans.value = [];
  }

  return { zones, plans, fetchZones, fetchPlans, resetZones, resetPlans };
});
