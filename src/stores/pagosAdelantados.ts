import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { PagoAdelantado } from '@/types/domain';

// Promocion "paga 3 meses, el 4to es gratis" (Fase 33). El insert dispara el
// trigger apply_pago_adelantado() que crea las 4 facturas — pero ese trigger
// llena invoice_ids con un UPDATE posterior a la fila, que NO viaja en el
// INSERT ... RETURNING original. Por eso create() vuelve a consultar la fila
// despues de insertarla, en vez de confiar en la respuesta del insert.
export const usePagosAdelantadosStore = defineStore('pagosAdelantados', () => {
  const saving = ref(false);

  async function create(params: { contractId: string; clientId: string; montoTotal: number; paymentMethod?: string }) {
    saving.value = true;
    try {
      const { data: inserted, error: insErr } = await supabase
        .from('pagos_adelantados')
        .insert({
          contract_id: params.contractId,
          client_id: params.clientId,
          monto_total: params.montoTotal,
          payment_method: params.paymentMethod || null,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;

      const { data, error: err } = await supabase.from('pagos_adelantados').select('*').eq('id', inserted.id).single();
      if (err) throw err;
      return data as unknown as PagoAdelantado;
    } finally {
      saving.value = false;
    }
  }

  return { saving, create };
});
