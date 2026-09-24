import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Referido } from '@/types/domain';

const REFERIDO_SELECT = '*, referido:clients!referido_client_id(id, first_name, last_name)';

// Descuento de S/25 por recomendar un cliente (Fase 33) — el registro es
// solo el vinculo referente/referido; el descuento en si lo aplica el
// trigger apply_invoice_credits() sobre la siguiente factura del referente
// (ver migracion Fase 33), no este store.
export const useReferidosStore = defineStore('referidos', () => {
  const loading = ref(false);

  async function create(referenteClientId: string, referidoClientId: string) {
    const { data, error: err } = await supabase
      .from('referidos')
      .insert({ referente_client_id: referenteClientId, referido_client_id: referidoClientId })
      .select(REFERIDO_SELECT)
      .single();
    if (err) throw err;
    return data as unknown as Referido;
  }

  async function fetchByReferente(referenteClientId: string) {
    loading.value = true;
    try {
      const { data, error: err } = await supabase
        .from('referidos')
        .select(REFERIDO_SELECT)
        .eq('referente_client_id', referenteClientId)
        .order('created_at', { ascending: false });
      if (err) throw err;
      return (data ?? []) as unknown as Referido[];
    } finally {
      loading.value = false;
    }
  }

  return { loading, create, fetchByReferente };
});
