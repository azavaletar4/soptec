import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Plan } from '@/types/domain';

export const usePlansStore = defineStore('plans', () => {
  const plans = ref<Plan[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchPlans() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('plans')
      .select('*')
      .is('deleted_at', null)
      .order('price');
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    plans.value = (data ?? []) as Plan[];
  }

  async function createPlan(payload: Partial<Plan>) {
    const { data, error: err } = await supabase.from('plans').insert(payload).select().single();
    if (err) throw err;
    plans.value.push(data as Plan);
    plans.value.sort((a, b) => a.price - b.price);
    return data as Plan;
  }

  async function updatePlan(id: string, payload: Partial<Plan>) {
    const { data, error: err } = await supabase.from('plans').update(payload).eq('id', id).select().single();
    if (err) throw err;
    const idx = plans.value.findIndex((p) => p.id === id);
    if (idx !== -1) plans.value[idx] = data as Plan;
    return data as Plan;
  }

  async function deletePlan(id: string) {
    const { error: err } = await supabase.from('plans').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (err) throw err;
    plans.value = plans.value.filter((p) => p.id !== id);
  }

  return { plans, loading, error, fetchPlans, createPlan, updatePlan, deletePlan };
});
