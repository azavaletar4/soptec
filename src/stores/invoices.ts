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
  '*, clients(id, first_name, last_name, document_number), service_contracts!contract_id(id, contract_number,zone_id,service_type,zones(id,name),plans(id,name))';

export const useInvoicesStore = defineStore('invoices', () => {
  const invoices = ref<Invoice[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const total = ref(0);

  async function fetchInvoices(filters: { page?: number; from?: string; to?: string; status?: string; contractId?: string; search?: string; zone?: string } = {}) {
    loading.value = true;
    error.value = null;
    const { data: result, error: err } = await supabase.rpc('finance_list', {
      p_from: filters.from ?? new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10), p_to: filters.to ?? new Date().toISOString().slice(0,10),
      p_page: filters.page ?? 1, p_search: filters.search ?? '', p_status: filters.status ?? '',
      p_zone: filters.zone || null, p_contract: filters.contractId || null,
    });
    const data = result?.rows ?? [], count = result?.total ?? 0;
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    invoices.value = (data ?? []) as unknown as Invoice[];
    total.value = count ?? 0;
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

  /** Facturas de UN servicio/contrato puntual (Fase 37). */
  async function fetchInvoicesByContract(contractId: string) {
    const { data, error: err } = await supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('contract_id', contractId)
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

  function recordPayment(payload: { requestId: string; contractId: string; invoiceIds: string[]; amount: string; method: string; reference: string; reason: string;parts?:import('@/lib/financeCash').MixedPaymentPart[] }) {
    return apiFetch<{ paymentId: string;groupId?:string; received: string; applied: string; credit: string; reactivation: { attempted: false } }>('/api/invoices/payments', { method: 'POST', body: JSON.stringify(payload) });
  }
  return { invoices, total, loading, error, fetchInvoices, fetchInvoicesByClient, fetchInvoicesByContract, createInvoice, updateInvoice, recordPayment, fetchAdjustments, generateDue, cancelInvoice, deleteInvoice };
});
