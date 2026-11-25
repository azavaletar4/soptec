export interface FinancialService {
  id: string; client_id: string; status: string; service_type?: string;
  finance_reconciled_at?: string | null; finance_start_date?: string | null;
  mikrotik_device_id?: string | null; pppoe_username?: string | null;
}
export interface LinkedOnt { id: string; client_id: string | null; contract_id: string | null; retired_at?: string | null }
export interface DebtBalance { contract_id: string; finance_reconciled?: boolean; amount_due: string | number; due_date: string; status: string }
/** Plan puro de lectura. Ningún adaptador de ejecución. */
export function inspectDebtService(contract: FinancialService, onts: LinkedOnt[], invoices: DebtBalance[], today: string) {
  const reasons: string[] = [];
  if (!contract.finance_reconciled_at || !contract.finance_start_date || contract.finance_start_date > today) reasons.push('Contrato sin conciliación inicial aprobada.');
  if (!['active', 'suspended'].includes(contract.status)) reasons.push('Estado comercial no elegible.');
  const exact = onts.filter(o => o.contract_id === contract.id && !o.retired_at);
  if (exact.length !== 1 || exact.some(o => o.client_id !== contract.client_id)) reasons.push('La ONT no tiene una relación inequívoca con este contrato.');
  if (!contract.mikrotik_device_id || !contract.pppoe_username) reasons.push('Falta identificar el servicio PPPoE exacto.');
  if (contract.service_type?.toLowerCase().includes('iptv') || contract.service_type?.toLowerCase().includes('duo')) reasons.push('El alcance IPTV/Dúo requiere validación independiente antes de operar.');
  const relevant = invoices.filter(i => i.contract_id === contract.id && i.status === 'pending');
  if (relevant.some(i => !i.finance_reconciled)) reasons.push('Hay deuda histórica no conciliada.');
  const overdue = relevant.filter(i => i.finance_reconciled && i.due_date < today && Number(i.amount_due) > 0);
  return { contractId: contract.id, ontId: exact.length === 1 ? exact[0].id : null, hasVerifiedOverdue: overdue.length > 0 && reasons.length === 0, reasons, technicalState: 'unknown', executionEnabled: false as const };
}
