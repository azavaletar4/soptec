import type { AsistenciaEstado, CompanySettings } from '@/types/domain';

/**
 * Helpers de SOLO visualizacion para el modulo de Asistencia (Fase 117) —
 * los calculos que de verdad importan (tardanza, exceso de almuerzo, fuera
 * de geocerca) los hace el servidor dentro de las funciones mark_attendance_*
 * (ver la migracion), nunca el cliente. Esto solo arma textos/estados para
 * que la pantalla no quede en blanco mientras no hay marcacion.
 */

/** 0 = domingo ... 6 = sabado, en hora de Peru (America/Lima) — mismo criterio que el servidor. */
export function diaSemanaLima(date = new Date()): number {
  const lima = new Date(date.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return lima.getDay();
}

export function fechaLimaISO(date = new Date()): string {
  const lima = new Date(date.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const yyyy = lima.getFullYear();
  const mm = String(lima.getMonth() + 1).padStart(2, '0');
  const dd = String(lima.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function esDiaLaborable(dow: number, feriadosHoy: boolean): boolean {
  return dow !== 0 && !feriadosHoy;
}

/** "7:30 AM" / "8:00 AM" segun el dia, a partir de company_settings (HH:MM:SS). */
export function horaIngresoEsperadaLabel(settings: Pick<CompanySettings, 'lunes_hora_ingreso' | 'resto_hora_ingreso'>, dow: number): string {
  const raw = dow === 1 ? settings.lunes_hora_ingreso : settings.resto_hora_ingreso;
  const [h, m] = raw.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const ESTADO_BADGE_CLASS: Record<AsistenciaEstado, string> = {
  Puntual: 'bg-green-500/15 text-green-600',
  Tardanza: 'bg-amber-500/15 text-amber-700',
  'En Almuerzo': 'bg-sky-500/15 text-sky-700',
  Finalizado: 'bg-slate-500/15 text-slate-600',
  Falta: 'bg-red-500/15 text-red-600',
};

export function formatHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

/** Fechas ISO (YYYY-MM-DD) laborables entre desde/hasta inclusive — excluye domingos y feriados, usado para calcular faltas del reporte mensual. */
export function diasLaborablesEnRango(desde: string, hasta: string, feriadosSet: Set<string>): string[] {
  const dias: string[] = [];
  const cursor = new Date(`${desde}T00:00:00`);
  const fin = new Date(`${hasta}T00:00:00`);
  while (cursor <= fin) {
    const iso = cursor.toISOString().slice(0, 10);
    if (cursor.getDay() !== 0 && !feriadosSet.has(iso)) dias.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

export function formatMinutos(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}
