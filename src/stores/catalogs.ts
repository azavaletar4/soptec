import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Plan, StaffProfile, Zone } from '@/types/domain';

/** Catalogos de referencia (zonas, planes), cacheados en memoria para toda la app. */
export const useCatalogsStore = defineStore('catalogs', () => {
  const zones = ref<Zone[]>([]);
  const plans = ref<Plan[]>([]);
  const staff = ref<StaffProfile[]>([]);

  async function fetchZones() {
    if (zones.value.length) return;
    const { data, error } = await supabase.from('zones').select('*').order('name');
    if (error) throw error;
    zones.value = data ?? [];
  }

  async function createZone(name: string, description?: string | null) {
    const { data, error } = await supabase
      .from('zones')
      .insert({ name, description: description || null })
      .select()
      .single();
    if (error) throw error;
    zones.value.push(data as Zone);
    zones.value.sort((a, b) => a.name.localeCompare(b.name));
    return data as Zone;
  }

  async function updateZone(id: string, payload: Partial<Pick<Zone, 'name' | 'description'>>) {
    const { data, error } = await supabase.from('zones').update(payload).eq('id', id).select().single();
    if (error) throw error;
    const idx = zones.value.findIndex((z) => z.id === id);
    if (idx !== -1) zones.value[idx] = data as Zone;
    zones.value.sort((a, b) => a.name.localeCompare(b.name));
    return data as Zone;
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

  async function fetchStaff() {
    if (staff.value.length) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .neq('role', 'CLIENTE')
      .eq('active', true)
      .order('full_name');
    if (error) throw error;
    staff.value = data ?? [];
  }

  function resetZones() {
    zones.value = [];
  }

  function resetPlans() {
    plans.value = [];
  }

  return { zones, plans, staff, fetchZones, createZone, updateZone, fetchPlans, fetchStaff, resetZones, resetPlans };
});
