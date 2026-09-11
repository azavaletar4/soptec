import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Invoice } from '@/types/domain';

const INVOICE_SELECT =
  '*, clients(id, first_name, last_name, document_number), service_contracts(id, contract_number)';

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

  async function markPaid(id: string, paymentMethod: string) {
    const { data, error: err } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: paymentMethod })
      .eq('id', id)
      .select(INVOICE_SELECT)
      .single();
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

  return { invoices, loading, error, fetchInvoices, fetchInvoicesByClient, createInvoice, markPaid, cancelInvoice };
});
