import { discoverAndSyncBalancerConnections, getConfiguredBalancerDevices } from './mikrotikBalancerDiscoveryService';
import { supabaseAdmin } from '../lib/supabaseAdmin';

// Fase 174 — un solo ciclo (por defecto cada 60s) descubre y sincroniza las
// conexiones WAN de TODOS los routers balanceadores ya clasificados
// (device_role='borde_balanceador') — nunca asume cuantos routers ni
// cuantas conexiones por router haya (requisito 10). Mismo patron que
// mikrotikBorderTrafficScheduler.ts/mikrotikReconcileScheduler.ts.

const INTERVAL_MS = Number(process.env.MIKROTIK_BALANCER_DISCOVERY_INTERVAL_SECONDS ?? 60) * 1000;
const INITIAL_DELAY_MS = 25_000; // escalonado respecto a los demas schedulers de MikroTik
const RETENTION_DAYS = Number(process.env.MIKROTIK_BALANCER_RETENTION_DAYS ?? 45);
const RETENTION_CLEANUP_EVERY_N_TICKS = 1440; // ~1 vez al dia (1440 * 60s)

let tick = 0;
let running = false;

async function cleanupOldSamples(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await supabaseAdmin.from('mikrotik_balancer_connection_samples').delete().lt('sampled_at', cutoff);
}

async function runTick() {
  if (running) return;
  running = true;
  try {
    const devices = await getConfiguredBalancerDevices();
    for (const device of devices) {
      try {
        await discoverAndSyncBalancerConnections(device);
      } catch (e) {
        console.error(`[mikrotik-balancer-discovery] error en "${device.name}":`, e instanceof Error ? e.message : e);
      }
    }
    tick += 1;
    if (tick % RETENTION_CLEANUP_EVERY_N_TICKS === 0) {
      await cleanupOldSamples().catch((e) => console.error('[mikrotik-balancer-discovery] error en limpieza de retencion:', e instanceof Error ? e.message : e));
    }
  } catch (e) {
    console.error('[mikrotik-balancer-discovery] exception:', e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

export function startMikrotikBalancerDiscoveryScheduler() {
  if (process.env.MIKROTIK_BALANCER_DISCOVERY_ENABLED === 'false') {
    console.log('[mikrotik-balancer-discovery] desactivado (MIKROTIK_BALANCER_DISCOVERY_ENABLED=false)');
    return;
  }
  console.log(`[mikrotik-balancer-discovery] activo: cada ${INTERVAL_MS / 1000}s`);
  setTimeout(() => void runTick(), INITIAL_DELAY_MS);
  setInterval(() => void runTick(), INTERVAL_MS);
}
