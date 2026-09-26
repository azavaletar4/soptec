import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { CajaChicaCategoria, CajaChicaMovimiento } from '@/types/domain';

const BUCKET = 'caja-chica-comprobantes';
const SIGNED_URL_TTL = 3600;
const MOVIMIENTO_SELECT = '*, vehiculos(id, placa, marca, modelo), caja_chica_categorias(id, nombre, permite_vehiculo)';

export interface CajaChicaMovimientoWithUrl extends CajaChicaMovimiento {
  url: string | null;
}

async function withSignedUrl(row: CajaChicaMovimiento): Promise<CajaChicaMovimientoWithUrl> {
  if (!row.comprobante_path) return { ...row, url: null };
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(row.comprobante_path, SIGNED_URL_TTL);
  return { ...row, url: signed?.signedUrl ?? null };
}

export const useCajaChicaStore = defineStore('cajaChica', () => {
  const movimientos = ref<CajaChicaMovimientoWithUrl[]>([]);
  const categorias = ref<CajaChicaCategoria[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchCategorias() {
    const { data, error: err } = await supabase.from('caja_chica_categorias').select('*').order('nombre');
    if (err) throw err;
    categorias.value = (data ?? []) as CajaChicaCategoria[];
  }

  // Se crea desde el formulario (igual patron que catalogs.createZone) —
  // queda disponible de inmediato para elegirla en este y otros movimientos.
  async function createCategoria(nombre: string, permiteVehiculo = false) {
    const { data, error: err } = await supabase
      .from('caja_chica_categorias')
      .insert({ nombre, permite_vehiculo: permiteVehiculo })
      .select()
      .single();
    if (err) throw err;
    const created = data as CajaChicaCategoria;
    categorias.value.push(created);
    categorias.value.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return created;
  }

  async function fetchMovimientos() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('caja_chica_movimientos')
      .select(MOVIMIENTO_SELECT)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    movimientos.value = await Promise.all(((data ?? []) as unknown as CajaChicaMovimiento[]).map(withSignedUrl));
  }

  async function createMovimiento(payload: Partial<CajaChicaMovimiento>) {
    const { data, error: err } = await supabase
      .from('caja_chica_movimientos')
      .insert(payload)
      .select(MOVIMIENTO_SELECT)
      .single();
    if (err) throw err;
    const withUrl = await withSignedUrl(data as unknown as CajaChicaMovimiento);
    movimientos.value.unshift(withUrl);
    return withUrl;
  }

  async function updateMovimiento(id: string, payload: Partial<CajaChicaMovimiento>) {
    const { data, error: err } = await supabase
      .from('caja_chica_movimientos')
      .update(payload)
      .eq('id', id)
      .select(MOVIMIENTO_SELECT)
      .single();
    if (err) throw err;
    const withUrl = await withSignedUrl(data as unknown as CajaChicaMovimiento);
    const idx = movimientos.value.findIndex((m) => m.id === id);
    if (idx !== -1) movimientos.value[idx] = withUrl;
    return withUrl;
  }

  async function deleteMovimiento(id: string, comprobantePath?: string | null) {
    const { error: err } = await supabase.from('caja_chica_movimientos').delete().eq('id', id);
    if (err) throw err;
    if (comprobantePath) await supabase.storage.from(BUCKET).remove([comprobantePath]);
    movimientos.value = movimientos.value.filter((m) => m.id !== id);
  }

  async function uploadComprobante(file: File, previousPath?: string | null): Promise<string> {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
    if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]);
    return path;
  }

  return {
    movimientos,
    categorias,
    loading,
    error,
    fetchCategorias,
    createCategoria,
    fetchMovimientos,
    createMovimiento,
    updateMovimiento,
    deleteMovimiento,
    uploadComprobante,
  };
});
