import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  getAnomalies,
  getBottlenecks,
  getClientDailyTotals,
  getLastTrafficSampleReport,
  getMonthlyTotals,
  getTopClients,
  getTrafficKpis,
  sampleTrafficUsage,
} from '../services/trafficAnalyticsService';

export const analyticsRoutes = new Hono();

// Consumo de todos los clientes es informacion sensible y de vision global
// de red (no una tarea de campo) — solo administracion, igual que /usuarios.
const STAFF_READ = ['SUPERADMIN', 'ADMIN'] as const;

analyticsRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

analyticsRoutes.get('/traffic/kpis', async (c) => {
  try {
    return c.json(await getTrafficKpis());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al calcular los KPI' }, 500);
  }
});

analyticsRoutes.get('/traffic/monthly', async (c) => {
  const months = Number(c.req.query('months') ?? 6);
  try {
    return c.json(await getMonthlyTotals(months));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al calcular la evolucion mensual' }, 500);
  }
});

analyticsRoutes.get('/traffic/clients/:contractId/daily', async (c) => {
  const days = Number(c.req.query('days') ?? 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    return c.json(await getClientDailyTotals(c.req.param('contractId'), since));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al calcular el consumo del cliente' }, 500);
  }
});

analyticsRoutes.get('/traffic/top-clients', async (c) => {
  const limit = Number(c.req.query('limit') ?? 10);
  try {
    return c.json(await getTopClients(limit));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al calcular el top de clientes' }, 500);
  }
});

analyticsRoutes.get('/traffic/bottlenecks', async (c) => {
  const threshold = Number(c.req.query('threshold') ?? 85);
  try {
    return c.json(await getBottlenecks(threshold));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al calcular cuellos de botella' }, 500);
  }
});

analyticsRoutes.get('/traffic/anomalies', async (c) => {
  try {
    return c.json(await getAnomalies());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al calcular anomalias' }, 500);
  }
});

// Informativo (cuando corrio el scheduler por ultima vez), mismo patron que
// /mikrotik/reconcile/report.
analyticsRoutes.get('/traffic/sample-report', async (c) => {
  return c.json(getLastTrafficSampleReport());
});

analyticsRoutes.post('/traffic/sample-now', requireRole('SUPERADMIN', 'ADMIN'), async (c) => {
  try {
    return c.json(await sampleTrafficUsage());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al muestrear' }, 500);
  }
});
