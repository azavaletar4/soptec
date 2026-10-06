import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { ActivoTecnico } from '@/types/domain';

const ACTIVO_SELECT = '*, tecnico:profiles!activos_tecnicos_tecnico_id_fkey(id, full_name, email)';

const CARGO_BUCKET = 'activos-cargos';
const SIGNED_URL_TTL = 3600;

export interface ActivoTecnicoWithUrl extends ActivoTecnico {
  cargoUrl: string | null;
}

async function withCargoUrl(row: ActivoTecnico): Promise<ActivoTecnicoWithUrl> {
  if (!row.cargo_documento_path) return { ...row, cargoUrl: null };
  const { data } = await supabase.storage.from(CARGO_BUCKET).createSignedUrl(row.cargo_documento_path, SIGNED_URL_TTL);
  return { ...row, cargoUrl: data?.signedUrl ?? null };
}

export const useActivosTecnicosStore = defineStore('activosTecnicos', () => {
  const activos = ref<ActivoTecnicoWithUrl[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchActivos() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase.from('activos_tecnicos').select(ACTIVO_SELECT).order('codigo');
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    activos.value = await Promise.all(((data ?? []) as unknown as ActivoTecnico[]).map(withCargoUrl));
  }

  async function createActivo(payload: Partial<ActivoTecnico>) {
    const { data, error: err } = await supabase.from('activos_tecnicos').insert(payload).select(ACTIVO_SELECT).single();
    if (err) throw err;
    const activo = await withCargoUrl(data as unknown as ActivoTecnico);
    activos.value.push(activo);
    activos.value.sort((a, b) => a.codigo.localeCompare(b.codigo));
    return activo;
  }

  async function updateActivo(id: string, payload: Partial<ActivoTecnico>) {
    const { data, error: err } = await supabase.from('activos_tecnicos').update(payload).eq('id', id).select(ACTIVO_SELECT).single();
    if (err) throw err;
    const activo = await withCargoUrl(data as unknown as ActivoTecnico);
    const idx = activos.value.findIndex((a) => a.id === id);
    if (idx !== -1) activos.value[idx] = activo;
    return activo;
  }

  async function deleteActivo(id: string) {
    const existing = activos.value.find((a) => a.id === id);
    if (existing?.cargo_documento_path) await supabase.storage.from(CARGO_BUCKET).remove([existing.cargo_documento_path]);
    const { error: err } = await supabase.from('activos_tecnicos').delete().eq('id', id);
    if (err) throw err;
    activos.value = activos.value.filter((a) => a.id !== id);
  }

  /** Sube el cargo de recepcion (PDF o foto) firmado por el tecnico y reemplaza el anterior, si habia. */
  async function uploadCargoFile(id: string, file: File, previousPath?: string | null) {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'pdf';
    const path = `${id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(CARGO_BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;

    const updated = await updateActivo(id, { cargo_documento_path: path });
    if (previousPath) await supabase.storage.from(CARGO_BUCKET).remove([previousPath]);
    return updated;
  }

  async function removeCargoFile(id: string, path: string) {
    const updated = await updateActivo(id, { cargo_documento_path: null });
    await supabase.storage.from(CARGO_BUCKET).remove([path]);
    return updated;
  }

  return {
    activos,
    loading,
    error,
    fetchActivos,
    createActivo,
    updateActivo,
    deleteActivo,
    uploadCargoFile,
    removeCargoFile,
  };
});
