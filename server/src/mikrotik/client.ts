import { Agent, fetch as undiciFetch } from 'undici';

export interface MikrotikTarget {
  host: string;
  port: number;
  useTls: boolean;
  username: string;
  password: string;
}

// La mayoria de ISPs usa certificados autofirmados en el router; se acepta
// explicitamente (mismo criterio que documenta el curso para este caso).
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

/** No se pudo ni conectar (timeout, DNS, TLS, conexion rechazada) — siempre reintentable. */
class MikrotikConnectionError extends Error {}

/** El router respondio, pero con error HTTP — solo 5xx/429 son reintentables (un 4xx no mejora reintentando). */
class MikrotikHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isRetryable(e: unknown): boolean {
  if (e instanceof MikrotikConnectionError) return true;
  if (e instanceof MikrotikHttpError) return e.status >= 500 || e.status === 429;
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mikrotikRequestOnce<T>(
  target: MikrotikTarget,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const scheme = target.useTls ? 'https' : 'http';
  const url = `${scheme}://${target.host}:${target.port}/rest${path}`;
  const auth = Buffer.from(`${target.username}:${target.password}`).toString('base64');

  let res: Response;
  try {
    res = await undiciFetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      dispatcher: target.useTls ? insecureAgent : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    } as RequestInit);
  } catch (e) {
    // undici envuelve la causa real (ECONNREFUSED, certificado, DNS...) en
    // `error.cause`, no en `error.message` (que suele decir solo "fetch failed").
    const cause = e instanceof Error && 'cause' in e ? (e.cause as Error | undefined) : undefined;
    const detail = cause ? `${cause.message}${'code' in cause ? ` (${(cause as NodeJS.ErrnoException).code})` : ''}` : e instanceof Error ? e.message : String(e);
    throw new MikrotikConnectionError(`No se pudo conectar a ${target.host}:${target.port} — ${detail}`);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && ('message' in data || 'detail' in data)
        ? String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).detail)
        : `MikroTik respondio ${res.status}`;
    throw new MikrotikHttpError(message, res.status);
  }

  return data as T;
}

/**
 * Llama a la REST API de RouterOS v7+ (https://{host}:{port}/rest/...).
 * Requiere que el servicio www-ssl (o www, sin TLS) este habilitado en el
 * router con la REST API activa.
 *
 * Reintenta automaticamente (con backoff simple) fallos transitorios —
 * timeout, conexion rechazada, 5xx/429 — hasta `retries` veces (default 2,
 * o sea 3 intentos en total). Un 4xx (credenciales invalidas, recurso no
 * encontrado, etc.) NO se reintenta: no va a mejorar solo por insistir.
 */
export async function mikrotikRequest<T = unknown>(
  target: MikrotikTarget,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const maxAttempts = 1 + (opts.retries ?? 2);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await mikrotikRequestOnce<T>(target, path, opts);
    } catch (e) {
      lastError = e;
      if (attempt === maxAttempts || !isRetryable(e)) throw e;
      await sleep(attempt * 500); // 500ms, 1000ms, ...
    }
  }
  throw lastError;
}
