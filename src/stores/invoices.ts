import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { Invoice, InvoiceAdjustment } from '@/types/domain';

// service_contracts!contract_id — desde Fase 25 hay una segunda relacion
// entre invoices y service_contracts (service_contracts.debt_hold_invoice_id
// -> invoices.id), asi que hay que especificar la FK o PostgREST tira
// "more than one relationship was found".
const INVOICE_SELECT =
  '*, clients(id, first_name, last_name, document_number), service_contracts!contract_id(id, contract_number)';

export const useInvoicesStore = defineStore('invoices', () => {
  const invoices = ref<Invoice[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchInvoices() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .order('created_at', { ascending: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    invoices.value = (data ?? []) as unknown as Invoice[];
  }

  async function fetchInvoicesByClient(clientId: string) {
    const { data, error: err } = await supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as Invoice[];
  }

  async function createInvoice(payload: Partial<Invoice>) {
    const { data, error: err } = await supabase.from('invoices').insert(payload).select(INVOICE_SELECT).single();
    if (err) throw err;
    invoices.value.unshift(data as unknown as Invoice);
    return data as unknown as Invoice;
  }

  // Pasa por el backend (no supabase-js directo, como el resto de este
  // store) porque marcar pagada una factura puede necesitar reactivar al
  // cliente en MikroTik/OLT si estaba en corte por deuda (ver Fase 25), y
  // desde la Fase 33 tambien calcula el sobrepago (saldo a favor) contra el
  // monto ya neto de descuentos de referido/saldo previo.
  async function markPaid(id: string, paymentMethod: string, amountPaid?: number) {
    const { invoice, reactivation } = await apiFetch<{
      invoice: Invoice;
      reactivation: { attempted: boolean; ok?: boolean; error?: string };
    }>(`/api/invoices/${id}/mark-paid`, { method: 'POST', body: JSON.stringify({ paymentMethod, amountPaid }) });
    const idx = invoices.value.findIndex((i) => i.id === id);
    if (idx !== -1) invoices.value[idx] = invoice;
    return { invoice, reactivation };
  }

  // Facturacion recurrente (Fase 33b) — genera todas las facturas pendientes
  // de contratos activos que ya cumplieron su periodo. Boton manual en
  // FacturacionView.vue; el scheduler automatico corre esto mismo si esta
  // activado (INVOICE_SCHEDULER_ENABLED=true, desactivado por defecto).
  function generateDue() {
    return apiFetch<{ scanned: number; generated: number; errors: { contractId: string; message: string }[] }>(
      '/api/invoices/generate-due',
      { method: 'POST' },
    );
  }

  // Desglose de descuentos/creditos (referido, saldo a favor, promo 4to
  // gratis) de una factura puntual — se carga bajo demanda al expandir el
  // detalle, no de una vez por todas las facturas listadas.
  async function fetchAdjustments(invoiceId: string) {
    const { data, error: err } = await supabase
      .from('invoice_adjustments')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true });
    if (err) throw err;
    return (data ?? []) as unknown as InvoiceAdjustment[];
  }

  // Edicion completa (monto, fechas, contrato, notas) — a diferencia de
  // markPaid/cancelInvoice (que solo tocan el status), esto es para
  // corregir datos mal cargados. Restringido a SUPERADMIN en la UI (ver
  // FacturacionView.vue); a nivel de base la policy de RLS ya cubre a todo
  // el staff de facturacion.
  async function updateInvoice(id: string, payload: Partial<Invoice>) {
    const { data, error: err } = await supabase.from('invoices').update(payload).eq('id', id).select(INVOICE_SELECT).single();
    if (err) throw err;
    const idx = invoices.value.findIndex((i) => i.id === id);
    if (idx !== -1) invoices.value[idx] = data as unknown as Invoice;
    return data as unknown as Invoice;
  }

  async function cancelInvoice(id: string) {
    const { data, error: err } = await supabase
      .from('invoices')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .select(INVOICE_SELECT)
      .single();
    if (err) throw err;
    const idx = invoices.value.findIndex((i) => i.id === id);
    if (idx !== -1) invoices.value[idx] = data as unknown as Invoice;
    return data as unknown as Invoice;
  }

  // Borrado definitivo (limpieza de facturas de prueba) — restringido a
  // SUPERADMIN por RLS (Fase 35), igual criterio que deleteTicket (Fase 26).
  // Las filas que la referencian (invoice_adjustments, referidos,
  // client_credit_movements, debt_hold_invoice_id) ya estan preparadas para
  // esto (cascade/set null), no hace falta limpiarlas a mano aqui.
  async function deleteInvoice(id: string) {
    const { error: err } = await supabase.from('invoices').delete().eq('id', id);
    if (err) throw err;
    invoices.value = invoices.value.filter((i) => i.id !== id);
  }

  return { invoices, loading, error, fetchInvoices, fetchInvoicesByClient, createInvoice, updateInvoice, markPaid, fetchAdjustments, generateDue, cancelInvoice, deleteInvoice };
});
