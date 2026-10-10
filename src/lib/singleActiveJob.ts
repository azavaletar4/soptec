import type { JobType } from '@/types/domain';

/**
 * Fase 137 — un tecnico solo puede tener un ticket/alta/rutina en ejecucion
 * a la vez (ver migracion 20261010140000, trigger enforce_single_active_job).
 * Este archivo solo arma textos/links para el frontend; la regla real la
 * impone el trigger en Postgres, nunca este codigo.
 */

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  ticket: 'Avería',
  installation: 'Alta',
  routine: 'Rutina',
};

export interface ActiveJobRef {
  jobType: JobType;
  id: string;
  /** ticket_number/routine_number — null en una instalacion (no tiene numero propio). */
  number: string | null;
}

export function activeJobMessage(ref: ActiveJobRef): string {
  const numero = ref.number ? `#${ref.number}` : `#${ref.id.slice(0, 8)}`;
  return `Tienes una atención activa de tipo ${JOB_TYPE_LABEL[ref.jobType]}, ticket ${numero}. Debes finalizarla antes de iniciar otra atención.`;
}

export function soporteJobPath(ref: ActiveJobRef): string {
  if (ref.jobType === 'ticket') return `/soporte/${ref.id}`;
  if (ref.jobType === 'installation') return `/soporte/instalaciones/${ref.id}`;
  return `/soporte/rutinas/${ref.id}`;
}

export function campoJobPath(ref: ActiveJobRef): string {
  return `/campo/${ref.jobType}/${ref.id}`;
}

/**
 * El trigger enforce_single_active_job deja "job_type:job_id" en el HINT de
 * la excepcion — unico caso en que esto hace falta es la carrera real entre
 * 2 dispositivos (el chequeo proactivo del frontend ya evita el resto).
 */
export function parseActiveJobHint(hint: string | null | undefined): { jobType: JobType; id: string } | null {
  if (!hint) return null;
  const [jobType, id] = hint.split(':');
  if ((jobType === 'ticket' || jobType === 'installation' || jobType === 'routine') && id) return { jobType, id };
  return null;
}
