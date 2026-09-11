import { syncTr069Devices } from '../routes/tr069sync';
import { collectAllTr069Metrics } from '../routes/genieacsSync';

// Corre el sync de dispositivos y la recoleccion de metricas TR-069 solos,
// sin depender de que alguien entre al panel y presione el boton. Un solo
// proceso backend (ver README: produccion via PM2, sin balanceo entre
// varias instancias) -> alcanza con setInterval en vez de un scheduler
// tipo cron con estado compartido.

const SYNC_INTERVAL_MS = Number(process.env.TR069_SYNC_INTERVAL_MINUTES ?? 15) * 60_000;
const METRICS_INTERVAL_MS = Number(process.env.TR069_METRICS_INTERVAL_MINUTES ?? 10) * 60_000;

// Antes del primer tick, para no pisarse con el arranque del server.
const INITIAL_DELAY_MS = 30_000;

let syncRunning = false;
let metricsRunning = false;

async function runSync() {
  if (syncRunning) return; // evita solaparse si una corrida anterior sigue viva
  syncRunning = true;
  try {
    const result = await syncTr069Devices();
    if (result.ok) {
      // eslint-disable-next-line no-console
      console.log(`[tr069-scheduler] sync OK: ${result.created} nuevos, ${result.synced} actualizados, ${result.total} en GenieACS`);
    } else {
      // eslint-disable-next-line no-console
      console.error('[tr069-scheduler] sync fallo:', result.error);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[tr069-scheduler] sync exception:', e);
  } finally {
    syncRunning = false;
  }
}

async function runMetrics() {
  if (metricsRunning) return;
  metricsRunning = true;
  try {
    const result = await collectAllTr069Metrics();
    if (result.ok) {
      // eslint-disable-next-line no-console
      console.log(`[tr069-scheduler] metricas OK: ${result.collected}/${result.total} (${result.failed} fallidas)`);
    } else {
      // eslint-disable-next-line no-console
      console.error('[tr069-scheduler] metricas fallo:', result.error);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[tr069-scheduler] metricas exception:', e);
  } finally {
    metricsRunning = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts). Se puede
 * desactivar con TR069_SCHEDULER_ENABLED=false (ej. en un dev sin GenieACS
 * levantado, para no llenar la consola de errores de conexion cada rato).
 */
export function startTr069Scheduler() {
  if (process.env.TR069_SCHEDULER_ENABLED === 'false') {
    // eslint-disable-next-line no-console
    console.log('[tr069-scheduler] desactivado (TR069_SCHEDULER_ENABLED=false)');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[tr069-scheduler] activo: sync cada ${SYNC_INTERVAL_MS / 60_000} min, metricas cada ${METRICS_INTERVAL_MS / 60_000} min`,
  );
  setTimeout(() => {
    void runSync();
    void runMetrics();
  }, INITIAL_DELAY_MS);
  setInterval(() => void runSync(), SYNC_INTERVAL_MS);
  setInterval(() => void runMetrics(), METRICS_INTERVAL_MS);
}
