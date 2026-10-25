import { Hono, type MiddlewareHandler } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth';

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type SessionDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function sessionDb(authorization: string): SessionDb {
  // El JWT del operador llega a Postgres: nunca usar service_role en la baja.
  return createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
}
export function createClientRetirementRoutes(authenticate: MiddlewareHandler = requireAuth, database = sessionDb) {
  const routes = new Hono();
  routes.use('*', authenticate);
  routes.use('*', async (c, next) => {
    const actor = c.get('user');
    if (!actor) return c.json({ error: 'No autenticado' }, 401);
    if (!['ADMIN', 'SUPERADMIN'].includes(actor.role)) return c.json({ error: 'La baja definitiva requiere ADMIN o SUPERADMIN.' }, 403);
    await next();
  });
  const call = async (authorization: string, name: string, args: Record<string, unknown>) => database(authorization).rpc(name, args);
  const errorResponse = (error: NonNullable<RpcResult['error']>) => {
    if (error.code === '42501') return { status: 403 as const, error: 'No tienes permisos vigentes para la baja definitiva.' };
    if (error.code === 'PBR04') return { status: 404 as const, error: 'Cliente no encontrado.' };
    if (['PBR01', 'PBR02', 'PBR03', '40P01', '40001', '55P03'].includes(error.code ?? '')) return { status: 409 as const,
      error: error.code === 'PBR02' ? 'Hay Altas abiertas o relaciones inconsistentes. Resuélvelas antes de la baja.' : 'La confirmación ya no es válida o hubo una operación concurrente. Recarga la vista previa y confirma otra vez.' };
    if (['PGRST202', '42883'].includes(error.code ?? '')) return { status: 503 as const, error: 'La baja transaccional todavía no está habilitada en este entorno.' };
    return { status: 500 as const, error: 'No se pudo completar la operación. Recarga la ficha para comprobar su estado antes de reintentar.' };
  };
  routes.get('/:id/retirement', async c => {
    if (!uuid.test(c.req.param('id'))) return c.json({ error: 'Cliente inválido.' }, 400);
    try {
      const result = await call(c.req.header('Authorization') ?? '', 'client_retirement_preview', { p_client_id: c.req.param('id') });
      if (result.error) { const e = errorResponse(result.error); return c.json({ error: e.error }, e.status); }
      return c.json(result.data);
    } catch { return c.json({ error: 'No se pudo consultar la baja definitiva.' }, 503); }
  });
  routes.post('/:id/retirement', async c => {
    if (!uuid.test(c.req.param('id'))) return c.json({ error: 'Cliente inválido.' }, 400);
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Confirmación inválida.' }, 400); }
    if (!body || body.confirmAllContracts !== true || typeof body.previewToken !== 'string' || !/^[a-f0-9]{32}$/.test(body.previewToken)
      || !Array.isArray(body.affectedContractIds) || body.affectedContractIds.some(id => typeof id !== 'string' || !uuid.test(id))
      || new Set(body.affectedContractIds).size !== body.affectedContractIds.length) return c.json({ error: 'Confirma todos los contratos de la vista previa.' }, 400);
    try {
      const result = await call(c.req.header('Authorization') ?? '', 'client_retire_atomic', {
        p_client_id: c.req.param('id'), p_preview_token: body.previewToken,
        p_contract_ids: body.affectedContractIds, p_confirm_all: body.confirmAllContracts,
      });
      if (result.error) { const e = errorResponse(result.error); return c.json({ error: e.error }, e.status); }
      return c.json(result.data);
    } catch { return c.json({ error: 'No se recibió confirmación de la baja. Recarga la ficha antes de reintentar.' }, 503); }
  });
  return routes;
}
export const clientRetirementRoutes = createClientRetirementRoutes();
