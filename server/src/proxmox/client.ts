import { Agent, fetch as undiciFetch } from 'undici';

// Proxmox VE en la LAN local, casi siempre con certificado autofirmado
// (mismo criterio que server/src/mikrotik/client.ts) — se acepta
// explicitamente solo para este cliente, no de forma global.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export interface ProxmoxConfig {
  host: string;
  port: number;
  /** Formato completo "USER@REALM!TOKENID" (ej. smartrayco-api@pve!smartrayco). */
  tokenId: string;
  tokenSecret: string;
}

function getConfig(): ProxmoxConfig {
  const host = process.env.PROXMOX_HOST ?? '';
  const tokenId = process.env.PROXMOX_TOKEN_ID ?? '';
  const tokenSecret = process.env.PROXMOX_TOKEN_SECRET ?? '';
  if (!host || !tokenId || !tokenSecret) {
    throw new Error(
      'Falta configurar Proxmox: PROXMOX_HOST / PROXMOX_TOKEN_ID / PROXMOX_TOKEN_SECRET en el .env del backend ' +
        '(ver .env.example, seccion Proxmox VE).',
    );
  }
  return { host, port: Number(process.env.PROXMOX_PORT ?? 8006), tokenId, tokenSecret };
}

class ProxmoxConnectionError extends Error {}
class ProxmoxHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Llama a la REST API de Proxmox VE (https://{host}:{port}/api2/json/...),
 * autenticado con API Token (header "Authorization: PVEAPIToken=...") — sin
 * password de usuario ni cookies de sesion. Cada respuesta real de Proxmox
 * viene envuelta en {"data": ...}; esta funcion ya devuelve solo esa parte.
 */
export async function proxmoxRequest<T = unknown>(
  path: string,
  opts: { method?: string; body?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<T> {
  const cfg = getConfig();
  const url = `https://${cfg.host}:${cfg.port}/api2/json${path}`;

  let res: Response;
  try {
    res = await undiciFetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`,
        ...(opts.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: opts.body ? new URLSearchParams(opts.body as Record<string, string>).toString() : undefined,
      dispatcher: insecureAgent,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
    } as RequestInit);
  } catch (e) {
    const cause = e instanceof Error && 'cause' in e ? (e.cause as Error | undefined) : undefined;
    const detail = cause ? `${cause.message}${'code' in cause ? ` (${(cause as NodeJS.ErrnoException).code})` : ''}` : e instanceof Error ? e.message : String(e);
    throw new ProxmoxConnectionError(`No se pudo conectar a Proxmox (${cfg.host}:${cfg.port}) — ${detail}`);
  }

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = parsed?.errors ? JSON.stringify(parsed.errors) : parsed?.message ?? `Proxmox respondio ${res.status}`;
    throw new ProxmoxHttpError(message, res.status);
  }

  return (parsed?.data ?? null) as T;
}
