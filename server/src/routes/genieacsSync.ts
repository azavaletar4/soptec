import { Hono } from 'hono';
import { wifiPreparationRoutes } from './tr069WifiPreparation';
import { tr069PreparationOnly } from '../middleware/tr069PreparationOnly';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { collectMetricsForDevice } from '../services/genieacsMetricsService';
import { getPppoeInfo, queueReboot, queueRefresh } from '../services/tr069DeviceService';
import { readHostsInventory } from '../services/tr069Hosts';

// Adaptado de REPLICA-TR069-GENIEACS.md secciones 8/9. Sin tenant_id
// (single-tenant): "todos" simplemente significa todos los tr069_devices.
export const genieacsSyncRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
const PPP_WRITE = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] as const;

genieacsSyncRoutes.use('*', requireAuth, requireRole(...STAFF_READ));
genieacsSyncRoutes.route('/wifi', wifiPreparationRoutes);
// No dejar el provisionado combinado como vía alternativa a WiFi/PPPoE.
genieacsSyncRoutes.post('/pppoe/:serial', tr069PreparationOnly);
genieacsSyncRoutes.post('/provision/:serial', tr069PreparationOnly);

function nbiUrl() {
  return process.env.GENIEACS_NBI || 'http://localhost:7557';
}

/**
 * Recolecta metricas de TODOS los tr069_devices registrados. Extraido de la
 * ruta POST /metrics para poder llamarlo tanto desde el panel como desde el
 * scheduler automatico (ver server/src/services/tr069Scheduler.ts).
 */
export async function collectAllTr069Metrics() {
  const { data: devices, error } = await supabaseAdmin.from('tr069_devices').select('id, genieacs_id');
  if (error) return { ok: false as const, error: error.message };

  const results = await Promise.all(
    (devices ?? []).map((d) => collectMetricsForDevice(nbiUrl(), d.id, d.genieacs_id)),
  );
  const ok = results.filter((r) => r.ok).length;
  return { ok: true as const, collected: ok, failed: results.length - ok, total: results.length };
}

genieacsSyncRoutes.post('/metrics', async (c) => {
  const result = await collectAllTr069Metrics();
  return c.json(result, result.ok ? 200 : 500);
});

genieacsSyncRoutes.post('/metrics/device/:id', async (c) => {
  const id = c.req.param('id');
  const { data: device, error } = await supabaseAdmin.from('tr069_devices').select('id, genieacs_id').eq('id', id).single();
  if (error || !device) return c.json({ error: 'Dispositivo TR-069 no encontrado' }, 404);

  const result = await collectMetricsForDevice(nbiUrl(), device.id, device.genieacs_id);
  if (!result.ok) return c.json(result, 502);
  return c.json(result);
});

// PPPoE (WANPPPConnection) por numero de serie del CPE — se usa el serial
// en vez del id de tr069_devices porque la ONT (olt_onts) es la que se
// muestra en la ficha del cliente, y no siempre tiene un tr069_devices
// vinculado todavia (el scheduler lo crea solo despues del primer Inform).
genieacsSyncRoutes.get('/pppoe/:serial', async (c) => {
  const serial = c.req.param('serial');
  try {
    const info = await getPppoeInfo(nbiUrl(), serial);
    return c.json(info);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar GenieACS' }, 502);
  }
});

// Dispositivos conectados (Hosts) — solo lectura de la caché ya reportada por el
// equipo, nunca encola una tarea nueva. Mismo criterio de identidad exacta por
// serial que PPPoE/WiFi: nunca mezcla datos de otra ONT.
genieacsSyncRoutes.get('/hosts/:serial', async (c) => {
  const serial = c.req.param('serial') ?? '';
  try {
    return c.json(await readHostsInventory(nbiUrl(), serial));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar GenieACS' }, 502);
  }
});

// Reiniciar el equipo
genieacsSyncRoutes.post('/reboot/:serial', requireRole(...PPP_WRITE), async (c) => {
  const serial = c.req.param('serial') ?? '';
  try {
    const result = await queueReboot(nbiUrl(), serial);
    return c.json(result, result.ok ? 200 : 502);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'Error al contactar GenieACS' }, 502);
  }
});

// Refrescar ahora (connection request), en vez de esperar al proximo Inform periodico
genieacsSyncRoutes.post('/refresh/:serial', requireRole(...PPP_WRITE), async (c) => {
  const serial = c.req.param('serial') ?? '';
  try {
    const result = await queueRefresh(nbiUrl(), serial);
    return c.json(result, result.ok ? 200 : 502);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'Error al contactar GenieACS' }, 502);
  }
});
