import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { CajaChicaCategoria, CajaChicaMovimiento } from '@/types/domain';
import type {CashDaily} from '@/lib/financeCash';

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
  const daily=ref<CashDaily|null>(null);
  async function fetchDaily(day:string){const {data,error:err}=await supabase.rpc('caja_finance_daily',{p_day:day});if(err)throw err;daily.value=data as CashDaily;return daily.value;}
  async function cashOperation(name:string,args:Record<string,unknown>){const {data,error:err}=await supabase.rpc(name,args);if(err)throw err;await fetchMovimientos();return data;}
  const reverseMovimiento=(operationId:string,id:string,reason:string)=>cashOperation('caja_reverse_movement',{p_operation_id:operationId,p_movement_id:id,p_reason:reason});
  const ownerWithdraw=(operationId:string,amount:string,reason:string)=>cashOperation('caja_owner_withdraw',{p_operation_id:operationId,p_amount:amount,p_reason:reason});
  const closeDay=(operationId:string,day:string,counted:string,reason:string)=>cashOperation('caja_close_day',{p_operation_id:operationId,p_day:day,p_counted_cash:counted,p_reason:reason});
  const reopenDay=(operationId:string,id:string,reason:string)=>cashOperation('caja_reopen_day',{p_operation_id:operationId,p_closure_id:id,p_reason:reason});

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

  async function uploadComprobante(file: File): Promise<string> {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
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
    daily,fetchDaily,reverseMovimiento,ownerWithdraw,closeDay,reopenDay,
    uploadComprobante,
  };
});
