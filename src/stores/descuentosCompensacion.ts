import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { DescuentoCompensacion, DescuentoCompensacionCriterio } from '@/types/domain';

const SELECT = '*, clients(id, first_name, last_name)';

// Descuentos manuales por averia/compensacion de servicio (Fase 34) — solo
// ADMIN/SUPERADMIN (lo exige la RLS de la tabla). El descuento en si lo
// aplica el trigger apply_invoice_credits() sobre la siguiente factura del
// cliente (mismo mecanismo que referidos, Fase 33), no este store.
export const useDescuentosCompensacionStore = defineStore('descuentosCompensacion', () => {
  const loading = ref(false);

  async function createIndividual(clientId: string, monto: number, motivo: string) {
    const { data, error: err } = await supabase
      .from('descuentos_compensacion')
      .insert({ client_id: clientId, monto, motivo })
      .select(SELECT)
      .single();
    if (err) throw err;
    return data as unknown as DescuentoCompensacion;
  }

  // Masivo por zona/OLT/caja NAP — RPC porque resuelve N clientes afectados
  // y crea N filas en una sola operacion atomica (ver migracion Fase 34).
  async function createMasivo(params: {
    criterio: DescuentoCompensacionCriterio;
    criterioId: string;
    motivo: string;
    monto?: number;
    porcentaje?: number;
  }) {
    const { data, error: err } = await supabase.rpc('crear_descuento_compensacion_masivo', {
      p_criterio: params.criterio,
      p_criterio_id: params.criterioId,
      p_motivo: params.motivo,
      p_monto: params.monto ?? null,
      p_porcentaje: params.porcentaje ?? null,
    });
    if (err) throw err;
    // La funcion devuelve `returns table(...)`, PostgREST lo entrega como un arreglo de 1 fila.
    const row = (Array.isArray(data) ? data[0] : data) as { lote_id: string; clientes_afectados: number };
    return row;
  }

  async function fetchPendientesByClient(clientId: string) {
    loading.value = true;
    try {
      const { data, error: err } = await supabase
        .from('descuentos_compensacion')
        .select(SELECT)
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
      if (err) throw err;
      return (data ?? []) as unknown as DescuentoCompensacion[];
    } finally {
      loading.value = false;
    }
  }

  async function cancelar(id: string) {
    const { error: err } = await supabase.from('descuentos_compensacion').update({ estado: 'cancelado' }).eq('id', id).eq('estado', 'pendiente');
    if (err) throw err;
  }

  return { loading, createIndividual, createMasivo, fetchPendientesByClient, cancelar };
});
