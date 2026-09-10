import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente con la service_role key: se salta RLS. Solo se usa en el backend,
// nunca se expone al frontend. Reutiliza VITE_SUPABASE_URL porque el prefijo
// VITE_ solo importa para lo que Vite empaqueta hacia el navegador.
//
// Se crea de forma perezosa (no al cargar el modulo): si falta la
// service_role key, el proceso entero no debe caerse — solo deben fallar,
// con un error claro, las rutas que efectivamente la necesitan (OLT,
// MikroTik, TR-069...). El resto del backend (ej. /api/health) sigue vivo.
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env del backend ' +
        '(ver docs/architecture/supabase-setup.md)',
    );
  }

  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}

// Proxy: cualquier propiedad accedida (from, auth, storage...) crea el
// cliente real en ese momento, no antes. Así el error solo ocurre cuando
// una ruta realmente intenta usar Supabase con permisos de servicio.
//
// Importante: los metodos se re-bindean al cliente real (no al proxy) para
// que su `this` interno siga apuntando a la instancia real de supabase-js.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getClient();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
