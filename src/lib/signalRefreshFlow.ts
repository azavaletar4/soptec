import { getErrorMessage } from './errors';

/**
 * Flujo de "Consultar señal", extraido de OntDetailModal.vue como funcion
 * pura (sin Vue/Pinia/Supabase) para poder probarlo con el runner nativo de
 * Node — ver __tests__/signalRefreshFlow.test.ts.
 *
 * Bug real reportado (ronda de revision): la version anterior esperaba
 * `getSignal()` Y DESPUES `fetchOnts()` (recarga del listado COMPLETO del
 * dispositivo, ~627KB en produccion) antes de soltar el boton
 * "Consultar señal" — el timeout que se le agrego a `getSignal()` no cubria
 * esa segunda espera, asi que un `fetchOnts()` lento (o sin su propio
 * timeout) podia dejar "Consultando..." colgado igual.
 *
 * Esta version: usa el rx/tx que YA devolvio `getSignal()` (el backend ya
 * los persistio en Supabase antes de responder) para actualizar la ONU en
 * memoria sin ninguna llamada de red adicional, y dispara el refresco del
 * listado completo EN SEGUNDO PLANO, sin esperarlo nunca ni dejar que su
 * fallo se reporte como un error de esta consulta puntual.
 */
export interface SignalReading {
  rxPower: number | null;
  txPower: number | null;
}

export interface SignalRefreshDeps {
  /** Ej. oltStore.getSignal(deviceId, ontDbId) — ya tiene su propio timeout. */
  getSignal: () => Promise<SignalReading>;
  /** Ej. oltStore.patchOntSignal(ontDbId, rx, tx) — mutacion local, sin red. */
  patchOntSignal: (rxPower: number | null, txPower: number | null) => void;
  /**
   * Ej. oltStore.fetchOnts(deviceId) — refresco del listado completo, EN
   * SEGUNDO PLANO. Nunca se espera ni se deja que bloquee o haga fallar el
   * resultado de runSignalRefresh (ver abajo: se dispara con `void` + su
   * propio `.catch()`).
   */
  refreshList: () => Promise<void>;
}

export interface SignalRefreshResult {
  ok: boolean;
  /** Mensaje legible, solo presente cuando ok=false. */
  error?: string;
}

export async function runSignalRefresh(deps: SignalRefreshDeps): Promise<SignalRefreshResult> {
  try {
    const { rxPower, txPower } = await deps.getSignal();
    deps.patchOntSignal(rxPower, txPower);

    // A proposito NUNCA se espera: si refreshList() tarda o falla, no debe
    // retrasar ni hacer fallar esta consulta puntual, que ya se resolvio
    // arriba con el valor real que devolvio la OLT via getSignal().
    void deps.refreshList().catch(() => {});

    return { ok: true };
  } catch (e) {
    return { ok: false, error: getErrorMessage(e, 'Error al leer la señal óptica') };
  }
}
