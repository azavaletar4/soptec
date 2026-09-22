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

  // Solo un plan puede ser "el plan de corte por deuda" a la vez (indice
  // unico parcial en la base) — si se marca este, se desmarca cualquier
  // otro primero para no chocar con ese indice.
  async function clearOtherDebtSuspensionPlans(exceptId?: string) {
    let query = supabase.from('plans').update({ is_debt_suspension_plan: false }).eq('is_debt_suspension_plan', true);
    if (exceptId) query = query.neq('id', exceptId);
    const { error: err } = await query;
    if (err) throw err;
  }

  async function createPlan(payload: Partial<Plan>) {
    if (payload.is_debt_suspension_plan) await clearOtherDebtSuspensionPlans();
    const { data, error: err } = await supabase.from('plans').insert(payload).select().single();
    if (err) throw err;
    plans.value.push(data as Plan);
    plans.value.sort((a, b) => a.price - b.price);
    return data as Plan;
  }

  async function updatePlan(id: string, payload: Partial<Plan>) {
    if (payload.is_debt_suspension_plan) await clearOtherDebtSuspensionPlans(id);
    const { data, error: err } = await supabase.from('plans').update(payload).eq('id', id).select().single();
    if (err) throw err;
    const idx = plans.value.findIndex((p) => p.id === id);
    if (idx !== -1) plans.value[idx] = data as Plan;
    // Si se desmarco a otro plan por el lado, refresca la lista completa
    // para que su badge tambien se actualice en la tabla.
    if (payload.is_debt_suspension_plan) await fetchPlans();
    return data as Plan;
  }

  async function deletePlan(id: string) {
    const { error: err } = await supabase.from('plans').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (err) throw err;
    plans.value = plans.value.filter((p) => p.id !== id);
  }

  return { plans, loading, error, fetchPlans, createPlan, updatePlan, deletePlan };
});
