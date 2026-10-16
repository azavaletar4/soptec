import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth';
import { FieldInventoryError, readFieldInventory } from '../services/fieldInventory';

export const fieldInventoryRoutes = new Hono();
fieldInventoryRoutes.use('*', requireAuth);
fieldInventoryRoutes.get('/:jobType/:jobId/:view', async c => {
  try {
    // Cliente de sesión, sin privilegios de servicio ni persistencia entre solicitudes.
    const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: c.req.header('Authorization')! } },
    });
    const result = await readFieldInventory(db, c.get('user').id, { ...c.req.param(), ...Object.fromEntries(
      ['page', 'productId', 'unitId', 'action'].map(key => [key, c.req.query(key)]),
    ) } as Parameters<typeof readFieldInventory>[2]);
    return c.json(result);
  } catch (error) {
    if (error instanceof FieldInventoryError) return c.json({ error: error.message }, error.status);
    return c.json({ error: 'No se pudo consultar el inventario de la orden.' }, 500);
  }
});
