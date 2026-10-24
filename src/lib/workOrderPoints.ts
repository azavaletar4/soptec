export function requireWorkOrderPoints(value: unknown, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(integer ? 'Ingresa puntos enteros mayores a 0.' : 'Ingresa puntos mayores a 0.');
  }
  return value;
}

export function pointsAreEditable(status: string): boolean {
  return ['open', 'pending', 'scheduled', 'assigned', 'in_progress', 'rescheduled'].includes(status);
}

export interface PointReviewCrew { technicianId: string; name: string; role: string }
export interface PointConfirmation {
  id: string; points: number; crew: PointReviewCrew[]; confirmed_by: string;
  confirmed_at: string; invalidated_at: string | null; invalidation_reason: string | null;
}
export interface WorkOrderPointReview {
  points: number | null; status: string; technicalCompletedAt: string | null;
  historical: boolean; finished: boolean; crew: PointReviewCrew[]; token: string;
  confirmation: PointConfirmation | null; lastConfirmation: PointConfirmation | null;
}

/** El selector del reporte entrega horas sin zona. Conservar históricos;
 * desde noviembre los puntos oficiales usan el calendario de Lima. */
export function pointReportInstant(iso: string): string {
  return iso.slice(0, 10) >= '2026-11-01' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(iso)
    ? `${iso}-05:00` : iso;
}
