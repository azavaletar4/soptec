import { supabaseAdmin } from '../lib/supabaseAdmin';
import { limaDate } from '../../../src/lib/financeMoney';
import { inspectDebtService } from './debtHoldEligibility';
export const FINANCE_TECHNICAL_BLOCK = 'Suspensiones y reactivaciones no habilitadas: fase de conciliación. No se contactó ningún equipo.';
export interface StepResult { ok: boolean; error?: string }
export interface ApplyResult { ok: boolean; mikrotik: StepResult; olt: StepResult }
/** Fail-closed incluso si otra ruta importa el servicio directamente. */
export async function applyDebtHold(_contractId: string): Promise<ApplyResult> { throw new Error(FINANCE_TECHNICAL_BLOCK); }
export async function reactivateContract(_contractId: string): Promise<ApplyResult> { throw new Error(FINANCE_TECHNICAL_BLOCK); }
export async function flagOverdueContracts() { return { scanned: 0, flagged: 0, errors: 0, blocked: true, reason: FINANCE_TECHNICAL_BLOCK }; }
export async function previewDebtService(contractId: string) {
  const { data: contract, error } = await supabaseAdmin.from('service_contracts')
    .select('id,client_id,status,service_type,finance_reconciled_at,finance_start_date,mikrotik_device_id,pppoe_username').eq('id', contractId).single();
  if (error || !contract) throw new Error('No se pudo verificar el contrato y su conciliación.');
  const [onts, invoices, samePppoe] = await Promise.all([
    supabaseAdmin.from('olt_onts').select('id,client_id,contract_id,retired_at').eq('contract_id', contractId).is('retired_at', null).limit(3),
    supabaseAdmin.from('invoices').select('contract_id,finance_reconciled,amount_due,due_date,status').eq('contract_id', contractId).eq('status', 'pending').limit(1001),
    contract.pppoe_username && contract.mikrotik_device_id ? supabaseAdmin.from('service_contracts').select('id').eq('pppoe_username', contract.pppoe_username).eq('mikrotik_device_id', contract.mikrotik_device_id).neq('status', 'cancelled').limit(3) : Promise.resolve({ data: [], error: null }),
  ]);
  if (onts.error || invoices.error || samePppoe.error || (invoices.data?.length ?? 0) > 1000) throw new Error('No se pudo completar la verificación de identidad y saldo.');
  const result = inspectDebtService(contract, onts.data ?? [], invoices.data ?? [], limaDate());
  if (samePppoe.data?.length !== 1) result.reasons.push('El usuario PPPoE está compartido o no se puede verificar.');
  result.hasVerifiedOverdue = result.hasVerifiedOverdue && result.reasons.length === 0;
  return result;
}
