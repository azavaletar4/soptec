import { supabaseAdmin } from '../lib/supabaseAdmin';
import { runOltFullSync } from './oltSyncService';
import type { OltDeviceRow } from '../lib/oltDevice';

// Mismo patron que tr069Scheduler.ts: un solo proceso backend (PM2 sin
// balanceo entre instancias) -> alcanza con setInterval en vez de un
// scheduler tipo cron con estado compartido.

const SYNC_INTERVAL_MS = Number(process.env.OLT_SYNC_INTERVAL_MINUTES ?? 20) * 60_000;
// Antes del primer tick, para no pisarse con el arranque del server.
const INITIAL_DELAY_MS = 30_000;

let tickRunning = false;

async function runTick() {
  if (tickRunning) return; // evita solaparse si una corrida anterior sigue viva
  tickRunning = true;
  try {
    const { data, error } = await supabaseAdmin.from('olt_devices').select('*').eq('is_active', true);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[olt-sync-scheduler] no se pudo listar las OLTs activas:', error.message);
      return;
    }

    const devices = (data ?? []) as OltDeviceRow[];
    // Secuencial entre OLTs tambien (no Promise.all): son equipos fisicos
    // distintos asi que en teoria no chocarian entre si, pero se mantiene
    // simple y predecible mientras el proyecto tenga una sola OLT real.
    for (const device of devices) {
      try {
        const result = await runOltFullSync(device);
        if (result) {
          // eslint-disable-next-line no-console
          console.log(
            `[olt-sync-scheduler] ${device.name}: online=${result.online} offline=${result.offline} ` +
              `sin-autorizar=${result.unconfigured} senal-baja=${result.lowSignal} actualizadas=${result.updatedOnts} ` +
              `puertos=${result.portsScanned}${result.failedPorts.length ? ` (fallaron: ${result.failedPorts.join(', ')})` : ''}`,
          );
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[olt-sync-scheduler] ${device.name}: excepcion durante el sync:`, e);
      }
    }
  } finally {
    tickRunning = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts). Se puede
 * desactivar con OLT_SYNC_SCHEDULER_ENABLED=false.
 */
export function startOltSyncScheduler() {
  if (process.env.OLT_SYNC_SCHEDULER_ENABLED === 'false') {
    // eslint-disable-next-line no-console
    console.log('[olt-sync-scheduler] desactivado (OLT_SYNC_SCHEDULER_ENABLED=false)');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[olt-sync-scheduler] activo: sync completo cada ${SYNC_INTERVAL_MS / 60_000} min`);
  setTimeout(() => void runTick(), INITIAL_DELAY_MS);
  setInterval(() => void runTick(), SYNC_INTERVAL_MS);
}
