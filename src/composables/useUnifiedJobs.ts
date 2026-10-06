import { computed } from 'vue';
import { useTicketsStore } from '@/stores/tickets';
import { useInstallationsStore } from '@/stores/installations';
import { useRoutinesStore } from '@/stores/routines';
import type { Installation, JobType, Routine, Ticket, TicketPriority } from '@/types/domain';

/**
 * Cruza Tickets (averias) + Installations (altas) + Routines en una sola
 * forma comun (Fase 107) — usado por "Operaciones de Hoy" y "Historico de
 * Atendidos". DispatchBoardView.vue (Fase 101-B) NO se migra a esto: ya
 * tiene su propio cruce funcionando, tocarlo sin necesidad concreta no
 * vale el riesgo (refactor gradual, no big-bang).
 */
export interface UnifiedJob {
  id: string;
  jobType: JobType;
  /** ticket_number / routine_number / null en una instalacion (no tiene numero propio). */
  number: string | null;
  label: string;
  status: string;
  /** Fase 108: las 3 tablas (tickets/installations/routines) tienen su propia columna priority. */
  priority: TicketPriority;
  assignedId: string | null;
  assignedName: string | null;
  scheduledStartAt: string | null;
  /** Fecha a mostrar cuando no hay scheduled_start_at. */
  fallbackDate: string;
  createdAt: string;
  /** Fecha en que se liquido (resolved_at/closed_at/completed_at) — null si todavia esta activa. */
  finishedAt: string | null;
  raw: Ticket | Installation | Routine;
}

const ACTIVE_STATUS: Record<JobType, string[]> = {
  ticket: ['open', 'in_progress', 'rescheduled'],
  installation: ['pending', 'scheduled'],
  routine: ['pending', 'scheduled', 'in_progress'],
};

// Traduccion de estado para "Operaciones de Hoy"/"Historico de Atendidos"
// (Fase 107/108) — los 3 tipos juntos solo usan 9 valores en total y
// ninguno se repite con significado distinto entre tipos, asi que un solo
// mapa plano alcanza (antes se mostraba el valor crudo en ingles: 'open',
// 'pending', etc).
export const JOB_STATUS_LABEL: Record<string, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
  rescheduled: 'Reprogramado',
  pending: 'Pendiente',
  scheduled: 'Programado',
  completed: 'Completado',
  cancelled: 'Cancelado',
};
export const JOB_STATUS_CLASS: Record<string, string> = {
  open: 'bg-yellow-500/15 text-yellow-600',
  in_progress: 'bg-sky-500/15 text-sky-700',
  resolved: 'bg-green-500/15 text-green-600',
  closed: 'bg-slate-500/15 text-slate-600',
  rescheduled: 'bg-red-500/15 text-red-700',
  pending: 'bg-yellow-500/15 text-yellow-600',
  scheduled: 'bg-sky-500/15 text-sky-700',
  completed: 'bg-green-500/15 text-green-600',
  cancelled: 'bg-slate-500/15 text-slate-600',
};

export function useUnifiedJobs() {
  const ticketsStore = useTicketsStore();
  const installationsStore = useInstallationsStore();
  const routinesStore = useRoutinesStore();

  const allJobs = computed<UnifiedJob[]>(() => {
    const tickets = ticketsStore.tickets.map<UnifiedJob>((t) => ({
      id: t.id,
      jobType: 'ticket',
      number: t.ticket_number,
      label: t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : t.title,
      status: t.status,
      priority: t.priority,
      assignedId: t.assigned_to,
      assignedName: t.assigned_profile?.full_name || t.assigned_profile?.email || null,
      scheduledStartAt: t.scheduled_start_at,
      fallbackDate: t.created_at.slice(0, 10),
      createdAt: t.created_at,
      finishedAt: t.resolved_at ?? t.closed_at,
      raw: t,
    }));
    const installations = installationsStore.installations
      .filter((i) => i.status !== 'cancelled')
      .map<UnifiedJob>((i) => ({
        id: i.id,
        jobType: 'installation',
        number: null,
        label: i.clients ? `${i.clients.first_name} ${i.clients.last_name}` : 'Instalación',
        status: i.status,
        priority: i.priority,
        assignedId: i.assigned_to,
        assignedName: i.assigned_profile?.full_name || i.assigned_profile?.email || null,
        scheduledStartAt: i.scheduled_start_at,
        fallbackDate: (i.scheduled_date ?? i.created_at).slice(0, 10),
        createdAt: i.created_at,
        finishedAt: i.completed_at,
        raw: i,
      }));
    const routines = routinesStore.routines
      .filter((r) => r.status !== 'cancelled')
      .map<UnifiedJob>((r) => ({
        id: r.id,
        jobType: 'routine',
        number: r.routine_number,
        label: r.clients ? `${r.clients.first_name} ${r.clients.last_name}` : r.title,
        status: r.status,
        priority: r.priority,
        assignedId: r.assigned_to,
        assignedName: r.assigned_profile?.full_name || r.assigned_profile?.email || null,
        scheduledStartAt: r.scheduled_start_at,
        fallbackDate: (r.scheduled_date ?? r.created_at).slice(0, 10),
        createdAt: r.created_at,
        finishedAt: r.completed_at,
        raw: r,
      }));
    return [...tickets, ...installations, ...routines];
  });

  const activeJobs = computed(() => allJobs.value.filter((j) => ACTIVE_STATUS[j.jobType].includes(j.status)));
  const finishedJobs = computed(() => allJobs.value.filter((j) => !ACTIVE_STATUS[j.jobType].includes(j.status)));

  return { ticketsStore, installationsStore, routinesStore, allJobs, activeJobs, finishedJobs };
}
