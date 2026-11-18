import { mikrotikRequest } from '../mikrotik/client';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { discoverAndSyncBalancerConnections, type BalancerDbClient, type BalancerDeviceRow } from './mikrotikBalancerDiscoveryService';

// Fase 174c (18/11/2026) -- alternativa C del diagnostico de exceso de Log
// Ingestion de Supabase (ver docs/SUPABASE-LOG-INGESTION-*): el
// descubrimiento ESENCIAL (conexiones + alertas de caida/recuperacion de
// enlaces WAN) sigue corriendo de fondo cada
// MIKROTIK_BALANCER_DISCOVERY_INTERVAL_SECONDS (ahora 300s por defecto) para
// nunca perder una averia que ocurre con el panel cerrado -- eso NO se
// detiene. Lo que cambia es que las MUESTRAS de trafico detalladas (el
// volumen real del problema) tambien se refrescan BAJO DEMANDA cuando
// alguien abre la vista del balanceador, en vez de esperar al proximo ciclo
// de fondo.
//
// Esta capa solo decide CUANDO correr un ciclo (guardia de concurrencia +
// ventana de frescura) -- la logica de QUE hacer en un ciclo sigue siendo
// exactamente discoverAndSyncBalancerConnections (el batch ya probado en
// fix/mikrotik-balancer-batch-logs-20261118), nunca se duplica ni se
// reescribe aqui.

// Si ya hubo un intento (exitoso o no) hace menos de esto, una solicitud
// bajo demanda nueva no dispara otro ciclo -- evita que las 3 lecturas casi
// simultaneas que la vista dispara al montarse (conexiones + historico +
// alertas) o el poll de 60s del frontend multipliquen el trabajo real
// contra el router/Supabase.
export const BALANCER_ON_DEMAND_FRESHNESS_SECONDS = Number(process.env.MIKROTIK_BALANCER_ON_DEMAND_FRESHNESS_SECONDS ?? 30);

interface DeviceRunState {
  // Promesa compartida mientras un ciclo (del scheduler O bajo demanda) esta
  // en vuelo para este dispositivo -- nunca se ejecutan dos a la vez
  // (requisito: evitar ejecuciones simultaneas y solicitudes duplicadas).
  inFlight: Promise<void> | null;
  // Se actualiza tanto en exito como en fallo -- un router caido no debe
  // hacer que CADA GET reintente de inmediato; el proximo intento real
  // llega con el siguiente ciclo esencial o cuando expire la ventana de frescura.
  lastAttemptAt: number | null;
}

// Un solo proceso backend (sin balanceo, mismo criterio que el resto de
// schedulers de este repo) -- un Map en memoria de ESTE proceso alcanza.
const runState = new Map<string, DeviceRunState>();

function stateFor(deviceId: string): DeviceRunState {
  let state = runState.get(deviceId);
  if (!state) {
    state = { inFlight: null, lastAttemptAt: null };
    runState.set(deviceId, state);
  }
  return state;
}

function guardedRun(device: BalancerDeviceRow, db: BalancerDbClient, fetchFn: typeof mikrotikRequest): Promise<void> {
  const state = stateFor(device.id);
  if (state.inFlight) return state.inFlight; // coalescia: comparte el mismo resultado, nunca dispara un segundo ciclo
  const job = discoverAndSyncBalancerConnections(device, new Date(), db, fetchFn).finally(() => {
    state.lastAttemptAt = Date.now();
    state.inFlight = null;
  });
  state.inFlight = job;
  return job;
}

/**
 * Entrada del SCHEDULER (ciclo esencial, cada
 * MIKROTIK_BALANCER_DISCOVERY_INTERVAL_SECONDS): siempre intenta correr --
 * a diferencia de ensureFreshBalancerData, nunca se salta por frescura (su
 * trabajo es justamente mantenerla). Solo se coordina con la guardia de
 * concurrencia para no pisar un ciclo bajo demanda que ya este en vuelo
 * para el mismo dispositivo -- en ese caso comparte ese resultado en vez de
 * lanzar un segundo ciclo en paralelo.
 */
export function runScheduledBalancerCycle(
  device: BalancerDeviceRow,
  db: BalancerDbClient = supabaseAdmin,
  fetchFn: typeof mikrotikRequest = mikrotikRequest,
): Promise<void> {
  return guardedRun(device, db, fetchFn);
}

/**
 * Entrada BAJO DEMANDA: se llama desde las rutas GET de conexiones/
 * historico/alertas del balanceador, justo antes de leer de Supabase. Si ya
 * hubo un intento hace menos de `freshnessSeconds`, no hace nada -- la
 * lectura que sigue ya va a servir datos recientes. NUNCA lanza: un fallo
 * de refresco jamas debe romper la pantalla, solo se registra y la ruta
 * sigue sirviendo lo que ya hay guardado (igual filosofia que
 * tr069HostsOnDemand.ts).
 */
export async function ensureFreshBalancerData(
  device: BalancerDeviceRow,
  db: BalancerDbClient = supabaseAdmin,
  fetchFn: typeof mikrotikRequest = mikrotikRequest,
  freshnessSeconds: number = BALANCER_ON_DEMAND_FRESHNESS_SECONDS,
): Promise<void> {
  const state = stateFor(device.id);
  if (state.inFlight) {
    await state.inFlight.catch(() => undefined);
    return;
  }
  if (state.lastAttemptAt !== null && Date.now() - state.lastAttemptAt < freshnessSeconds * 1000) {
    return; // ya se intento hace poco -- no duplicar la solicitud
  }
  try {
    await guardedRun(device, db, fetchFn);
  } catch (e) {
    console.error(`[mikrotik-balancer-on-demand] error en "${device.name}":`, e instanceof Error ? e.message : e);
  }
}

/** Solo para pruebas: limpia el estado en memoria entre casos. */
export function resetBalancerOnDemandStateForTests(): void {
  runState.clear();
}
