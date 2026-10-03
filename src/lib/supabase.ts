import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn('[SmartRayco] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env');
}

// persistSession/autoRefreshToken ya son el default de supabase-js, pero se
// dejan explicitos: es lo que mantiene la sesion activa entre recargas y
// reinicios del navegador (localStorage) y renueva el access token solo,
// sin pedirle al usuario que vuelva a loguearse.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
