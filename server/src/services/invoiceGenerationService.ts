import { supabaseAdmin } from '../lib/supabaseAdmin';

// Facturacion recurrente (Fase 33b). El descuento de referido y el saldo a
// favor NO se aplican aqui — los aplica el trigger apply_invoice_credits()
// (ver migracion Fase 33) sobre CUALQUIER insert en invoices, sea manual
// (FacturacionView.vue) o generado por este servicio. Este archivo solo
// decide QUE facturas hace falta crear.
//
// Arranque seguro: si un contrato nunca tuvo facturas, el primer periodo a
// facturar es el MES ACTUAL (no service_contracts.start_date, que puede ser
// de hace años) — evita un backfill masivo la primera vez que esto corre
// sobre contratos reales. Si ya tiene facturas, retoma exactamente donde
// quedo la ultima (period_end + 1 dia), sin duplicar ni saltar periodos.

const MAX_PERIODS_PER_CONTRACT = 24; // tope defensivo (2 años) ante datos anomalos

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIso(new Date(Date.UTC(y, m - 1 + months, d)));
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIso(new Date(Date.UTC(y, m - 1, d + days)));
}

function currentMonthStartIso(): string {
  const now = new Date();
  return toIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

/** Vencimiento dentro del periodo segun billing_day, con clamp al ultimo dia del mes. */
function dueDateForPeriod(periodStartIso: string, billingDay: number): string {
  const [y, m] = periodStartIso.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(billingDay, 1), daysInMonth);
  return toIso(new Date(Date.UTC(y, m - 1, day)));
}

interface ContractRow {
  id: string;
  client_id: string;
  monthly_fee: number;
  billing_day: number;
}

export interface GenerateDueResult {
  scanned: number;
  generated: number;
  errors: { contractId: string; message: string }[];
}

async function nextPeriodStartFor(contractId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('period_end')
    .eq('contract_id', contractId)
    .neq('status', 'cancelled')
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? addDaysIso(data.period_end, 1) : currentMonthStartIso();
}

/**
 * Genera todas las facturas pendientes (una por periodo vencido, con tope
 * defensivo) para los contratos activos. Idempotente: correrlo de nuevo el
 * mismo dia no duplica nada porque siempre parte de la ultima factura ya
 * creada de cada contrato.
 */
export async function generateDueInvoices(): Promise<GenerateDueResult> {
  const { data: contracts, error } = await supabaseAdmin
    .from('service_contracts')
    .select('id, client_id, monthly_fee, billing_day')
    .eq('status', 'active');
  if (error) throw new Error(error.message);

  const today = toIso(new Date());
  let generated = 0;
  const errors: { contractId: string; message: string }[] = [];

  for (const contract of (contracts ?? []) as ContractRow[]) {
    try {
      let periodStart = await nextPeriodStartFor(contract.id);
      let iterations = 0;

      while (periodStart <= today && iterations < MAX_PERIODS_PER_CONTRACT) {
        const periodEnd = addDaysIso(addMonthsIso(periodStart, 1), -1);
        const dueDate = dueDateForPeriod(periodStart, contract.billing_day);

        const { error: insErr } = await supabaseAdmin.from('invoices').insert({
          contract_id: contract.id,
          client_id: contract.client_id,
          period_start: periodStart,
          period_end: periodEnd,
          amount: contract.monthly_fee,
          due_date: dueDate,
          status: 'pending',
          notes: 'Generada automáticamente',
        });
        if (insErr) throw new Error(insErr.message);

        generated += 1;
        iterations += 1;
        periodStart = addDaysIso(periodEnd, 1);
      }

      if (iterations >= MAX_PERIODS_PER_CONTRACT) {
        errors.push({ contractId: contract.id, message: `Se alcanzó el tope de ${MAX_PERIODS_PER_CONTRACT} periodos en una sola corrida — revisar el historial de facturas de este contrato` });
      }
    } catch (e) {
      errors.push({ contractId: contract.id, message: e instanceof Error ? e.message : 'Error desconocido' });
    }
  }

  return { scanned: contracts?.length ?? 0, generated, errors };
}
