import { Hono, type Context } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  findLinesByUsername,
  getLineForm,
  saveLine,
  performLineAction,
  listBouquets,
  type XuiLineAction,
  type SaveLineOverrides,
} from '../services/xuiService';

// Panel IPTV XUI.one del ISP (172.168.1.253/RaycoAlex). No tiene API REST de
// gestion, solo el HTML/AJAX del propio panel admin — ver el comentario en
// server/src/services/xuiService.ts para el detalle de cada endpoint.
export const xuiRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'] as const;
const STAFF_WRITE = ['SUPERADMIN', 'ADMIN', 'FACTURACION'] as const;

xuiRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

function handleError(c: Context, e: unknown) {
  return c.json({ error: e instanceof Error ? e.message : 'Error al contactar XUI' }, 502);
}

xuiRoutes.get('/bouquets', async (c) => {
  try {
    const bouquets = await listBouquets();
    return c.json({ bouquets });
  } catch (e) {
    return handleError(c, e);
  }
});

xuiRoutes.get('/lines', async (c) => {
  const search = c.req.query('search') ?? '';
  if (!search.trim()) return c.json({ error: 'Falta el parametro search' }, 400);
  try {
    const lines = await findLinesByUsername(search.trim());
    return c.json({ lines });
  } catch (e) {
    return handleError(c, e);
  }
});

xuiRoutes.get('/lines/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id invalido' }, 400);
  try {
    const line = await getLineForm(id);
    return c.json({ line });
  } catch (e) {
    return handleError(c, e);
  }
});

xuiRoutes.post('/lines', requireRole(...STAFF_WRITE), async (c) => {
  const body = await c.req.json<SaveLineOverrides>();
  try {
    const result = await saveLine(null, body);
    return c.json(result, 201);
  } catch (e) {
    return handleError(c, e);
  }
});

xuiRoutes.patch('/lines/:id', requireRole(...STAFF_WRITE), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id invalido' }, 400);
  const body = await c.req.json<SaveLineOverrides>();
  try {
    const result = await saveLine(id, body);
    return c.json(result);
  } catch (e) {
    return handleError(c, e);
  }
});

const VALID_ACTIONS: XuiLineAction[] = ['enable', 'disable', 'ban', 'unban', 'kill', 'delete'];

xuiRoutes.post('/lines/:id/action', requireRole(...STAFF_WRITE), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'id invalido' }, 400);
  const { action } = await c.req.json<{ action?: string }>();
  if (!action || !VALID_ACTIONS.includes(action as XuiLineAction)) {
    return c.json({ error: `action invalida (usar: ${VALID_ACTIONS.join(', ')})` }, 400);
  }
  try {
    await performLineAction(id, action as XuiLineAction);
    return c.json({ ok: true });
  } catch (e) {
    return handleError(c, e);
  }
});
