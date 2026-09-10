import { supabase } from './supabase';

/**
 * Cliente para llamar al backend Hono (rutas privadas: OLT, MikroTik, TR-069...).
 * Usa rutas relativas: en dev, el proxy de Vite las redirige a localhost:3001;
 * en produccion, Hono sirve el frontend y la API desde el mismo origen.
 */
export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };

  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: unknown }).error)
        : `Error ${res.status}`;
    throw new Error(message);
  }

  return body as T;
}
