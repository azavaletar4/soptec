import { flagUpcomingScheduleAlerts } from './scheduleAlertService';

// Mismo patron que debtHoldScheduler.ts: setInterval en el unico proceso
// backend (PM2/Docker, sin balanceo entre instancias), nada de cron
// compartido. Corre cada pocos minutos (no cada 30) para no perderse el
// aviso si una orden se agenda ya casi en la ventana de 30 min.

const SCAN_INTERVAL_MS = Number(process.env.SCHEDULE_ALERT_SCAN_INTERVAL_MINUTES ?? 2) * 60_000;
const INITIAL_DELAY_MS = 20_000;

let scanRunning = false;

async function runScan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const result = await flagUpcomingScheduleAlerts();
    const total = result.tickets + result.installations + result.routines;
    if (total > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[schedule-alert-scheduler] marcadas ${total} alertas (tickets=${result.tickets}, instalaciones=${result.installations}, rutinas=${result.routines})`,
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[schedule-alert-scheduler] exception:', e);
  } finally {
    scanRunning = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts). Se puede
 * desactivar con SCHEDULE_ALERT_SCHEDULER_ENABLED=false.
 */
export function startScheduleAlertScheduler() {
  if (process.env.SCHEDULE_ALERT_SCHEDULER_ENABLED === 'false') {
    // eslint-disable-next-line no-console
    console.log('[schedule-alert-scheduler] desactivado (SCHEDULE_ALERT_SCHEDULER_ENABLED=false)');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[schedule-alert-scheduler] activo: escaneo cada ${SCAN_INTERVAL_MS / 60_000} min`);
  setTimeout(() => void runScan(), INITIAL_DELAY_MS);
  setInterval(() => void runScan(), SCAN_INTERVAL_MS);
}
