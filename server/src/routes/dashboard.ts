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

/**
 * Resumen estilo SmartOLT agregado de TODAS las OLTs activas (suma de
 * sin-autorizar/online/offline/senal-baja). YA NO escanea las OLTs en vivo
 * (Fase 40): lee olt_sync_cache, llenada en segundo plano por
 * oltSyncScheduler.ts — instantaneo aunque haya varias OLTs.
 */
dashboardRoutes.get('/olt-summary', async (c) => {
  const { data: devices, error } = await supabaseAdmin
    .from('olt_devices')
    .select('id')
    .eq('is_active', true);
  if (error) return c.json({ error: error.message }, 500);

  const deviceIds = (devices ?? []).map((d) => d.id as string);
  const { data: cacheRows, error: cacheError } = deviceIds.length
    ? await supabaseAdmin
        .from('olt_sync_cache')
        .select('unconfigured, online, offline, low_signal, scan_complete, checked_at')
        .in('olt_device_id', deviceIds)
    : { data: [], error: null };
  if (cacheError) return c.json({ error: cacheError.message }, 500);

  const rows = cacheRows ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      unconfigured: acc.unconfigured + r.unconfigured,
      online: acc.online + r.online,
      offline: acc.offline + r.offline,
      lowSignal: acc.lowSignal + r.low_signal,
      scanComplete: acc.scanComplete && r.scan_complete,
    }),
    { unconfigured: 0, online: 0, offline: 0, lowSignal: 0, scanComplete: rows.length > 0 },
  );
  const checkedAt = rows.reduce<string | null>((oldest, r) => {
    if (!r.checked_at) return oldest;
    return !oldest || r.checked_at < oldest ? r.checked_at : oldest;
  }, null);

  return c.json({ ...totals, deviceCount: deviceIds.length, checkedAt });
});
