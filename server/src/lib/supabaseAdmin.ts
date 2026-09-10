import { createClient } from '@supabase/supabase-js';

// Cliente con la service_role key: se salta RLS. Solo se usa en el backend,
// nunca se expone al frontend. Reutiliza VITE_SUPABASE_URL porque el prefijo
// VITE_ solo importa para lo que Vite empaqueta hacia el navegador.
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[SmartRayco API] Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del backend',
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
