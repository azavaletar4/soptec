import { supabase } from '@/lib/supabase';

/**
 * Chequeo de choque de horario (Fase 131) al asignar Técnico + Turno en
 * Tickets/Instalaciones/Rutinas — mismo criterio de "overlap" que ya usaba
 * el Cronograma de Campo (DispatchBoardView.vue, Fase 101-B) para reagendar,
 * pero consultando la BD fresca en vez de los stores de Pinia: el modal de
 * "Nuevo ticket" puede abrirse sin que Instalaciones/Rutinas se hayan
 * cargado todavía, y el chequeo necesita ver las 3 tablas igual.
 */
export type ScheduleJobType = 'ticket' | 'installation' | 'routine';

export interface ScheduleConflict {
  jobType: ScheduleJobType;
  label: string;
  startIso: string;
  endIso: string;
}

const JOB_LABEL: Record<ScheduleJobType, { article: string; noun: string; participle: string }> = {
  ticket: { article: 'un', noun: 'ticket', participle: 'asignado' },
  installation: { article: 'una', noun: 'instalación', participle: 'asignada' },
  routine: { article: 'una', noun: 'rutina', participle: 'asignada' },
};

/** Margen de "tiempo de traslado" entre una orden y otra del mismo tecnico: dos bloques de turno contiguos (ej. 08-10 y 10-12) no se solapan en el sentido estricto, pero tampoco le dan tiempo de llegar — se cuentan igual como choque. */
const CONFLICT_BUFFER_MS = 60 * 60 * 1000;

export function scheduleOverlaps(aStartMs: number, aEndMs: number, bStartMs: number, bEndMs: number): boolean {
  return aStartMs - CONFLICT_BUFFER_MS < bEndMs && bStartMs - CONFLICT_BUFFER_MS < aEndMs;
}

/** Busca si el tecnico ya tiene algo agendado dentro de +/-1h de [startIso, endIso) — excluye el propio job si se esta editando uno existente. */
export async function findScheduleConflict(
  technicianId: string,
  startIso: string,
  endIso: string,
  exclude?: { jobType: ScheduleJobType; id: string },
): Promise<ScheduleConflict | null> {
  const dateStr = startIso.slice(0, 10);
  const dayStart = `${dateStr}T00:00:00`;
  const dayEnd = `${dateStr}T23:59:59`;

  const [ticketsRes, installationsRes, routinesRes] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, title, clients(first_name, last_name), scheduled_start_at, scheduled_end_at')
      .eq('assigned_to', technicianId)
      .not('scheduled_start_at', 'is', null)
      .gte('scheduled_start_at', dayStart)
      .lte('scheduled_start_at', dayEnd),
    supabase
      .from('installations')
      .select('id, clients(first_name, last_name), scheduled_start_at, scheduled_end_at')
      .eq('assigned_to', technicianId)
      .not('scheduled_start_at', 'is', null)
      .gte('scheduled_start_at', dayStart)
      .lte('scheduled_start_at', dayEnd),
    supabase
      .from('routines')
      .select('id, title, scheduled_start_at, scheduled_end_at')
      .eq('assigned_to', technicianId)
      .not('scheduled_start_at', 'is', null)
      .gte('scheduled_start_at', dayStart)
      .lte('scheduled_start_at', dayEnd),
  ]);

  type Row = { id: string; scheduled_start_at: string | null; scheduled_end_at: string | null };
  const candidates: (ScheduleConflict & { id: string })[] = [
    ...(
      (ticketsRes.data ?? []) as unknown as (Row & { title: string; clients: { first_name: string; last_name: string } | null })[]
    ).map((t) => ({
      id: t.id,
      jobType: 'ticket' as const,
      label: t.clients ? `${t.clients.first_name} ${t.clients.last_name}` : t.title,
      startIso: t.scheduled_start_at!,
      endIso: t.scheduled_end_at!,
    })),
    ...(
      (installationsRes.data ?? []) as unknown as (Row & { clients: { first_name: string; last_name: string } | null })[]
    ).map((i) => ({
      id: i.id,
      jobType: 'installation' as const,
      label: i.clients ? `${i.clients.first_name} ${i.clients.last_name}` : 'Instalación',
      startIso: i.scheduled_start_at!,
      endIso: i.scheduled_end_at!,
    })),
    ...((routinesRes.data ?? []) as unknown as (Row & { title: string })[]).map((r) => ({
      id: r.id,
      jobType: 'routine' as const,
      label: r.title,
      startIso: r.scheduled_start_at!,
      endIso: r.scheduled_end_at!,
    })),
  ];

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const hit = candidates.find((c) => {
    if (exclude && c.jobType === exclude.jobType && c.id === exclude.id) return false;
    return scheduleOverlaps(startMs, endMs, new Date(c.startIso).getTime(), new Date(c.endIso).getTime());
  });
  return hit ?? null;
}

export function conflictConfirmMessage(technicianName: string, conflict: ScheduleConflict): string {
  const hora = new Date(conflict.startIso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  const job = JOB_LABEL[conflict.jobType];
  return `El técnico ${technicianName} ya tiene ${job.participle} ${job.article} ${job.noun} ("${conflict.label}") a las ${hora}. ¿Confirmar asignación simultánea?`;
}
