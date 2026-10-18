import { ACTIVE_STATUS } from './jobStatus';
import type { UnifiedJob } from '@/composables/useUnifiedJobs';

export type TechDispatchStatus = 'en_almuerzo' | 'en_atencion' | 'asignado' | 'disponible';

/** Orden activa (open/pending/scheduled/in_progress segun el tipo) que el tecnico TODAVIA no inicio. */
export function isJobNotStarted(job: UnifiedJob): boolean {
  return ACTIVE_STATUS[job.jobType].includes(job.status) && job.status !== 'in_progress';
}

export function isJobCompletedToday(job: UnifiedJob): boolean {
  if (job.jobType === 'ticket') return job.status === 'resolved' || job.status === 'closed';
  return job.status === 'completed';
}

/**
 * Estado a mostrar en "Técnicos activos" (TechnicianStatusBar.vue) para un
 * tecnico, a partir de SUS ordenes asignadas (averias/altas/rutinas).
 *
 * Corrige el caso real de Jairo Bernabe / RUT-2026-00071 (2026-10-18):
 * asignar una rutina con fecha/turno la deja en status 'scheduled' (nunca
 * 'in_progress' — nada en el flujo de asignacion toca eso), pero la version
 * anterior de esta tarjeta mostraba CUALQUIER orden activa sin 'in_progress'
 * como "En camino", como si el tecnico ya se hubiera desplazado o hubiera
 * iniciado. Ahora esa situacion es 'asignado' — distinto de 'en_atencion'
 * (orden realmente 'in_progress', iniciada por el propio tecnico).
 *
 * No existe un estado real de "en camino" en las tablas (no hay paso de
 * "aceptar"/"iniciar desplazamiento" separado de "iniciar atencion") — por
 * eso esta funcion no inventa uno, solo distingue asignado-sin-iniciar de
 * iniciado.
 */
export function resolveTechDispatchStatus(
  onLunch: boolean,
  assignedJobs: UnifiedJob[],
): { status: TechDispatchStatus; job: UnifiedJob | null } {
  // PRIORIDAD 1 (Fase 135): "En Almuerzo" manda sobre cualquier orden activa.
  if (onLunch) return { status: 'en_almuerzo', job: null };
  // PRIORIDAD 2: una orden realmente 'in_progress' manda sobre una asignada-sin-iniciar.
  const inProgress = assignedJobs.find((j) => j.status === 'in_progress');
  if (inProgress) return { status: 'en_atencion', job: inProgress };
  const notStarted = assignedJobs.find(isJobNotStarted);
  if (notStarted) return { status: 'asignado', job: notStarted };
  // PRIORIDAD 3: sin almuerzo y sin ninguna orden activa.
  return { status: 'disponible', job: null };
}
