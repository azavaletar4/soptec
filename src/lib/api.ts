import { supabase } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';

/**
 * Cliente para llamar al backend Hono (rutas privadas: OLT, MikroTik, TR-069...).
 * Usa rutas relativas: en dev, el proxy de Vite las redirige a localhost:3001;
 * en produccion, Hono sirve el frontend y la API desde el mismo origen.
 *
 * `timeoutMs` es opcional y queda SIN valor por defecto a proposito: la
 * mayoria de las rutas (clientes, contratos, facturacion...) no deberian
 * tener un limite de tiempo propio distinto del que ya impone el navegador/
 * red. Los callers que si lo necesitan (operaciones que pasan por Telnet
 * contra la OLT real, ver oltStore.getSignal) lo piden explicitamente.
 */
export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };

  const { res, body } = await fetchWithTimeout(path, { ...options, headers }, timeoutMs, async (response) => {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch (e) {
      // Un body vacio o no-JSON (ej. 204, o una ruta que no devuelve nada)
      // SI se trata como "sin body" — comportamiento ya existente. Pero un
      // abort (por timeout o por cancelacion externa) NO es "body invalido":
      // es un fallo real que debe propagarse, no esconderse detras de un
      // `null` silencioso (antes `res.json().catch(() => null)` ocultaba
      // esto por igual, dejando a quien llama sin saber que la consulta
      // realmente se cancelo a medio leer la respuesta).
      if (!(e instanceof SyntaxError)) throw e;
    }
    return { res: response, body: parsed };
  });

  if (!res.ok) {
    // Distintas rutas usan 'error' (la mayoria) o 'message' (ej. /olt-devices/:id/test).
    let message = `Error ${res.status}`;
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.error === 'string') message = b.error;
      else if (typeof b.message === 'string') message = b.message;
    }
    throw new Error(message);
  }

  return body as T;
}
