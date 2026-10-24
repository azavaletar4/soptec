import {
  cleanupOldSamples,
  fetchLiveReading,
  getConfiguredBorderDevices,
  persistSampleAndEvaluateAlerts,
  updateLiveSnapshotFromReading,
} from './mikrotikBorderTrafficService';

// Fase 172 — un solo ciclo (por defecto cada 5s) sondea TODOS los routers de
// borde dedicado ya configurados y actualiza la cache "en vivo" (memoria,
// nunca Supabase) que leen las pestañas del panel — asi N admins viendo la
// misma pantalla generan una sola consulta real al router, nunca N.
//
// Cada `PERSIST_EVERY_N_TICKS` ciclos (por defecto 12 => 60s) ese mismo
// sondeo, ya hecho, tambien se persiste en Supabase (mikrotik_interface_
// samples) y dispara la evaluacion de alertas de saturacion — sin pedirle
// una segunda vuelta al router solo para guardar historico.
//
// Mismo patron que mikrotikReconcileScheduler.ts: setInterval simple (un
// solo proceso backend, sin balanceo), flag *_ENABLED, intervalo por .env,
// guard contra solapamiento.

const LIVE_INTERVAL_MS = Number(process.env.MIKROTIK_BORDER_TRAFFIC_LIVE_INTERVAL_SECONDS ?? 5) * 1000;
const PERSIST_EVERY_N_TICKS = Number(process.env.MIKROTIK_BORDER_TRAFFIC_PERSIST_EVERY_N_TICKS ?? 12); // 12 * 5s = 60s
const RETENTION_CLEANUP_EVERY_N_PERSISTS = 1440; // ~1 vez al dia (1440 * 60s)
const INITIAL_DELAY_MS = 20_000; // escalonado respecto a los otros schedulers (tr069/debtHold/reconcile/trafficAnalytics)

let tick = 0;
let persistCount = 0;
let running = false;

async function runTick() {
  if (running) return;
  running = true;
  try {
    const devices = await getConfiguredBorderDevices();
    tick += 1;
    const shouldPersist = tick % PERSIST_EVERY_N_TICKS === 0;

    for (const device of devices) {
      const reading = await fetchLiveReading(device);
      updateLiveSnapshotFromReading(device, reading);
      if (shouldPersist) {
        try {
          await persistSampleAndEvaluateAlerts(device, reading);
        } catch (e) {
          console.error(`[mikrotik-border-traffic] error al guardar historico de "${device.name}":`, e instanceof Error ? e.message : e);
        }
      }
    }

    if (shouldPersist) {
      persistCount += 1;
      if (persistCount % RETENTION_CLEANUP_EVERY_N_PERSISTS === 0) {
        await cleanupOldSamples().catch((e) => console.error('[mikrotik-border-traffic] error en limpieza de retencion:', e instanceof Error ? e.message : e));
      }
    }
  } catch (e) {
    console.error('[mikrotik-border-traffic] exception:', e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

export function startMikrotikBorderTrafficScheduler() {
  if (process.env.MIKROTIK_BORDER_TRAFFIC_ENABLED === 'false') {
    console.log('[mikrotik-border-traffic] desactivado (MIKROTIK_BORDER_TRAFFIC_ENABLED=false)');
    return;
  }
  console.log(`[mikrotik-border-traffic] activo: sondeo cada ${LIVE_INTERVAL_MS / 1000}s, historico cada ${(LIVE_INTERVAL_MS * PERSIST_EVERY_N_TICKS) / 1000}s`);
  setTimeout(() => void runTick(), INITIAL_DELAY_MS);
  setInterval(() => void runTick(), LIVE_INTERVAL_MS);
}
