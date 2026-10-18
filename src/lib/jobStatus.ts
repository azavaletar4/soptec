import type { JobType } from '@/types/domain';

/**
 * Estados "activos" (todavia sin liquidar) por tipo de orden — fuente unica,
 * reusada por useUnifiedJobs.ts (Fase 107) y por src/lib/technicianDispatchStatus.ts.
 * Vive en src/lib (sin dependencias de Pinia/Supabase) para que ambos
 * consumidores, incluidas las pruebas unitarias puras, puedan importarla.
 */
export const ACTIVE_STATUS: Record<JobType, string[]> = {
  ticket: ['open', 'in_progress', 'rescheduled'],
  installation: ['pending', 'scheduled', 'in_progress'],
  routine: ['pending', 'scheduled', 'in_progress'],
};
