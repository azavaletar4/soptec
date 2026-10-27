import type { Context } from 'hono';
import { requireRole } from './auth';

/** Una sola guarda real para las vías antiguas y el proxy NBI. */
export async function tr069PreparationOnly(c: Context) {
  return requireRole('ADMIN', 'SUPERADMIN')(c, async () => {
    c.res = c.json({ error: 'Escrituras TR-069 bloqueadas durante la preparación WiFi; se requiere autorización independiente' }, 423);
  });
}
