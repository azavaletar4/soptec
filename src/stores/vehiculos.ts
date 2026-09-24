import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { MantenimientoHistorial, Vehiculo } from '@/types/domain';

const VEHICULO_SELECT = '*, tecnico:profiles!vehiculos_tecnico_id_fkey(id, full_name, email)';
const HISTORIAL_SELECT = '*, author:profiles!mantenimientos_historial_created_by_fkey(id, full_name, email)';

const SOAT_BUCKET = 'vehiculo-soat';
const SIGNED_URL_TTL = 3600;

export interface VehiculoWithUrl extends Vehiculo {
  soatUrl: string | null;
}

async function withSoatUrl(row: Vehiculo): Promise<VehiculoWithUrl> {
  if (!row.soat_archivo_path) return { ...row, soatUrl: null };
  const { data } = await supabase.storage.from(SOAT_BUCKET).createSignedUrl(row.soat_archivo_path, SIGNED_URL_TTL);
  return { ...row, soatUrl: data?.signedUrl ?? null };
}

export const useVehiculosStore = defineStore('vehiculos', () => {
  const vehiculos = ref<VehiculoWithUrl[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchVehiculos() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase.from('vehiculos').select(VEHICULO_SELECT).order('placa');
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    vehiculos.value = await Promise.all(((data ?? []) as unknown as Vehiculo[]).map(withSoatUrl));
  }

  /** Trae de nuevo un solo vehiculo (usado tras registrar un mantenimiento, que lo actualiza via trigger en el servidor). */
  async function refreshVehiculo(id: string) {
    const { data, error: err } = await supabase.from('vehiculos').select(VEHICULO_SELECT).eq('id', id).single();
    if (err) throw err;
    const vehiculo = await withSoatUrl(data as unknown as Vehiculo);
    const idx = vehiculos.value.findIndex((v) => v.id === id);
    if (idx !== -1) vehiculos.value[idx] = vehiculo;
    return vehiculo;
  }

  async function createVehiculo(payload: Partial<Vehiculo>) {
    const { data, error: err } = await supabase.from('vehiculos').insert(payload).select(VEHICULO_SELECT).single();
    if (err) throw err;
    const vehiculo = await withSoatUrl(data as unknown as Vehiculo);
    vehiculos.value.push(vehiculo);
    vehiculos.value.sort((a, b) => a.placa.localeCompare(b.placa));
    return vehiculo;
  }

  async function updateVehiculo(id: string, payload: Partial<Vehiculo>) {
    const { data, error: err } = await supabase.from('vehiculos').update(payload).eq('id', id).select(VEHICULO_SELECT).single();
    if (err) throw err;
    const vehiculo = await withSoatUrl(data as unknown as Vehiculo);
    const idx = vehiculos.value.findIndex((v) => v.id === id);
    if (idx !== -1) vehiculos.value[idx] = vehiculo;
    return vehiculo;
  }

  async function deleteVehiculo(id: string) {
    const existing = vehiculos.value.find((v) => v.id === id);
    if (existing?.soat_archivo_path) await supabase.storage.from(SOAT_BUCKET).remove([existing.soat_archivo_path]);
    const { error: err } = await supabase.from('vehiculos').delete().eq('id', id);
    if (err) throw err;
    vehiculos.value = vehiculos.value.filter((v) => v.id !== id);
  }

  /** Sube el PDF/foto del SOAT desde el computador del usuario y reemplaza el archivo anterior, si habia. */
  async function uploadSoatFile(id: string, file: File, previousPath?: string | null) {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'pdf';
    const path = `${id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(SOAT_BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;

    const updated = await updateVehiculo(id, { soat_archivo_path: path });
    if (previousPath) await supabase.storage.from(SOAT_BUCKET).remove([previousPath]);
    return updated;
  }

  async function removeSoatFile(id: string, path: string) {
    const updated = await updateVehiculo(id, { soat_archivo_path: null });
    await supabase.storage.from(SOAT_BUCKET).remove([path]);
    return updated;
  }

  async function fetchHistorial(vehiculoId: string) {
    const { data, error: err } = await supabase
      .from('mantenimientos_historial')
      .select(HISTORIAL_SELECT)
      .eq('vehiculo_id', vehiculoId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as MantenimientoHistorial[];
  }

  async function createMantenimiento(payload: {
    vehiculo_id: string;
    fecha: string;
    tipo: 'preventivo' | 'correctivo';
    descripcion?: string | null;
    costo?: number | null;
    taller?: string | null;
    kilometraje?: number | null;
  }) {
    const { data, error: err } = await supabase.from('mantenimientos_historial').insert(payload).select(HISTORIAL_SELECT).single();
    if (err) throw err;
    await refreshVehiculo(payload.vehiculo_id);
    return data as unknown as MantenimientoHistorial;
  }

  async function deleteMantenimiento(id: string, vehiculoId: string) {
    const { error: err } = await supabase.from('mantenimientos_historial').delete().eq('id', id);
    if (err) throw err;
    await refreshVehiculo(vehiculoId);
  }

  return {
    vehiculos,
    loading,
    error,
    fetchVehiculos,
    refreshVehiculo,
    createVehiculo,
    updateVehiculo,
    deleteVehiculo,
    uploadSoatFile,
    removeSoatFile,
    fetchHistorial,
    createMantenimiento,
    deleteMantenimiento,
  };
});
