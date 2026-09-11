import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { collectMetricsForDevice } from '../services/genieacsMetricsService';

// Adaptado de REPLICA-TR069-GENIEACS.md secciones 8/9. Sin tenant_id
// (single-tenant): "todos" simplemente significa todos los tr069_devices.
export const genieacsSyncRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;

genieacsSyncRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

function nbiUrl() {
  return process.env.GENIEACS_NBI || 'http://localhost:7557';
}

genieacsSyncRoutes.post('/metrics', async (c) => {
  const { data: devices, error } = await supabaseAdmin.from('tr069_devices').select('id, genieacs_id');
  if (error) return c.json({ error: error.message }, 500);

  const results = await Promise.all(
    (devices ?? []).map((d) => collectMetricsForDevice(nbiUrl(), d.id, d.genieacs_id)),
  );
  const ok = results.filter((r) => r.ok).length;
  return c.json({ ok: true, collected: ok, failed: results.length - ok, total: results.length });
});

genieacsSyncRoutes.post('/metrics/device/:id', async (c) => {
  const id = c.req.param('id');
  const { data: device, error } = await supabaseAdmin.from('tr069_devices').select('id, genieacs_id').eq('id', id).single();
  if (error || !device) return c.json({ error: 'Dispositivo TR-069 no encontrado' }, 404);

  const result = await collectMetricsForDevice(nbiUrl(), device.id, device.genieacs_id);
  if (!result.ok) return c.json(result, 502);
  return c.json(result);
});
