import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { useCatalogsStore } from './catalogs';
import type { JobType, TicketPriority } from '@/types/domain';

export interface ScheduleAlertNotification {
  key: string;
  jobType: JobType;
  label: string;
  technicianName: string;
  priority: TicketPriority;
  scheduledStartAt: string;
}

const MAX_ALERTS = 20;
const TOAST_DURATION_MS = 8000;

interface RawRow {
  id: string;
  title?: string | null;
  client_id?: string | null;
  assigned_to: string | null;
  priority: TicketPriority;
  scheduled_start_at: string;
  alerta_enviada: boolean;
}

/**
 * Fase 132 — alerta preventiva 30 min antes de la hora programada, lado
 * Panel Web: campana + toast. Se entera en vivo via Supabase Realtime de
 * cuando el backend (scheduleAlertScheduler.ts) marca alerta_enviada=true
 * en tickets/instalaciones/rutinas — no hace polling propio. Un solo canal
 * compartido para las 3 tablas, con el mismo patron ref-counted que
 * subscribeToStaffTelemetry (catalogs.ts, Fase 115).
 */
export const useScheduleAlertsStore = defineStore('scheduleAlerts', () => {
  const alerts = ref<ScheduleAlertNotification[]>([]);
  const unreadCount = ref(0);
  // Toasts propios (no el useToast() global de ToastHost) — el pedido es que
  // esta alerta puntual aparezca arriba a la derecha, pegada a la campana;
  // el resto de la app (Guardado/Error, etc.) sigue abajo a la derecha tal
  // cual, sin tocar ese componente compartido.
  const toasts = ref<ScheduleAlertNotification[]>([]);

  function dismissToast(key: string) {
    const idx = toasts.value.findIndex((t) => t.key === key);
    if (idx !== -1) toasts.value.splice(idx, 1);
  }

  const seen = new Set<string>();
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let subscribers = 0;

  async function resolveLabel(jobType: JobType, row: RawRow): Promise<string> {
    if (jobType === 'routine') return row.title || 'Rutina';
    if (!row.client_id) return jobType === 'ticket' ? row.title || 'Ticket' : 'Instalación';
    const { data } = await supabase.from('clients').select('first_name, last_name').eq('id', row.client_id).maybeSingle();
    return data ? `${data.first_name} ${data.last_name}` : jobType === 'ticket' ? row.title || 'Ticket' : 'Instalación';
  }

  async function handleRow(jobType: JobType, row: RawRow) {
    if (!row.alerta_enviada || !row.scheduled_start_at) return;
    const key = `${jobType}:${row.id}`;
    if (seen.has(key)) return;
    seen.add(key);

    const catalogsStore = useCatalogsStore();
    if (!catalogsStore.staff.length) await catalogsStore.fetchStaff().catch(() => undefined);
    const tech = catalogsStore.staff.find((s) => s.id === row.assigned_to);
    const technicianName = tech?.full_name || tech?.email || 'Sin asignar';
    const label = await resolveLabel(jobType, row);

    const notification: ScheduleAlertNotification = {
      key,
      jobType,
      label,
      technicianName,
      priority: row.priority,
      scheduledStartAt: row.scheduled_start_at,
    };
    alerts.value.unshift(notification);
    if (alerts.value.length > MAX_ALERTS) alerts.value.length = MAX_ALERTS;
    unreadCount.value += 1;

    toasts.value.unshift(notification);
    setTimeout(() => dismissToast(notification.key), TOAST_DURATION_MS);
  }

  function subscribe() {
    subscribers += 1;
    if (channel) return;
    channel = supabase
      .channel('schedule-alerts')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, (payload) =>
        void handleRow('ticket', payload.new as RawRow),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'installations' }, (payload) =>
        void handleRow('installation', payload.new as RawRow),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'routines' }, (payload) =>
        void handleRow('routine', payload.new as RawRow),
      )
      .subscribe();
  }

  function unsubscribe() {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0 && channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  }

  function markAllRead() {
    unreadCount.value = 0;
  }

  return { alerts, unreadCount, toasts, dismissToast, subscribe, unsubscribe, markAllRead };
});
