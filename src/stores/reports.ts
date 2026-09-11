import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { ClientStatus, InvoiceStatus, TicketCategory, TicketPriority, TicketStatus } from '@/types/domain';

// Reportes calculados en el cliente (select + reduce en JS): a la escala de
// un solo ISP (cientos/pocos miles de filas) es mas simple que armar vistas
// SQL de agregacion, y sigue el mismo patron ya usado en installations.ts,
// inventory.ts, etc. (fetch directo via supabase-js, sin backend).

export interface ClientReport {
  totalsByStatus: Record<ClientStatus, number>;
  newInPeriod: number;
  byZone: { zoneName: string; count: number }[];
}

export interface FinancialReport {
  invoiced: number;
  collected: number;
  pending: number;
  overdue: number;
  invoiceCount: number;
}

export interface TicketReport {
  totalInPeriod: number;
  byStatus: Record<TicketStatus, number>;
  byCategory: Record<TicketCategory, number>;
  byPriority: Record<TicketPriority, number>;
  avgResolutionHours: number | null;
  technicianRanking: { staffId: string; name: string; ticketCount: number; points: number }[];
}

const EMPTY_CLIENT_STATUS: Record<ClientStatus, number> = { active: 0, suspended: 0, prospect: 0, retired: 0 };
const EMPTY_TICKET_STATUS: Record<TicketStatus, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
const EMPTY_TICKET_CATEGORY: Record<TicketCategory, number> = {
  no_service: 0,
  slow_speed: 0,
  billing: 0,
  installation: 0,
  equipment: 0,
  other: 0,
};
const EMPTY_TICKET_PRIORITY: Record<TicketPriority, number> = { low: 0, medium: 0, high: 0, urgent: 0 };

export const useReportsStore = defineStore('reports', () => {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchClientReport(fromIso: string, toIso: string): Promise<ClientReport> {
    const { data, error: err } = await supabase.from('clients').select('id, status, created_at, zones(name)');
    if (err) throw err;
    const rows = (data ?? []) as unknown as { id: string; status: ClientStatus; created_at: string; zones: { name: string } | null }[];

    const totalsByStatus = { ...EMPTY_CLIENT_STATUS };
    let newInPeriod = 0;
    const zoneCounts = new Map<string, number>();
    for (const c of rows) {
      totalsByStatus[c.status] += 1;
      if (c.created_at >= fromIso && c.created_at <= toIso) newInPeriod += 1;
      if (c.status === 'active') {
        const zoneName = c.zones?.name ?? 'Sin zona';
        zoneCounts.set(zoneName, (zoneCounts.get(zoneName) ?? 0) + 1);
      }
    }
    const byZone = [...zoneCounts.entries()]
      .map(([zoneName, count]) => ({ zoneName, count }))
      .sort((a, b) => b.count - a.count);
    return { totalsByStatus, newInPeriod, byZone };
  }

  async function fetchFinancialReport(fromDate: string, toDate: string): Promise<FinancialReport> {
    const { data, error: err } = await supabase
      .from('invoices')
      .select('amount, status, due_date')
      .gte('period_start', fromDate)
      .lte('period_start', toDate);
    if (err) throw err;
    const rows = (data ?? []) as { amount: number; status: InvoiceStatus; due_date: string }[];

    const today = new Date().toISOString().slice(0, 10);
    let invoiced = 0;
    let collected = 0;
    let pending = 0;
    let overdue = 0;
    for (const inv of rows) {
      invoiced += inv.amount;
      if (inv.status === 'paid') collected += inv.amount;
      else if (inv.status === 'pending') {
        pending += inv.amount;
        if (inv.due_date < today) overdue += inv.amount;
      }
    }
    return { invoiced, collected, pending, overdue, invoiceCount: rows.length };
  }

  async function fetchTicketReport(fromIso: string, toIso: string): Promise<TicketReport> {
    const { data, error: err } = await supabase
      .from('tickets')
      .select(
        'id, status, category, priority, points, assigned_to, created_at, resolved_at, closed_at, assigned_profile:profiles!tickets_assigned_to_fkey(id, full_name, email)',
      )
      .gte('created_at', fromIso)
      .lte('created_at', toIso);
    if (err) throw err;
    const rows = (data ?? []) as unknown as {
      id: string;
      status: TicketStatus;
      category: TicketCategory;
      priority: TicketPriority;
      points: number | null;
      assigned_to: string | null;
      created_at: string;
      resolved_at: string | null;
      closed_at: string | null;
      assigned_profile: { id: string; full_name: string | null; email: string } | null;
    }[];

    const byStatus = { ...EMPTY_TICKET_STATUS };
    const byCategory = { ...EMPTY_TICKET_CATEGORY };
    const byPriority = { ...EMPTY_TICKET_PRIORITY };
    let resolutionHoursSum = 0;
    let resolutionCount = 0;
    const techMap = new Map<string, { name: string; ticketCount: number; points: number }>();

    for (const t of rows) {
      byStatus[t.status] += 1;
      byCategory[t.category] += 1;
      byPriority[t.priority] += 1;

      const finishedAt = t.resolved_at ?? t.closed_at;
      if (finishedAt) {
        const hours = (new Date(finishedAt).getTime() - new Date(t.created_at).getTime()) / 3_600_000;
        if (hours >= 0) {
          resolutionHoursSum += hours;
          resolutionCount += 1;
        }
      }

      if (t.assigned_to) {
        const existing = techMap.get(t.assigned_to);
        const name = t.assigned_profile?.full_name || t.assigned_profile?.email || 'Técnico';
        if (existing) {
          existing.ticketCount += 1;
          existing.points += t.points ?? 0;
        } else {
          techMap.set(t.assigned_to, { name, ticketCount: 1, points: t.points ?? 0 });
        }
      }
    }

    const technicianRanking = [...techMap.entries()]
      .map(([staffId, v]) => ({ staffId, ...v }))
      .sort((a, b) => b.points - a.points);

    return {
      totalInPeriod: rows.length,
      byStatus,
      byCategory,
      byPriority,
      avgResolutionHours: resolutionCount ? resolutionHoursSum / resolutionCount : null,
      technicianRanking,
    };
  }

  return { loading, error, fetchClientReport, fetchFinancialReport, fetchTicketReport };
});
