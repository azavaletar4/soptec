import { reconcileMikrotik } from './mikrotikReconcileService';

// Reconciliacion MikroTik -> Panel — mismo patron que debtHoldScheduler.ts /
// tr069Scheduler.ts (setInterval, un solo proceso backend via PM2).

const SCAN_INTERVAL_MS = Number(process.env.MIKROTIK_RECONCILE_INTERVAL_MINUTES ?? 30) * 60_000; // 30 min por defecto
const INITIAL_DELAY_MS = 60_000; // despues de TR-069 (30s) y corte por deuda (45s)

let scanRunning = false;

async function runScan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const report = await reconcileMikrotik();
    // eslint-disable-next-line no-console
    console.log(
      `[mikrotik-reconcile] OK: ${report.contractsChecked} contratos revisados en ${report.devicesChecked} router(s), ` +
        `${report.profilesUpdated} perfil(es) actualizados, ${report.mismatches.length} diferencia(s), ${report.errors.length} error(es)`,
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[mikrotik-reconcile] exception:', e);
  } finally {
    scanRunning = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts). Se puede
 * desactivar con MIKROTIK_RECONCILE_SCHEDULER_ENABLED=false.
 */
export function startMikrotikReconcileScheduler() {
  if (process.env.MIKROTIK_RECONCILE_SCHEDULER_ENABLED === 'false') {
    // eslint-disable-next-line no-console
    console.log('[mikrotik-reconcile] desactivado (MIKROTIK_RECONCILE_SCHEDULER_ENABLED=false)');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[mikrotik-reconcile] activo: cada ${SCAN_INTERVAL_MS / 60_000} min`);
  setTimeout(() => void runScan(), INITIAL_DELAY_MS);
  setInterval(() => void runScan(), SCAN_INTERVAL_MS);
}
