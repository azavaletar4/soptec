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

/**
 * Llama a la REST API de RouterOS v7+ (https://{host}:{port}/rest/...).
 * Requiere que el servicio www-ssl (o www, sin TLS) este habilitado en el
 * router con la REST API activa.
 */
export async function mikrotikRequest<T = unknown>(
  target: MikrotikTarget,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
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
    throw new Error(`No se pudo conectar a ${target.host}:${target.port} — ${detail}`);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && ('message' in data || 'detail' in data)
        ? String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).detail)
        : `MikroTik respondio ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}
