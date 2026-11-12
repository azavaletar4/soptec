import type { Context } from 'hono';
import type { PppoeProfileResult } from '../../../src/lib/pppoeProfileCounts';

export const DASHBOARD_PPPOE_ROLES = ['SUPERADMIN', 'ADMIN', 'SOPORTE', 'TECNICO_RED'] as const;
export function createDashboardPppoeHandler(read: () => Promise<PppoeProfileResult>) {
  return async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    const user = c.get('user');
    if (!user) return c.json({ error: 'No autenticado' }, 401);
    if (!(DASHBOARD_PPPOE_ROLES as readonly string[]).includes(user.role)) return c.json({ error: 'Sin permiso de dashboard' }, 403);
    return c.json(await read());
  };
}
