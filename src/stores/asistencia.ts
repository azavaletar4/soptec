import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { fechaLimaISO } from '@/lib/asistenciaReglas';
import type { AsistenciaRegistro, CompanySettings, Feriado } from '@/types/domain';

const REGISTRO_SELECT = '*, profile:profiles!asistencia_registros_user_id_fkey(id, full_name, email)';

export const useAsistenciaStore = defineStore('asistencia', () => {
  const settings = ref<CompanySettings | null>(null);
  const feriados = ref<Feriado[]>([]);
  const hoy = ref<AsistenciaRegistro | null>(null);
  const tablero = ref<AsistenciaRegistro[]>([]);
  const loadingHoy = ref(false);
  const loadingTablero = ref(false);

  async function fetchSettings() {
    const { data, error } = await supabase.from('company_settings').select('*').eq('id', 1).single();
    if (error) throw error;
    settings.value = data as unknown as CompanySettings;
  }

  async function updateSettings(payload: Partial<CompanySettings>) {
    const { data, error } = await supabase.from('company_settings').update(payload).eq('id', 1).select().single();
    if (error) throw error;
    settings.value = data as unknown as CompanySettings;
    return settings.value;
  }

  async function fetchFeriados() {
    const { data, error } = await supabase.from('feriados').select('*').order('fecha');
    if (error) throw error;
    feriados.value = (data ?? []) as Feriado[];
  }

  async function createFeriado(fecha: string, nombre: string) {
    const { data, error } = await supabase.from('feriados').insert({ fecha, nombre }).select().single();
    if (error) throw error;
    feriados.value.push(data as Feriado);
    feriados.value.sort((a, b) => a.fecha.localeCompare(b.fecha));
    return data as Feriado;
  }

  async function deleteFeriado(fecha: string) {
    const { error } = await supabase.from('feriados').delete().eq('fecha', fecha);
    if (error) throw error;
    feriados.value = feriados.value.filter((f) => f.fecha !== fecha);
  }

  async function fetchHoy() {
    loadingHoy.value = true;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        hoy.value = null;
        return;
      }
      const { data, error } = await supabase
        .from('asistencia_registros')
        .select('*')
        .eq('user_id', auth.user.id)
        .eq('fecha', fechaLimaISO())
        .maybeSingle();
      if (error) throw error;
      hoy.value = (data as AsistenciaRegistro | null) ?? null;
    } finally {
      loadingHoy.value = false;
    }
  }

  async function markIngreso(lat: number | null, lng: number | null) {
    const { data, error } = await supabase.rpc('mark_attendance_ingreso', { p_lat: lat, p_lng: lng });
    if (error) throw error;
    hoy.value = data as AsistenciaRegistro;
    return hoy.value;
  }

  async function markInicioAlmuerzo() {
    const { data, error } = await supabase.rpc('mark_attendance_inicio_almuerzo');
    if (error) throw error;
    hoy.value = data as AsistenciaRegistro;
    return hoy.value;
  }

  async function markFinAlmuerzo(lat: number | null, lng: number | null) {
    const { data, error } = await supabase.rpc('mark_attendance_fin_almuerzo', { p_lat: lat, p_lng: lng });
    if (error) throw error;
    hoy.value = data as AsistenciaRegistro;
    return hoy.value;
  }

  async function markSalida(lat: number | null, lng: number | null) {
    const { data, error } = await supabase.rpc('mark_attendance_salida', { p_lat: lat, p_lng: lng });
    if (error) throw error;
    hoy.value = data as AsistenciaRegistro;
    return hoy.value;
  }

  /** Tablero en vivo (SUPERADMIN/ADMIN): todas las marcaciones de un dia puntual. */
  async function fetchTablero(fecha: string) {
    loadingTablero.value = true;
    try {
      const { data, error } = await supabase.from('asistencia_registros').select(REGISTRO_SELECT).eq('fecha', fecha);
      if (error) throw error;
      tablero.value = (data ?? []) as unknown as AsistenciaRegistro[];
    } finally {
      loadingTablero.value = false;
    }
  }

  /** Reporte mensual (SUPERADMIN/ADMIN): filas crudas del rango — la agregacion por colaborador se arma en la vista. */
  async function fetchRango(desde: string, hasta: string) {
    const { data, error } = await supabase
      .from('asistencia_registros')
      .select(REGISTRO_SELECT)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha');
    if (error) throw error;
    return (data ?? []) as unknown as AsistenciaRegistro[];
  }

  return {
    settings,
    feriados,
    hoy,
    tablero,
    loadingHoy,
    loadingTablero,
    fetchSettings,
    updateSettings,
    fetchFeriados,
    createFeriado,
    deleteFeriado,
    fetchHoy,
    markIngreso,
    markInicioAlmuerzo,
    markFinAlmuerzo,
    markSalida,
    fetchTablero,
    fetchRango,
  };
});
