import { supabaseAdmin } from '../lib/supabaseAdmin';

// Fase 132: alerta preventiva 30 min antes de la hora programada —
// ver migracion fase132_alertas_preventivas_30min.sql para el porque de
// alerta_enviada/el trigger de reset. Esto solo hace la parte de "marcar":
// el Panel Web y la App de Campo se enteran via Realtime/refetch de que
// alerta_enviada paso a true, este archivo no les avisa directamente.

const ALERT_WINDOW_MINUTES = Number(process.env.SCHEDULE_ALERT_WINDOW_MINUTES ?? 30);

// Estados "todavia no atendido, ya tiene hora" por tipo de orden — un
// ticket nunca pasa por 'scheduled' (ese estado no existe en tickets, ver
// TicketStatus), se queda en 'open' (o 'rescheduled', Fase 102) hasta que
// alguien lo empieza.
const TICKET_STATUSES = ['open', 'rescheduled'];
const INSTALLATION_ROUTINE_STATUSES = ['pending', 'scheduled'];

export interface FlagScheduleAlertsResult {
  tickets: number;
  installations: number;
  routines: number;
}

async function flagTable(table: 'tickets' | 'installations' | 'routines', statuses: string[], windowEndIso: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('id')
    .in('status', statuses)
    .eq('alerta_enviada', false)
    .not('scheduled_start_at', 'is', null)
    .lte('scheduled_start_at', windowEndIso);
  if (error) throw new Error(`[${table}] ${error.message}`);
  const ids = (data ?? []).map((r) => r.id as string);
  if (!ids.length) return 0;

  const { error: updateErr } = await supabaseAdmin.from(table).update({ alerta_enviada: true }).in('id', ids);
  if (updateErr) throw new Error(`[${table}] update: ${updateErr.message}`);
  return ids.length;
}

/**
 * Marca alerta_enviada=true en tickets/instalaciones/rutinas cuya hora
 * programada cae dentro de los proximos ALERT_WINDOW_MINUTES minutos y que
 * todavia no se habian marcado. Idempotente: correrlo mas seguido solo
 * detecta mas rapido, nunca duplica (el filtro alerta_enviada=false lo evita).
 */
export async function flagUpcomingScheduleAlerts(): Promise<FlagScheduleAlertsResult> {
  const windowEndIso = new Date(Date.now() + ALERT_WINDOW_MINUTES * 60_000).toISOString();
  const [tickets, installations, routines] = await Promise.all([
    flagTable('tickets', TICKET_STATUSES, windowEndIso),
    flagTable('installations', INSTALLATION_ROUTINE_STATUSES, windowEndIso),
    flagTable('routines', INSTALLATION_ROUTINE_STATUSES, windowEndIso),
  ]);
  return { tickets, installations, routines };
}
