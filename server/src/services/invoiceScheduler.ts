import { generateDueInvoices } from './invoiceGenerationService';

// Mismo patron que debtHoldScheduler.ts (setInterval, un solo proceso
// backend via PM2). generateDueInvoices() es idempotente (siempre parte de
// la ultima factura ya creada por contrato), asi que correrlo de mas no
// duplica nada.
//
// A DIFERENCIA de los demas schedulers (tr069/debt-hold/mikrotik-reconcile),
// este arranca DESACTIVADO por defecto — es la primera vez que existe
// facturacion recurrente en este sistema, y activarla sola sobre ~675
// contratos reales sin haberla probado antes con el boton manual
// ("Generar facturas del mes" en Facturacion) es un riesgo que le
// corresponde asumir al usuario, no a un default.

const SCAN_INTERVAL_MS = Number(process.env.INVOICE_SCHEDULER_INTERVAL_MINUTES ?? 1440) * 60_000; // 24h por defecto
const INITIAL_DELAY_MS = 60_000; // despues de los demas schedulers

let running = false;

async function runGeneration() {
  if (running) return;
  running = true;
  try {
    const result = await generateDueInvoices();
    // eslint-disable-next-line no-console
    console.log(`[invoice-scheduler] generacion OK: ${result.generated} facturas nuevas de ${result.scanned} contratos (${result.errors.length} errores)`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[invoice-scheduler] generacion exception:', e);
  } finally {
    running = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts).
 * DESACTIVADO por defecto — activar explicitamente con
 * INVOICE_SCHEDULER_ENABLED=true recien despues de probar el boton manual.
 */
export function startInvoiceScheduler() {
  if (process.env.INVOICE_SCHEDULER_ENABLED !== 'true') {
    // eslint-disable-next-line no-console
    console.log('[invoice-scheduler] desactivado (default) — activar con INVOICE_SCHEDULER_ENABLED=true tras probar el botón manual "Generar facturas del mes"');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[invoice-scheduler] activo: generacion cada ${SCAN_INTERVAL_MS / 60_000} min`);
  setTimeout(() => void runGeneration(), INITIAL_DELAY_MS);
  setInterval(() => void runGeneration(), SCAN_INTERVAL_MS);
}
