import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PagoAdelantado } from '@/types/domain';
export const usePagosAdelantadosStore = defineStore('pagosAdelantados', () => {
  const saving = ref(false);
  /** La promoción antigua crea cuatro facturas paid sin un cobro independiente.
   * Se conserva la llamada de la ficha, con explicación y sin escrituras. */
  async function create(_params: { contractId: string; clientId: string; montoTotal: number; paymentMethod?: string }): Promise<PagoAdelantado> {
    throw new Error('La promoción 3+1 requiere conciliación y validación comercial. Para anticipos monetarios usa Registrar pago en Facturación; no se creó ninguna factura.');
  }
  return { saving, create };
});
