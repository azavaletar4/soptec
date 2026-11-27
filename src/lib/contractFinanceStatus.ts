// Fase 29.2 — estado de mora/gracia y "Plazo de gracia" de la ficha del
// cliente (ContractFinanceSummary.vue). Puro, sin I/O: SIEMPRE se calcula
// con la factura PENDIENTE REAL más antigua (su propio due_date), nunca con
// el pronóstico de próximo ciclo (`cycle.nextCycleDate`/`cycle.graceEndDate`
// de la RPC finance_contract_cycle_status) — ese pronóstico avanza en
// cuanto el contrato ya fue facturado, sin importar si esa factura se pagó.
//
// Caso real que esto corrige: Roberto Gil Gil (CTR-2026-00679),
// FAC-2026-00106 vencida 2026-11-26, modalidad adelantado/7 días de gracia.
// La RPC mostraba "gracia hasta 2027-01-02" (next_cycle + 7, un ciclo
// completo adelantado); el valor real es 2026-12-03 (vencimiento real + 7).
export type ContractFinanceStatus =
  | 'cortesia'
  | 'sin_conciliar'
  | 'suspendido'
  | 'moroso'
  | 'en_gracia'
  | 'al_dia';

export interface PendingInvoiceDue {
  due_date: string;
}

export interface ContractCycleStatusInput {
  isCourtesy: boolean;
  reconciled: boolean;
  /** service_contracts.status (p.ej. 'active'/'suspended'). */
  contractStatus: string;
  billingModality?: 'adelantado' | 'cumplido' | null;
  graceDays?: number | null;
  /** Fecha de hoy en hora de Perú (YYYY-MM-DD), nunca `new Date()` del navegador. */
  asOf: string;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Nunca la factura más reciente: una deuda antigua no se oculta con un vencimiento posterior. */
export function earliestPendingDue(pendingInvoices: PendingInvoiceDue[]): string | null {
  if (!pendingInvoices.length) return null;
  return pendingInvoices.reduce((min, i) => (i.due_date < min ? i.due_date : min), pendingInvoices[0].due_date);
}

export function deriveContractFinanceStatus(
  input: ContractCycleStatusInput,
  pendingInvoices: PendingInvoiceDue[],
): ContractFinanceStatus {
  if (input.isCourtesy) return 'cortesia';
  if (!input.reconciled) return 'sin_conciliar';
  if (input.contractStatus === 'suspended') return 'suspendido';
  const earliestDue = earliestPendingDue(pendingInvoices);
  if (!earliestDue) return 'al_dia';
  const today = input.asOf;
  if (earliestDue >= today) return 'al_dia'; // factura pendiente pero aún no vencida: ciclo en curso
  if (input.billingModality !== 'adelantado') return 'moroso'; // cumplido: sin prórroga, exigible el mismo día
  return addDaysIso(earliestDue, input.graceDays ?? 7) >= today ? 'en_gracia' : 'moroso';
}

/**
 * "Plazo de gracia" a mostrar: vencimiento real de la factura pendiente +
 * días de gracia (misma base que decide moroso/en_gracia arriba). Sin
 * factura pendiente (cliente al día), se conserva el pronóstico de la RPC
 * como referencia informativa de la próxima mensualidad — ahí no hay deuda
 * real que pueda confundirse con el pronóstico.
 */
export function deriveGraceEndDate(
  input: Pick<ContractCycleStatusInput, 'billingModality' | 'graceDays'>,
  pendingInvoices: PendingInvoiceDue[],
  fallbackGraceEndDate: string | null | undefined,
): string | null {
  if (input.billingModality !== 'adelantado') return null;
  const earliestDue = earliestPendingDue(pendingInvoices);
  if (earliestDue) return addDaysIso(earliestDue, input.graceDays ?? 7);
  return fallbackGraceEndDate ?? null;
}
