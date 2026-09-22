import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { reactivateContract, hasOverdueInvoices } from '../services/debtHoldService';

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

invoicesRoutes.post('/:id/mark-paid', async (c) => {
  const id = c.req.param('id');
  const { paymentMethod } = await c.req.json<{ paymentMethod?: string }>();

  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: paymentMethod ?? null })
    .eq('id', id)
    .select(INVOICE_SELECT)
    .single();
  if (invErr || !invoice) return c.json({ error: invErr?.message ?? 'Factura no encontrada' }, 400);

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
