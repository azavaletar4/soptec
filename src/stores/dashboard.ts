import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import type { ClientStatus, TicketStatus } from '@/types/domain';

export interface NetworkStatusGroup {
  total: number;
  ok: number;
  down: number;
  untested: number;
}

export interface NetworkStatus {
  olt: NetworkStatusGroup;
  mikrotik: NetworkStatusGroup;
  problems: { kind: string; name: string; host: string }[];
}

export interface RecentClient {
  id: string;
  first_name: string;
  last_name: string;
  status: ClientStatus;
  created_at: string;
}

export interface RecentTicket {
  id: string;
  ticket_number: string | null;
  title: string;
  status: TicketStatus;
  created_at: string;
  clients: { first_name: string; last_name: string } | null;
}

export interface MonthlyRevenue {
  month: string;
  billed: number;
  collected: number;
}

export interface OltAggregateSummary {
  unconfigured: number;
  online: number;
  offline: number;
  lowSignal: number;
  deviceCount: number;
  scanComplete: boolean;
  checkedAt: string;
}

export interface DashboardSummary {
  clients: { active: number; suspended: number; prospect: number; retired: number };
  activeContracts: number;
  network: NetworkStatus;
  oltSummary: OltAggregateSummary;
  recentClients: RecentClient[];
  tickets: { open: number; inProgress: number; urgent: number; recent: RecentTicket[] };
  billing: {
    pendingTotal: number;
    pendingCount: number;
    overdueCount: number;
    billedThisMonth: number;
    collectedThisMonth: number;
    collectedToday: number;
    uncollectedThisMonth: number;
    collectionRate: number;
    monthly: MonthlyRevenue[];
  };
}

async function countClients(status: ClientStatus): Promise<number> {
  const { count } = await supabase.from('clients').select('*', { count: 'exact', head: true }).eq('status', status);
  return count ?? 0;
}

async function countTickets(status: TicketStatus): Promise<number> {
  const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('status', status);
  return count ?? 0;
}

async function countUrgentTickets(): Promise<number> {
  const { count } = await supabase
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .eq('priority', 'urgent')
    .not('status', 'in', '(resolved,closed)');
  return count ?? 0;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function firstOfMonthIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
function monthsAgoIso(n: number) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - n, 1).toISOString();
}
function monthKey(iso: string) {
  return iso.slice(0, 7);
}
const MONTH_LABEL = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function buildMonthlyRevenue(
  billedRows: { amount: number; created_at: string }[],
  collectedRows: { amount: number; paid_at: string }[],
): MonthlyRevenue[] {
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTH_LABEL[d.getMonth()] });
  }
  return months.map(({ key, label }) => ({
    month: label,
    billed: billedRows.filter((r) => monthKey(r.created_at) === key).reduce((s, r) => s + Number(r.amount), 0),
    collected: collectedRows.filter((r) => monthKey(r.paid_at) === key).reduce((s, r) => s + Number(r.amount), 0),
  }));
}

export const useDashboardStore = defineStore('dashboard', () => {
  const summary = ref<DashboardSummary | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastUpdated = ref<Date | null>(null);

  async function fetchSummary() {
    loading.value = true;
    error.value = null;
    try {
      const [
        active,
        suspended,
        prospect,
        retired,
        contractsRes,
        network,
        oltSummary,
        recentRes,
        openTickets,
        inProgressTickets,
        urgentTickets,
        recentTicketsRes,
        pendingInvoicesRes,
        billedThisMonthRes,
        paidThisMonthRes,
        paidTodayRes,
        billedLast6moRes,
        paidLast6moRes,
      ] = await Promise.all([
        countClients('active'),
        countClients('suspended'),
        countClients('prospect'),
        countClients('retired'),
        supabase.from('service_contracts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        apiFetch<NetworkStatus>('/api/dashboard/network-status'),
        apiFetch<OltAggregateSummary>('/api/dashboard/olt-summary'),
        supabase
          .from('clients')
          .select('id, first_name, last_name, status, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
        countTickets('open'),
        countTickets('in_progress'),
        countUrgentTickets(),
        supabase
          .from('tickets')
          .select('id, ticket_number, title, status, created_at, clients(first_name, last_name)')
          .not('status', 'in', '(resolved,closed)')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase.from('invoices').select('amount, due_date').eq('status', 'pending'),
        supabase.from('invoices').select('amount, status').neq('status', 'cancelled').gte('created_at', firstOfMonthIso()),
        supabase.from('invoices').select('amount').eq('status', 'paid').gte('paid_at', firstOfMonthIso()),
        supabase.from('invoices').select('amount').eq('status', 'paid').gte('paid_at', startOfTodayIso()),
        supabase.from('invoices').select('amount, created_at').neq('status', 'cancelled').gte('created_at', monthsAgoIso(5)),
        supabase.from('invoices').select('amount, paid_at').eq('status', 'paid').gte('paid_at', monthsAgoIso(5)),
      ]);

      const pendingInvoices = (pendingInvoicesRes.data ?? []) as { amount: number; due_date: string }[];
      const billedThisMonthRows = (billedThisMonthRes.data ?? []) as { amount: number; status: string }[];
      const paidThisMonth = (paidThisMonthRes.data ?? []) as { amount: number }[];
      const paidToday = (paidTodayRes.data ?? []) as { amount: number }[];
      const billedLast6mo = (billedLast6moRes.data ?? []) as { amount: number; created_at: string }[];
      const paidLast6mo = (paidLast6moRes.data ?? []) as { amount: number; paid_at: string }[];

      const billedThisMonth = billedThisMonthRows.reduce((s, r) => s + Number(r.amount), 0);
      const collectedThisMonth = paidThisMonth.reduce((s, r) => s + Number(r.amount), 0);

      summary.value = {
        clients: { active, suspended, prospect, retired },
        activeContracts: contractsRes.count ?? 0,
        network,
        oltSummary,
        recentClients: (recentRes.data ?? []) as RecentClient[],
        tickets: {
          open: openTickets,
          inProgress: inProgressTickets,
          urgent: urgentTickets,
          recent: (recentTicketsRes.data ?? []) as unknown as RecentTicket[],
        },
        billing: {
          pendingTotal: pendingInvoices.reduce((sum, i) => sum + Number(i.amount), 0),
          pendingCount: pendingInvoices.length,
          overdueCount: pendingInvoices.filter((i) => i.due_date < todayIso()).length,
          billedThisMonth,
          collectedThisMonth,
          collectedToday: paidToday.reduce((s, r) => s + Number(r.amount), 0),
          uncollectedThisMonth: billedThisMonthRows
            .filter((r) => r.status === 'pending')
            .reduce((s, r) => s + Number(r.amount), 0),
          collectionRate: billedThisMonth > 0 ? (collectedThisMonth / billedThisMonth) * 100 : 0,
          monthly: buildMonthlyRevenue(billedLast6mo, paidLast6mo),
        },
      };
      lastUpdated.value = new Date();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al cargar el dashboard';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return { summary, loading, error, lastUpdated, fetchSummary };
});
