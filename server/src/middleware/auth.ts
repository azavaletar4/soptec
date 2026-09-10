import type { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import type { Role } from '../types';

export interface AuthUser {
  id: string;
  email?: string;
  role: Role;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

// Este proyecto Supabase firma los JWT de Auth con una clave asimetrica
// (ES256), publicada en /auth/v1/.well-known/jwks.json — no con un secreto
// compartido (JWT_SECRET). `createRemoteJWKSet` descarga y cachea esas
// llaves publicas automaticamente (y las refresca si rotan).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (jwks) return jwks;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('Falta VITE_SUPABASE_URL en el .env del backend');
  }

  jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

/**
 * Verifica el JWT de Supabase (header Authorization: Bearer <token>) contra
 * las llaves publicas del proyecto, y adjunta el usuario + su rol (leido de
 * public.profiles con la service_role key, sin pasar por RLS).
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: 'No autenticado' }, 401);

  let userId: string | undefined;
  let email: string | undefined;
  try {
    const { payload } = await jwtVerify(token, getJwks());
    userId = typeof payload.sub === 'string' ? payload.sub : undefined;
    email = typeof payload.email === 'string' ? payload.email : undefined;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Token invalido';
    return c.json({ error: `Token invalido o expirado: ${message}` }, 401);
  }

  if (!userId) return c.json({ error: 'Token invalido' }, 401);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  c.set('user', {
    id: userId,
    email,
    role: (profile?.role as Role | undefined) ?? 'CLIENTE',
  });

  await next();
}

/** Usar despues de requireAuth. Sin roles listados, deja pasar a cualquier autenticado. */
export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user || (roles.length > 0 && !roles.includes(user.role))) {
      return c.json({ error: 'No tienes permisos para esta accion' }, 403);
    }
    await next();
  };
}
