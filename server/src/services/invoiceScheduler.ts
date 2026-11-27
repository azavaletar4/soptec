import { supabaseAdmin } from '../lib/supabaseAdmin';

// Fase 14. Reemplaza el stub anterior ("pausado: conciliación inicial
// pendiente") por el mecanismo real — pero deliberadamente DESACTIVADO por
// defecto (FINANCE_AUTO_INVOICE_ENABLED debe ser exactamente 'true'), igual
// patrón que TR069_HOSTS_ON_DEMAND_ENABLED/_SERIALS: requiere además una
// lista explícita de contratos (FINANCE_AUTO_INVOICE_CONTRACT_IDS, nunca
// "todos los contratos") y un perfil ADMIN/SUPERADMIN real y activo
// designado por el propietario como actor del sistema
// (FINANCE_AUTO_INVOICE_SYSTEM_ACTOR_ID) — nunca se inventa ni se asume uno;
// si falta cualquiera de las tres variables, el scheduler queda inerte.
//
// Llama a finance_generate_due_invoices_system (fase 14, SQL): solo
// contratos ya conciliados y con condiciones comerciales confirmadas, nunca
// cortesías; nunca factura un período que no empezó; idempotente por lote
// y por período natural (reintento tras una caída nunca duplica).
//
// NUNCA usa server/src/services/invoiceGenerationService.ts (fase 33b,
// preexistente): ese servicio nunca llegó a conectarse a ningún scheduler,
// no respeta cortesía/conciliación/modalidad comercial (usa solo el
// billing_day operativo heredado de fase 2/119) y facturaría a los 26
// contratos de cortesía si se activara por error. Se deja intacto, sin
// borrar, pero deliberadamente sin usar aquí.

const SCAN_INTERVAL_MS = Number(process.env.FINANCE_AUTO_INVOICE_SCAN_INTERVAL_MINUTES ?? 180) * 60_000;
const INITIAL_DELAY_MS = 30_000;
const MAX_PERIODS_PER_RUN = 3; // tope defensivo por corrida; una caída larga se recupera en varias corridas sucesivas, nunca de un solo golpe
// finance_generate_due_invoices_system rechaza más de 500 contratos por
// llamada (misma guarda de Fase 21: 'Lote, contratos o motivo inválidos').
// Desde que el alcance autorizado superó los 500 (Fase 28, 524 contratos),
// una sola llamada con la lista completa fallaba siempre — confirmado real:
// cero facturas generadas en ningún escaneo desde esa ampliación. Se parte
// en lotes de como mucho 500; cada lote usa su propio operation_id (sin
// necesidad de ser estable entre corridas — la idempotencia real que
// evita duplicar una factura ya la da la clave natural (contrato, período)
// dentro de finance_generate_due_invoices_system, no el operation_id).
const MAX_CONTRACTS_PER_CALL = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

let scanRunning = false;

function configuredContractIds(): string[] {
  return (process.env.FINANCE_AUTO_INVOICE_CONTRACT_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[0-9a-f-]{36}$/i.test(s));
}

async function runScan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    const contractIds = configuredContractIds();
    const systemActorId = process.env.FINANCE_AUTO_INVOICE_SYSTEM_ACTOR_ID ?? '';
    if (!contractIds.length || !systemActorId) {
      // eslint-disable-next-line no-console
      console.error('[invoice-scheduler] configuración incompleta (FINANCE_AUTO_INVOICE_CONTRACT_IDS/FINANCE_AUTO_INVOICE_SYSTEM_ACTOR_ID) — no se genera nada');
      return;
    }
    let totalCreated = 0;
    let totalSkipped = 0;
    for (const batch of chunk(contractIds, MAX_CONTRACTS_PER_CALL)) {
      const operationId = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.rpc('finance_generate_due_invoices_system', {
        p_system_actor_id: systemActorId,
        p_operation_id: operationId,
        p_contract_ids: batch,
        p_reason: 'Generación automática programada (invoice-scheduler, Fase 14)',
        p_max_periods: MAX_PERIODS_PER_RUN,
      });
      if (error) throw new Error(error.message);
      totalCreated += (data as { created?: unknown[] } | null)?.created?.length ?? 0;
      totalSkipped += (data as { skipped?: unknown[] } | null)?.skipped?.length ?? 0;
    }
    if (totalCreated > 0 || totalSkipped > 0) {
      // eslint-disable-next-line no-console
      console.log(`[invoice-scheduler] generadas ${totalCreated} facturas, ${totalSkipped} contratos no elegibles omitidos`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[invoice-scheduler] exception:', e);
  } finally {
    scanRunning = false;
  }
}

/**
 * Llamar una vez al arrancar el backend (ver server/src/index.ts). Permanece
 * inerte salvo que las TRES variables de entorno estén presentes:
 * FINANCE_AUTO_INVOICE_ENABLED=true, FINANCE_AUTO_INVOICE_CONTRACT_IDS
 * (lista explícita, nunca "todos"), FINANCE_AUTO_INVOICE_SYSTEM_ACTOR_ID
 * (perfil ADMIN/SUPERADMIN real ya existente, designado por el propietario).
 */
export function startInvoiceScheduler() {
  if (process.env.FINANCE_AUTO_INVOICE_ENABLED !== 'true') {
    // eslint-disable-next-line no-console
    console.info('[invoice-scheduler] pausado (FINANCE_AUTO_INVOICE_ENABLED no es "true") — ninguna factura se genera automáticamente');
    return;
  }
  const contractIds = configuredContractIds();
  if (!contractIds.length || !process.env.FINANCE_AUTO_INVOICE_SYSTEM_ACTOR_ID) {
    // eslint-disable-next-line no-console
    console.error('[invoice-scheduler] FINANCE_AUTO_INVOICE_ENABLED=true pero falta FINANCE_AUTO_INVOICE_CONTRACT_IDS o FINANCE_AUTO_INVOICE_SYSTEM_ACTOR_ID — se mantiene inerte');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[invoice-scheduler] activo: ${contractIds.length} contrato(s) en el alcance autorizado, escaneo cada ${SCAN_INTERVAL_MS / 60_000} min`);
  setTimeout(() => void runScan(), INITIAL_DELAY_MS);
  setInterval(() => void runScan(), SCAN_INTERVAL_MS);
}
