import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';

export const dashboardRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;

dashboardRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

interface DeviceStatusRow {
  name: string;
  host: string;
  last_test_ok: boolean | null;
}

/**
 * Resumen de estado de red para el Dashboard. No prueba los equipos en vivo
 * (seria lento con muchos dispositivos) — usa el resultado de la ultima vez
 * que alguien presiono "Probar conexion" en /olt o /mikrotik.
 */
dashboardRoutes.get('/network-status', async (c) => {
  const [{ data: olts, error: oltError }, { data: mts, error: mtError }] = await Promise.all([
    supabaseAdmin.from('olt_devices').select('name, host, last_test_ok').eq('is_active', true),
    supabaseAdmin.from('mikrotik_devices').select('name, host, last_test_ok').eq('is_active', true),
  ]);

  if (oltError || mtError) {
    return c.json({ error: (oltError ?? mtError)?.message }, 500);
  }

  const oltRows = (olts ?? []) as DeviceStatusRow[];
  const mtRows = (mts ?? []) as DeviceStatusRow[];

  const summarize = (rows: DeviceStatusRow[]) => ({
    total: rows.length,
    ok: rows.filter((r) => r.last_test_ok === true).length,
    down: rows.filter((r) => r.last_test_ok === false).length,
    untested: rows.filter((r) => r.last_test_ok === null).length,
  });

  const problems = [
    ...oltRows.filter((r) => r.last_test_ok === false).map((r) => ({ kind: 'OLT', name: r.name, host: r.host })),
    ...mtRows.filter((r) => r.last_test_ok === false).map((r) => ({ kind: 'MikroTik', name: r.name, host: r.host })),
  ];

  return c.json({
    olt: summarize(oltRows),
    mikrotik: summarize(mtRows),
    problems,
  });
});
