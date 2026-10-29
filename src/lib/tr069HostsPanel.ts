import { normalizeGponSerial } from './gponSerial';
import type { HostsInventory, HostsReadResult } from './tr069Hosts';

export interface HostsPanelState {
  opened: Record<string, boolean>;
  loading: Record<string, boolean>;
  inventory: Record<string, HostsInventory | null>;
  result: Record<string, HostsReadResult | null>;
  errors: Record<string, string | null>;
}
export const emptyHostsPanelState = (): HostsPanelState => ({ opened: {}, loading: {}, inventory: {}, result: {}, errors: {} });

export const GENERIC_HOSTS_ERROR = 'No se pudo completar la consulta. Se conserva la información anterior; vuelve a intentarlo cuando lo decidas.';

/**
 * La ruta `/hosts/:serial/read` (única que puede fallar por este camino)
 * SIEMPRE responde 409 con un mensaje ya escrito en lenguaje sencillo para
 * el administrador (ver `createHostsOnDemandRoutes` — nunca una traza ni un
 * texto técnico crudo en ese status exacto). Cualquier otro fallo (red,
 * timeout del cliente, error inesperado del servidor) no tiene esa garantía
 * y conserva el mensaje genérico, nunca un texto técnico sin traducir.
 */
export function plainHostsErrorMessage(error: unknown): string {
  if (error instanceof Error && (error as { status?: unknown }).status === 409 && error.message.trim()) return error.message;
  return GENERIC_HOSTS_ERROR;
}

/** Solo eventos explícitos; sin watchers, intervalos, reintentos ni llamadas al construir. */
export function createHostsPanelController(state: HostsPanelState, request: (serial: string, active: boolean) => Promise<HostsReadResult>) {
  const inFlight = new Map<string, Promise<HostsReadResult>>();
  async function load(key: string, raw: string, active: boolean) {
    const serial = normalizeGponSerial(raw);
    if (!serial) { state.errors[key] = 'No se pudo identificar este equipo.'; return; }
    const scope = serial + ':' + String(active);
    state.loading[key] = true; state.errors[key] = null;
    let job = inFlight.get(scope);
    if (!job) {
      job = Promise.resolve().then(() => request(serial, active)).finally(() => { inFlight.delete(scope); });
      inFlight.set(scope, job);
    }
    // La lista/hora anteriores nunca se tocan aquí: solo se actualizan arriba, al confirmar un resultado nuevo.
    try { const result = await job; state.result[key] = result; state.inventory[key] = result.inventory; }
    catch (error) { state.errors[key] = plainHostsErrorMessage(error); }
    finally { state.loading[key] = false; }
  }
  return {
    close(key: string) { state.opened[key] = false; },
    toggle(key: string, serial: string, active: boolean) {
      state.opened[key] = !state.opened[key];
      return state.opened[key] ? load(key, serial, active) : Promise.resolve();
    },
    refresh(key: string, serial: string, active: boolean) {
      return state.opened[key] ? load(key, serial, active) : Promise.resolve();
    },
  };
}
