import type { JobType } from '../types/domain';
import { ACTIVE_STATUS } from './jobStatus';

export interface DashboardJob {
  id: string;
  jobType: JobType;
  number: string | null;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  clients: { first_name: string; last_name: string } | null;
}

// Misma población que Soporte / Todas: sin filtro de fecha ni de técnico.
// La clave incluye el tipo: dos tablas pueden compartir UUID legítimamente.
export function summarizeDashboardSupport(rows: DashboardJob[]) {
  const jobs = [...new Map(rows.filter(row => ACTIVE_STATUS[row.jobType].includes(row.status))
    .map(row => [`${row.jobType}:${row.id}`, row])).values()];
  return {
    open: jobs.filter(row => row.status !== 'in_progress').length,
    inProgress: jobs.filter(row => row.status === 'in_progress').length,
    urgent: jobs.filter(row => row.priority === 'urgent').length,
    recent: jobs.sort((a, b) => b.created_at.localeCompare(a.created_at)
      || `${a.jobType}:${a.id}`.localeCompare(`${b.jobType}:${b.id}`)).slice(0, 5),
  };
}
