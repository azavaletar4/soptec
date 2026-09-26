/**
 * Corrige el periodo/vencimiento de las facturas AUTO-GENERADAS cuyo
 * "period_start" quedo alineado al dia 1 del mes calendario en vez del
 * "billing_day" (fecha de emision) real del contrato — bug de
 * generateDueInvoices() (ver invoiceGenerationService.ts) ya corregido para
 * facturas nuevas; este script corrige las que ya existian.
 *
 * ALCANCE — decision deliberada: solo toca facturas con
 * notes = 'Generada automaticamente' (el valor exacto que pone
 * generateDueInvoices()). Las facturas creadas a mano desde
 * FacturacionView.vue dejan que el staff elija cualquier periodo a
 * proposito (ej. prorrateos) — esas NUNCA se tocan.
 *
 * Por cada factura: toma el AÑO/MES de su propio period_start actual (no
 * reconstruye el historial completo) y recalcula:
 *   period_start = dia billing_day dentro de ese mismo mes (con clamp)
 *   period_end   = period_start + 1 mes - 1 dia
 *   due_date     = period_start + 7 dias
 * Nunca toca amount, status, paid_at, amount_paid, amount_due ni
 * invoice_number.
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/fix-invoice-emision.ts
 *     DRY-RUN (default, no escribe nada) — imprime que se actualizaria.
 *
 *   npx tsx server/scripts/fix-invoice-emision.ts --apply
 *     Aplica de verdad.
 *
 *   npx tsx server/scripts/fix-invoice-emision.ts --only FAC-2026-00088
 *     Limita todo a una sola factura (por invoice_number) o un contrato
 *     (por contract_number) — para probar antes de correrlo contra el resto.
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIso(new Date(Date.UTC(y, m - 1, d + days)));
}
function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIso(new Date(Date.UTC(y, m - 1 + months, d)));
}
function anchorDateForMonth(year: number, month0: number, billingDay: number): string {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(billingDay, 1), daysInMonth);
  return toIso(new Date(Date.UTC(year, month0, day)));
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  period_start: string;
  period_end: string;
  due_date: string;
  status: string;
  service_contracts: { contract_number: string | null; billing_day: number; clients: { first_name: string; last_name: string } | null } | null;
}

interface PlannedChange {
  invoiceId: string;
  invoiceNumber: string | null;
  contractNumber: string | null;
  clientName: string;
  status: string;
  from: { period_start: string; period_end: string; due_date: string };
  to: { period_start: string; period_end: string; due_date: string };
}

async function main() {
  console.log(`=== Fix fecha de emision de facturas auto-generadas (${APPLY ? 'APLICANDO' : 'DRY-RUN, no escribe nada'}) ===\n`);

  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select(
      'id, invoice_number, period_start, period_end, due_date, status, ' +
        'service_contracts!invoices_contract_id_fkey(contract_number, billing_day, clients(first_name, last_name))',
    )
    .eq('notes', 'Generada automáticamente')
    .order('period_start', { ascending: true });
  if (error) throw new Error(error.message);

  let invoices = (data ?? []) as unknown as InvoiceRow[];
  if (ONLY) {
    invoices = invoices.filter(
      (inv) => inv.invoice_number === ONLY || inv.service_contracts?.contract_number === ONLY,
    );
  }

  const planned: PlannedChange[] = [];
  const skippedNoContract: string[] = [];
  let alreadyOk = 0;

  for (const inv of invoices) {
    const contract = inv.service_contracts;
    if (!contract || contract.billing_day == null) {
      skippedNoContract.push(inv.invoice_number ?? inv.id);
      continue;
    }

    const [y, m] = inv.period_start.split('-').map(Number);
    const newPeriodStart = anchorDateForMonth(y, m - 1, contract.billing_day);
    const newPeriodEnd = addDaysIso(addMonthsIso(newPeriodStart, 1), -1);
    const newDueDate = addDaysIso(newPeriodStart, 7);

    if (
      newPeriodStart === inv.period_start &&
      newPeriodEnd === inv.period_end &&
      newDueDate === inv.due_date
    ) {
      alreadyOk += 1;
      continue;
    }

    const client = contract.clients;
    planned.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      contractNumber: contract.contract_number,
      clientName: client ? `${client.first_name} ${client.last_name}` : '(sin cliente)',
      status: inv.status,
      from: { period_start: inv.period_start, period_end: inv.period_end, due_date: inv.due_date },
      to: { period_start: newPeriodStart, period_end: newPeriodEnd, due_date: newDueDate },
    });
  }

  console.log(`Facturas auto-generadas revisadas: ${invoices.length}`);
  console.log(`Ya correctas (sin cambios): ${alreadyOk}`);
  console.log(`Sin contrato/billing_day (omitidas): ${skippedNoContract.length}`);
  console.log(`Con cambios ${APPLY ? 'a aplicar' : 'planeados'}: ${planned.length}\n`);

  if (planned.length) {
    console.log('--- Detalle de cambios ---');
    for (const p of planned) {
      console.log(
        `${p.invoiceNumber ?? p.invoiceId} (${p.contractNumber ?? '?'} — ${p.clientName}, ${p.status}): ` +
          `periodo ${p.from.period_start}→${p.from.period_end} vence ${p.from.due_date}  =>  ` +
          `periodo ${p.to.period_start}→${p.to.period_end} vence ${p.to.due_date}`,
      );
    }
    console.log('');
  }

  if (skippedNoContract.length) {
    console.log('--- Sin contrato o billing_day (no tocadas) ---');
    console.log(skippedNoContract.join(', '), '\n');
  }

  if (!APPLY) {
    console.log(`DRY-RUN: no se aplicó ningún cambio. Corre con --apply para escribir estas ${planned.length} facturas.`);
    return;
  }

  let updated = 0;
  const errors: { invoiceNumber: string | null; message: string }[] = [];
  for (const p of planned) {
    const { error: updErr } = await supabaseAdmin
      .from('invoices')
      .update({ period_start: p.to.period_start, period_end: p.to.period_end, due_date: p.to.due_date })
      .eq('id', p.invoiceId);
    if (updErr) {
      errors.push({ invoiceNumber: p.invoiceNumber, message: updErr.message });
      continue;
    }
    updated++;
  }

  console.log(`\nAplicado: ${updated}/${planned.length} facturas actualizadas. ${errors.length} errores.`);
  for (const e of errors) console.log(`  ${e.invoiceNumber}: ${e.message}`);
}

main().catch((e) => {
  console.error('\nError:', e instanceof Error ? e.message : e);
  process.exit(1);
});
