import { findContractsLinkedToNonAdminRouter, listPppoeAdminDeviceIds, reconcileMikrotikDevice } from './mikrotikReconcileService';

// Reconciliacion MikroTik -> Panel — mismo patron que debtHoldScheduler.ts /
// tr069Scheduler.ts (setInterval, un solo proceso backend via PM2).
//
// Fase 170: recorre SOLO routers pppoe_admin, uno por uno (nunca "todos en
// un combinado") — cada router guarda su propio reporte
// (mikrotikReconcileService.getLastReconcileReport(deviceId)), visible
// unicamente en el detalle de ESE router.

const SCAN_INTERVAL_MS = Number(process.env.MIKROTIK_RECONCILE_INTERVAL_MINUTES ?? 30) * 60_000; // 30 min por defecto
const INITIAL_DELAY_MS = 60_000; // despues de TR-069 (30s) y corte por deuda (45s)

let scanRunning = false;

async function runScan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const deviceIds = await listPppoeAdminDeviceIds();
    for (const deviceId of deviceIds) {
      try {
        const report = await reconcileMikrotikDevice(deviceId);
        // eslint-disable-next-line no-console
        console.log(
          `[mikrotik-reconcile] OK (${report.deviceName}): ${report.contractsChecked} contratos revisados, ` +
            `${report.profilesUpdated} perfil(es) actualizados, ${report.mismatches.length} diferencia(s)${report.error ? `, error: ${report.error}` : ''}`,
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[mikrotik-reconcile] error en router ${deviceId}:`, e instanceof Error ? e.message : e);
      }
    }

    // Requisito 8 (Fase 170): informar, nunca modificar, contratos cuyo
    // mikrotik_device_id apunta a un router que no es administrador PPPoE.
    const misassociated = await findContractsLinkedToNonAdminRouter();
    if (misassociated.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mikrotik-reconcile] ${misassociated.length} contrato(s) vinculado(s) a un router que NO es administrador PPPoE (revisar manualmente, no se modifico nada): ` +
          misassociated.map((m) => `${m.contractNumber} -> ${m.deviceName} (${m.deviceRole})`).join('; '),
      );
    }
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
