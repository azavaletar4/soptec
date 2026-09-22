import { flagOverdueContracts } from './debtHoldService';

// Marca (nunca aplica) contratos con facturas vencidas — mismo patron que
// tr069Scheduler.ts (setInterval, un solo proceso backend via PM2, sin cron
// compartido). flagOverdueContracts() es idempotente (solo actua sobre
// contratos en debt_hold_status='none'), asi que no hace falta logica de
// "una vez al dia": correr mas seguido solo detecta mas rapido, sin
// duplicar nada.

const SCAN_INTERVAL_MS = Number(process.env.DEBT_HOLD_SCAN_INTERVAL_MINUTES ?? 360) * 60_000; // 6h por defecto
const INITIAL_DELAY_MS = 45_000; // despues del de TR-069, para no arrancar todo junto

let scanRunning = false;

async function runScan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const result = await flagOverdueContracts();
    // eslint-disable-next-line no-console
    console.log(`[debt-hold-scheduler] escaneo OK: ${result.flagged}/${result.scanned} marcados (${result.errors} errores)`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[debt-hold-scheduler] escaneo exception:', e);
  } finally {
    scanRunning = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts). Se puede
 * desactivar con DEBT_HOLD_SCHEDULER_ENABLED=false.
 */
export function startDebtHoldScheduler() {
  if (process.env.DEBT_HOLD_SCHEDULER_ENABLED === 'false') {
    // eslint-disable-next-line no-console
    console.log('[debt-hold-scheduler] desactivado (DEBT_HOLD_SCHEDULER_ENABLED=false)');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[debt-hold-scheduler] activo: escaneo cada ${SCAN_INTERVAL_MS / 60_000} min`);
  setTimeout(() => void runScan(), INITIAL_DELAY_MS);
  setInterval(() => void runScan(), SCAN_INTERVAL_MS);
}
