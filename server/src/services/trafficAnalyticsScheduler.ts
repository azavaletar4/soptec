import { sampleTrafficUsage } from './trafficAnalyticsService';

// Mismo enfoque que tr069Scheduler.ts: un solo proceso backend (PM2, sin
// balanceo) -> alcanza con setInterval, sin un scheduler tipo cron.

const INTERVAL_MS = Number(process.env.TRAFFIC_ANALYTICS_INTERVAL_MINUTES ?? 10) * 60_000;
const INITIAL_DELAY_MS = 45_000; // despues del arranque, y despues del tr069Scheduler (30s)

let running = false;

async function runSample() {
  if (running) return;
  running = true;
  try {
    const report = await sampleTrafficUsage();
    // eslint-disable-next-line no-console
    console.log(
      `[traffic-analytics-scheduler] OK: ${report.samplesInserted} muestras (${report.contractsChecked} contratos, ${report.devicesChecked} routers)` +
        (report.errors.length ? ` — ${report.errors.length} error(es)` : ''),
    );
    if (report.errors.length) {
      // eslint-disable-next-line no-console
      console.error('[traffic-analytics-scheduler] errores:', report.errors);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[traffic-analytics-scheduler] exception:', e);
  } finally {
    running = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts). Se puede
 * desactivar con TRAFFIC_ANALYTICS_SCHEDULER_ENABLED=false.
 */
export function startTrafficAnalyticsScheduler() {
  if (process.env.TRAFFIC_ANALYTICS_SCHEDULER_ENABLED === 'false') {
    // eslint-disable-next-line no-console
    console.log('[traffic-analytics-scheduler] desactivado (TRAFFIC_ANALYTICS_SCHEDULER_ENABLED=false)');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[traffic-analytics-scheduler] activo: muestreo cada ${INTERVAL_MS / 60_000} min`);
  setTimeout(() => void runSample(), INITIAL_DELAY_MS);
  setInterval(() => void runSample(), INTERVAL_MS);
}
