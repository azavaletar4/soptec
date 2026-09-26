import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { flagOverdueContracts, applyDebtHold, reactivateContract } from '../services/debtHoldService';

// Corte y reactivacion por deuda — ver Fase 25. Lectura (y re-escaneo, que
// solo marca) para todo el staff de facturacion; aplicar/reactivar el corte
// REAL (toca MikroTik + OLT de verdad) queda restringido a SUPERADMIN/ADMIN
// — pedido explicito: el corte es semiautomatico, pero confirmarlo siempre
// lo hace un administrador, nunca FACTURACION.
export const debtHoldRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'FACTURACION'] as const;
// El re-escaneo solo marca (no toca equipos), igual criterio que STAFF_READ.
const STAFF_SCAN = ['SUPERADMIN', 'ADMIN', 'FACTURACION'] as const;
// Aplicar/reactivar el corte real (OLT + MikroTik) — solo administracion.
const CORTE_CONFIRM = ['SUPERADMIN', 'ADMIN'] as const;

debtHoldRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

const CONTRACT_SELECT =
  'id, contract_number, client_id, debt_hold_status, debt_hold_flagged_at, debt_hold_applied_at, debt_hold_invoice_id, ' +
  'clients(id, first_name, last_name, document_number, phone), plans(id, name), ' +
  'invoices:debt_hold_invoice_id(id, invoice_number, due_date, amount)';

debtHoldRoutes.get('/pending', async (c) => {
  const { data, error } = await supabaseAdmin
    .from('service_contracts')
    .select(CONTRACT_SELECT)
    .in('debt_hold_status', ['pending', 'suspended'])
    .order('debt_hold_flagged_at', { ascending: true });
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data ?? []);
});

debtHoldRoutes.get('/:contractId/events', async (c) => {
  const { data, error } = await supabaseAdmin
    .from('debt_hold_events')
    .select('*')
    .eq('contract_id', c.req.param('contractId'))
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data ?? []);
});

// Disparo manual del escaneo (ademas del scheduler automatico) — util para
// probar o para re-escanear al toque despues de cargar facturas.
debtHoldRoutes.post('/scan', requireRole(...STAFF_SCAN), async (c) => {
  try {
    const result = await flagOverdueContracts();
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al escanear vencidos' }, 500);
  }
});

debtHoldRoutes.post('/:contractId/apply', requireRole(...CORTE_CONFIRM), async (c) => {
  try {
    const result = await applyDebtHold(c.req.param('contractId') ?? '');
    return c.json(result, result.ok ? 200 : 502);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al aplicar el corte' }, 400);
  }
});

debtHoldRoutes.post('/:contractId/reactivate', requireRole(...CORTE_CONFIRM), async (c) => {
  try {
    const result = await reactivateContract(c.req.param('contractId') ?? '');
    return c.json(result, result.ok ? 200 : 502);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al reactivar' }, 400);
  }
});
