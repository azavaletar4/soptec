import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Routine, RoutineStatus } from '@/types/domain';

const ROUTINE_SELECT =
  '*, clients(id, first_name, last_name, phone, latitude, longitude), zones(id, name), nap_elemento:infra_elementos(id, name), assigned_profile:profiles!routines_assigned_to_fkey(id, full_name, email)';

/** Mantenimiento preventivo / peinado de NAPs (Fase 101) — mismo molde que useTicketsStore/useInstallationsStore. */
export const useRoutinesStore = defineStore('routines', () => {
  const routines = ref<Routine[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchRoutines() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('routines')
      .select(ROUTINE_SELECT)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    routines.value = (data ?? []) as unknown as Routine[];
  }

  async function createRoutine(payload: Partial<Routine>) {
    const { data, error: err } = await supabase.from('routines').insert(payload).select(ROUTINE_SELECT).single();
    if (err) throw err;
    routines.value.unshift(data as unknown as Routine);
    return data as unknown as Routine;
  }

  async function updateRoutine(id: string, payload: Partial<Routine>) {
    const { data, error: err } = await supabase
      .from('routines')
      .update(payload)
      .eq('id', id)
      .select(ROUTINE_SELECT)
      .single();
    if (err) throw err;
    const idx = routines.value.findIndex((r) => r.id === id);
    if (idx !== -1) routines.value[idx] = data as unknown as Routine;
    return data as unknown as Routine;
  }

  async function updateStatus(id: string, status: RoutineStatus) {
    return updateRoutine(id, { status });
  }

  async function deleteRoutine(id: string) {
    const { error: err } = await supabase.from('routines').delete().eq('id', id);
    if (err) throw err;
    routines.value = routines.value.filter((r) => r.id !== id);
  }

  return {
    routines,
    loading,
    error,
    fetchRoutines,
    createRoutine,
    updateRoutine,
    updateStatus,
    deleteRoutine,
  };
});
