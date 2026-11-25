import { Hono, type MiddlewareHandler } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseUser } from '../lib/supabaseUser';
import { penCents, penDecimal } from '../../../src/lib/financeMoney';
type FinanceDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message: string; code?: string} | null}> };
export function createInvoiceRoutes(authenticate: MiddlewareHandler = requireAuth, database: (authorization: string | undefined) => FinanceDb = supabaseUser) {
const invoicesRoutes = new Hono();
invoicesRoutes.use('*', authenticate, requireRole('SUPERADMIN', 'ADMIN', 'FACTURACION'));
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
invoicesRoutes.post('/generate-due', c => c.json({ error: 'Generación pendiente de conciliación y aprobación del asistente mensual.' }, 409));
invoicesRoutes.post('/payments', async c => {
  try {
    const body = await c.req.json();
    if (!uuid(body.requestId) || !uuid(body.contractId) || !Array.isArray(body.invoiceIds) || body.invoiceIds.length > 50 || !body.invoiceIds.every(uuid)) return c.json({ error: 'Contrato, operación o facturas inválidos.' }, 400);
    const cents = penCents(body.amount);
    if (cents <= 0) return c.json({ error: 'El importe recibido debe ser mayor a cero.' }, 400);
    const { data, error } = await database(c.req.header('Authorization')).rpc('finance_record_payment', { p_request_id: body.requestId, p_contract_id: body.contractId, p_invoice_ids: body.invoiceIds, p_amount: penDecimal(cents), p_method: body.method, p_reference: body.reference ?? null, p_reason: body.reason });
    if (error) return c.json({ error: error.message }, error.code === '42501' ? 403 : 409);
    return c.json(data);
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Solicitud inválida' }, 400); }
});
// Ningún pago puede usar ya el camino que liquidaba parciales y reactivaba equipos.
invoicesRoutes.post('/:id/mark-paid', c => c.json({ error: 'Utiliza Registrar pago con clave de operación; el flujo anterior está deshabilitado.' }, 409));
invoicesRoutes.post('/:id/adjustments', requireRole('SUPERADMIN', 'ADMIN'), async c => {
  try {
    const body = await c.req.json();
    if (!uuid(c.req.param('id')) || !uuid(body.operationId)) return c.json({ error: 'Operación inválida' }, 400);
    const amount = penDecimal(penCents(body.amount));
    const { data, error } = await database(c.req.header('Authorization')).rpc('finance_apply_adjustment', { p_operation_id: body.operationId, p_invoice_id: c.req.param('id'), p_amount: amount, p_kind: body.kind, p_reason: body.reason });
    if (error) return c.json({ error: error.message }, error.code === '42501' ? 403 : 409);
    return c.json(data);
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : 'Ajuste inválido' }, 400); }
});
return invoicesRoutes;
}
export const invoicesRoutes = createInvoiceRoutes();
