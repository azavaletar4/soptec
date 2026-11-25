// Fase 7C — ciclo de facturación comercial (pago adelantado / pago cumplido).
// Puro, sin I/O: nunca asume fin de mes ni un día único para todos los
// contratos. Fechas siempre YYYY-MM-DD en civil (America/Lima), sin hora.
export type BillingModality = 'adelantado' | 'cumplido';
export type BillingState =
  | 'pagado'
  | 'pendiente_no_vencido'
  | 'en_prorroga'
  | 'vencido_sin_prorroga'
  | 'adelanto';

const ADELANTADO_GRACE_DAYS = 7;

function parseISO(d: string): { y: number; m: number; d: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, d: day };
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** Último día real del mes (maneja febrero/bisiesto sin tablas manuales). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** Recorta un día de facturación (29/30/31) al último día real de ese mes. */
export function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}
/**
 * Avanza UN ciclo mensual desde una fecha base, fijando el día al
 * `billingDay` del contrato (recortado si el mes no lo tiene) — nunca
 * acumula el recorte de un mes corto al siguiente (ej. día 31: ene→feb 28/29
 * no "contamina" feb→mar, que vuelve a calcularse desde el billingDay real).
 */
export function nextCycleDate(fromISO: string, billingDay: number): string {
  if (billingDay < 1 || billingDay > 31) throw Error('Día de facturación inválido (1-31)');
  const { y, m } = parseISO(fromISO);
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  return toISO(ny, nm, clampDay(ny, nm, billingDay));
}
/** Suma días calendario completos (sin zona horaria: civil, America/Lima ya resuelta antes). */
export function addDays(dateISO: string, days: number): string {
  const { y, m, d } = parseISO(dateISO);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return toISO(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}
export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface BillingTerms {
  modality: BillingModality;
  billingDay: number;
  /** Días de prórroga tras el vencimiento. Solo aplica a 'adelantado'; en 'cumplido' siempre es 0. */
  graceDays?: number;
}
export interface BillingCycleResult {
  nextDueDate: string;
  graceEndDate: string | null;
  state: BillingState;
  /** Días calendario completos desde el vencimiento (negativo = aún no vence). */
  daysPastDue: number;
  eligibleForSuspension: boolean;
}
/**
 * Clasifica el estado real de un contrato a una fecha de corte explícita.
 * `lastPaymentDate`: fecha del último pago registrado para el ciclo vigente
 * (en adelantado, la fecha que "cubre hasta" el próximo ciclo; en cumplido,
 * la fecha del último pago ya consumido). `null` si nunca pagó (usa la
 * fecha de inicio real del contrato como ancla del primer ciclo).
 */
export function classifyBillingState(
  terms: BillingTerms,
  lastPaymentDate: string,
  todayISO: string,
  alreadyPaidThisCycle: boolean,
): BillingCycleResult {
  const graceDays = terms.modality === 'adelantado' ? (terms.graceDays ?? ADELANTADO_GRACE_DAYS) : 0;
  const nextDueDate = nextCycleDate(lastPaymentDate, terms.billingDay);
  const graceEndDate = terms.modality === 'adelantado' ? addDays(nextDueDate, graceDays) : null;
  const daysPastDue = diffDays(todayISO, nextDueDate);

  if (alreadyPaidThisCycle) {
    return { nextDueDate, graceEndDate, state: 'pagado', daysPastDue, eligibleForSuspension: false };
  }
  if (terms.modality === 'cumplido') {
    // Sin prórroga: elegible para suspensión desde el MISMO día del vencimiento (inclusive).
    if (compareISO(todayISO, nextDueDate) < 0) {
      return { nextDueDate, graceEndDate, state: 'pendiente_no_vencido', daysPastDue, eligibleForSuspension: false };
    }
    return { nextDueDate, graceEndDate, state: 'vencido_sin_prorroga', daysPastDue, eligibleForSuspension: true };
  }
  // Adelantado: el propio día del vencimiento todavía cuenta como "pendiente"
  // (el día no terminó); la prórroga empieza recién al día siguiente.
  if (compareISO(todayISO, nextDueDate) <= 0) {
    return { nextDueDate, graceEndDate, state: 'pendiente_no_vencido', daysPastDue, eligibleForSuspension: false };
  }
  if (graceEndDate != null && compareISO(todayISO, graceEndDate) <= 0) {
    return { nextDueDate, graceEndDate, state: 'en_prorroga', daysPastDue, eligibleForSuspension: false };
  }
  return { nextDueDate, graceEndDate, state: 'vencido_sin_prorroga', daysPastDue, eligibleForSuspension: true };
}
function diffDays(aISO: string, bISO: string): number {
  const a = parseISO(aISO), b = parseISO(bISO);
  const ua = Date.UTC(a.y, a.m - 1, a.d), ub = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((ua - ub) / 86400000);
}
export const billingStateLabels: Record<BillingState, string> = {
  pagado: 'Pagado',
  pendiente_no_vencido: 'Pendiente, no vencido',
  en_prorroga: 'En prórroga',
  vencido_sin_prorroga: 'Vencido sin prórroga',
  adelanto: 'Adelanto (mes futuro ya pagado)',
};
export const billingModalityLabels: Record<BillingModality, string> = {
  adelantado: 'Pago adelantado',
  cumplido: 'Pago cumplido',
};

/**
 * Bucket de presentación para separar, dentro de un mismo `state`, el caso
 * "vence exactamente hoy" (el cliente debe pagar HOY, todavía no está
 * vencido ni en prórroga) de "pendiente, vence en el futuro". No es un
 * estado de negocio nuevo — se deriva de `state`/`daysPastDue`, que ya
 * calcula `classifyBillingState` — solo evita que el panel mezcle
 * "corresponde pagar hoy" con "vencido" o con "mensualidad futura".
 */
export type PresentationBucket =
  | 'pagado'
  | 'pendiente_futuro'
  | 'vence_hoy'
  | 'en_prorroga'
  | 'vencido_sin_prorroga';
export function presentationBucket(r: BillingCycleResult): PresentationBucket {
  if (r.state === 'pendiente_no_vencido') return r.daysPastDue === 0 ? 'vence_hoy' : 'pendiente_futuro';
  // 'adelanto' esta reservado en BillingState para uso futuro; classifyBillingState
  // nunca lo produce hoy, pero el tipo lo incluye - nunca se llega aqui en la practica.
  if (r.state === 'adelanto') return 'pagado';
  return r.state;
}
export const presentationBucketLabels: Record<PresentationBucket, string> = {
  pagado: 'Pagado',
  pendiente_futuro: 'Pendiente, no vencido',
  vence_hoy: 'Vence hoy',
  en_prorroga: 'En prórroga',
  vencido_sin_prorroga: 'Vencido, sin prórroga',
};
