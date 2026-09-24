import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { reactivateContract, hasOverdueInvoices } from '../services/debtHoldService';
import { generateDueInvoices } from '../services/invoiceGenerationService';

// Las facturas se leen/crean/cancelan directo via supabase-js desde el
// frontend (ver src/stores/invoices.ts, protegido por RLS) — este backend
// solo interviene en "marcar pagada" porque ese paso puede necesitar
// reactivar al cliente en MikroTik/OLT (Fase 25), algo que solo el backend
// puede hacer.
export const invoicesRoutes = new Hono();

const BILLING_WRITE = ['SUPERADMIN', 'ADMIN', 'FACTURACION'] as const;

invoicesRoutes.use('*', requireAuth, requireRole(...BILLING_WRITE));

// service_contracts!contract_id — ver mismo comentario en src/stores/invoices.ts
const INVOICE_SELECT = '*, clients(id, first_name, last_name, document_number), service_contracts!contract_id(id, contract_number)';

// Facturacion recurrente (Fase 33b) — genera todas las facturas pendientes
// de los contratos activos que ya cumplieron su periodo (ver
// invoiceGenerationService.ts). El descuento de referido y el saldo a favor
// se aplican solos via trigger de la base sobre cada insert.
invoicesRoutes.post('/generate-due', async (c) => {
  try {
    const result = await generateDueInvoices();
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al generar las facturas' }, 500);
  }
});

invoicesRoutes.post('/:id/mark-paid', async (c) => {
  const id = c.req.param('id');
  const { paymentMethod, amountPaid } = await c.req.json<{ paymentMethod?: string; amountPaid?: number }>();

  // amount_due ya viene neto de descuentos de referido/saldo a favor
  // aplicados al crearla (Fase 33/33b) — el sobrepago se calcula contra ESE
  // monto, no contra el bruto.
  const { data: before, error: beforeErr } = await supabaseAdmin
    .from('invoices')
    .select('amount_due, client_id')
    .eq('id', id)
    .single();
  if (beforeErr || !before) return c.json({ error: beforeErr?.message ?? 'Factura no encontrada' }, 404);

  const dueAmount = Number(before.amount_due);
  const paidAmount = amountPaid ?? dueAmount;
  const excedente = paidAmount - dueAmount;

  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_method: paymentMethod ?? null,
      amount_paid: paidAmount,
      amount_due: 0,
    })
    .eq('id', id)
    .select(INVOICE_SELECT)
    .single();
  if (invErr || !invoice) return c.json({ error: invErr?.message ?? 'Factura no encontrada' }, 400);

  // Pago en exceso (por error o voluntario del cliente): el excedente pasa a
  // saldo a favor, disponible para la siguiente factura (aplicado por el
  // trigger apply_invoice_credits al crearla).
  if (excedente > 0) {
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('saldo_a_favor')
      .eq('id', before.client_id)
      .single();
    if (!clientErr && client) {
      const nuevoSaldo = Number(client.saldo_a_favor) + excedente;
      await supabaseAdmin.from('clients').update({ saldo_a_favor: nuevoSaldo }).eq('id', before.client_id);
      await supabaseAdmin.from('client_credit_movements').insert({
        client_id: before.client_id,
        tipo: 'pago_excedente',
        monto: excedente,
        saldo_resultante: nuevoSaldo,
        invoice_id: id,
      });
    }
  }

  const { data: contract } = await supabaseAdmin
    .from('service_contracts')
    .select('id, debt_hold_status')
    .eq('id', invoice.contract_id)
    .single();

  let reactivation: { attempted: boolean; ok?: boolean; error?: string } = { attempted: false };
  if (contract && contract.debt_hold_status !== 'none') {
    try {
      const stillOverdue = await hasOverdueInvoices(contract.id, id);
      if (!stillOverdue) {
        const result = await reactivateContract(contract.id);
        reactivation = { attempted: true, ok: result.ok, error: result.ok ? undefined : [result.mikrotik.error, result.olt.error].filter(Boolean).join(' · ') };
      }
    } catch (e) {
      reactivation = { attempted: true, ok: false, error: e instanceof Error ? e.message : 'Error al reactivar' };
    }
  }

  return c.json({ invoice, reactivation });
});
