import { defineStore } from 'pinia';
import { requireWorkOrderPoints } from '@/lib/workOrderPoints';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Installation, InstallationStatus } from '@/types/domain';
import { readAllClientPages } from '@/lib/clientLifecycle';

// Fase 152: se agrega phone_2 (telefono alternativo) al join de clients —
// ya lo capturaba la conversion de prospecto (13k) pero esta vista no lo
// pedia, asi que el resumen para el tecnico (InstalacionDetailView.vue) no
// lo podia mostrar sin una consulta aparte.
// Fase 163: installation_postponements(id) solo para saber si tiene
// historial (badge "Con postergaciones" en InstalacionesView.vue) — el
// detalle completo (quien/cuando/motivo) se carga aparte en
// InstalacionDetailView.vue, mismo patron que routine_returns(id) en
// routines.ts.
const INSTALLATION_SELECT =
  '*, installation_postponements(id), clients(id, first_name, last_name, phone, phone_2, address, latitude, longitude), contracts:service_contracts(id, contract_number, service_type), assigned_profile:profiles!installations_assigned_to_fkey(id, full_name, email)';

export const useInstallationsStore = defineStore('installations', () => {
  const installations = ref<Installation[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchInstallations() {
    loading.value = true;
    error.value = null;
    try {
      installations.value = await readAllClientPages<Installation>((from, to) => supabase
        .from('installations').select(INSTALLATION_SELECT, { count: 'exact' })
        .order('scheduled_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }).order('id').range(from, to));
    } catch (err) {
      error.value = (err as { message?: string }).message ?? 'Error al cargar instalaciones';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createInstallation(payload: Partial<Installation>) {
    requireWorkOrderPoints(payload.points);
    const { data, error: err } = await supabase
      .from('installations')
      .insert(payload)
      .select(INSTALLATION_SELECT)
      .single();
    if (err) throw err;
    installations.value.unshift(data as unknown as Installation);
    return data as unknown as Installation;
  }

  async function updateInstallation(id: string, payload: Partial<Installation>) {
    const { data, error: err } = await supabase
      .from('installations')
      .update(payload)
      .eq('id', id)
      .select(INSTALLATION_SELECT)
      .single();
    if (err) throw err;
    const idx = installations.value.findIndex((i) => i.id === id);
    if (idx !== -1) installations.value[idx] = data as unknown as Installation;
    return data as unknown as Installation;
  }

  async function updateStatus(id: string, status: InstallationStatus) {
    return updateInstallation(id, { status });
  }

  async function deleteInstallation(id: string) {
    const { error: err } = await supabase.from('installations').delete().eq('id', id);
    if (err) throw err;
    installations.value = installations.value.filter((i) => i.id !== id);
  }

  return {
    installations,
    loading,
    error,
    fetchInstallations,
    createInstallation,
    updateInstallation,
    updateStatus,
    deleteInstallation,
  };
});
