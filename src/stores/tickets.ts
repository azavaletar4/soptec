import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { Ticket, TicketComment, TicketPriority, TicketStatus } from '@/types/domain';

const TICKET_SELECT =
  '*, clients(id, first_name, last_name, phone), assigned_profile:profiles!tickets_assigned_to_fkey(id, full_name, email)';

const COMMENT_SELECT = '*, author:profiles!ticket_comments_author_id_fkey(id, full_name, email)';

export const useTicketsStore = defineStore('tickets', () => {
  const tickets = ref<Ticket[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchTickets() {
    loading.value = true;
    error.value = null;
    const { data, error: err } = await supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .order('created_at', { ascending: false });
    loading.value = false;
    if (err) {
      error.value = err.message;
      throw err;
    }
    tickets.value = (data ?? []) as unknown as Ticket[];
  }

  async function fetchTicketsByClient(clientId: string) {
    const { data, error: err } = await supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as Ticket[];
  }

  /** Tickets asociados a UN servicio/contrato puntual (Fase 37). */
  async function fetchTicketsByContract(contractId: string) {
    const { data, error: err } = await supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .eq('contract_id', contractId)
      .order('created_at', { ascending: false });
    if (err) throw err;
    return (data ?? []) as unknown as Ticket[];
  }

  async function createTicket(payload: Partial<Ticket>) {
    const { data, error: err } = await supabase.from('tickets').insert(payload).select(TICKET_SELECT).single();
    if (err) throw err;
    tickets.value.unshift(data as unknown as Ticket);
    return data as unknown as Ticket;
  }

  async function updateTicket(id: string, payload: Partial<Ticket>) {
    const { data, error: err } = await supabase
      .from('tickets')
      .update(payload)
      .eq('id', id)
      .select(TICKET_SELECT)
      .single();
    if (err) throw err;
    const idx = tickets.value.findIndex((t) => t.id === id);
    if (idx !== -1) tickets.value[idx] = data as unknown as Ticket;
    return data as unknown as Ticket;
  }

  async function updateTicketStatus(id: string, status: TicketStatus) {
    return updateTicket(id, { status });
  }

  async function updateTicketPriority(id: string, priority: TicketPriority) {
    return updateTicket(id, { priority });
  }

  async function assignTicket(id: string, assignedTo: string | null) {
    return updateTicket(id, { assigned_to: assignedTo });
  }

  async function assignTechnician(id: string, assignedTo: string | null, points: number | null) {
    return updateTicket(id, { assigned_to: assignedTo, points });
  }

  /**
   * Borra un ticket (limpieza de tickets de prueba). Si tenia materiales
   * (egresos de inventory_movements) registrados, primero los devuelve a
   * bodega con un ingreso compensatorio — el Kardex original se conserva
   * (ticket_id queda en null solo, via ON DELETE SET NULL) y el stock no
   * se pierde. Solo SUPERADMIN/ADMIN (RLS lo exige, ver Fase 26).
   */
  async function deleteTicket(id: string) {
    const ticket = tickets.value.find((t) => t.id === id);

    const { data: movements, error: movErr } = await supabase
      .from('inventory_movements')
      .select('product_id, quantity')
      .eq('ticket_id', id)
      .eq('movement_type', 'egreso');
    if (movErr) throw movErr;

    for (const m of movements ?? []) {
      const { error: retErr } = await supabase.from('inventory_movements').insert({
        product_id: m.product_id,
        movement_type: 'ingreso',
        quantity: m.quantity,
        reason: `Devolucion por eliminacion del ticket ${ticket?.ticket_number ?? id}`,
      });
      if (retErr) throw retErr;
    }

    const { error: delErr } = await supabase.from('tickets').delete().eq('id', id);
    if (delErr) throw delErr;

    tickets.value = tickets.value.filter((t) => t.id !== id);
    return { materialsReturned: movements?.length ?? 0 };
  }

  async function fetchComments(ticketId: string) {
    const { data, error: err } = await supabase
      .from('ticket_comments')
      .select(COMMENT_SELECT)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (err) throw err;
    return (data ?? []) as unknown as TicketComment[];
  }

  async function addComment(ticketId: string, body: string) {
    const { data, error: err } = await supabase
      .from('ticket_comments')
      .insert({ ticket_id: ticketId, body })
      .select(COMMENT_SELECT)
      .single();
    if (err) throw err;
    return data as unknown as TicketComment;
  }

  return {
    tickets,
    loading,
    error,
    fetchTickets,
    fetchTicketsByClient,
    fetchTicketsByContract,
    createTicket,
    updateTicket,
    deleteTicket,
    updateTicketStatus,
    updateTicketPriority,
    assignTicket,
    assignTechnician,
    fetchComments,
    addComment,
  };
});
