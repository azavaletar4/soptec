export interface PointContribution {
  jobType: 'installation' | 'ticket' | 'routine';
  jobId: string;
  reference?: string | null;
  occurredAt: string;
  kind: 'work' | 'recurrence';
  crewSize: number;
  points: number;
}
export interface FieldProgress {
  asOf: string;
  timezone: 'America/Lima';
  periods: Record<'today' | 'week' | 'month', { start: string; end: string; points: number }>;
  contributions: PointContribution[];
}
export const pointNumber = (points: number) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 4 }).format(points);
export const peruDate = (date: string) => new Date(date).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short' });

export function contributionsInPeriod(data: FieldProgress, key: 'today' | 'week' | 'month') {
  const period = data.periods[key];
  return data.contributions.filter(e => Date.parse(e.occurredAt) >= Date.parse(period.start) && Date.parse(e.occurredAt) < Date.parse(period.end));
}
