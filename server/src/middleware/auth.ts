import type { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
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

/**
 * Verifica el JWT de Supabase (HS256, firmado con JWT_SECRET) que llega en
 * el header Authorization: Bearer <token>, y adjunta el usuario + su rol
 * (leido de public.profiles con la service_role key, sin pasar por RLS).
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: 'No autenticado' }, 401);

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.error('[auth] Falta JWT_SECRET en el .env del backend');
    return c.json({ error: 'Backend mal configurado (falta JWT_SECRET)' }, 500);
  }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret) as jwt.JwtPayload;
  } catch {
    return c.json({ error: 'Token invalido o expirado' }, 401);
  }

  const userId = payload.sub;
  if (!userId) return c.json({ error: 'Token invalido' }, 401);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  c.set('user', {
    id: userId,
    email: typeof payload.email === 'string' ? payload.email : undefined,
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
