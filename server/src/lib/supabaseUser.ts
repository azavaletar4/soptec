import { createClient } from '@supabase/supabase-js';
/** Conserva el JWT validado por requireAuth: PostgreSQL obtiene el actor real. */
export function supabaseUser(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) throw new Error('Sesión requerida');
  const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Configuración de acceso financiero incompleta');
  return createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
}
