import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { readAllClientPages } from '../../../src/lib/clientLifecycle';
import { readTr069Inventory, synchronizeTr069Inventory, type Tr069InventoryRepository } from '../services/tr069Inventory';

export const tr069SyncRoutes = new Hono();
const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
tr069SyncRoutes.use('*', requireAuth, requireRole(...STAFF_READ));
const nbi = () => process.env.GENIEACS_NBI || 'http://localhost:7557';

const repository: Tr069InventoryRepository = {
  list: () => readAllClientPages<{ id: string; genieacs_id: string }>((from, to) => supabaseAdmin
    .from('tr069_devices').select('id, genieacs_id', { count: 'exact' }).order('id').range(from, to)),
  update: async (id, cache) => {
    const { error } = await supabaseAdmin.from('tr069_devices').update(cache).eq('id', id);
    if (error) throw error;
  },
  insert: async device => {
    const { error } = await supabaseAdmin.from('tr069_devices').insert(device);
    if (error) throw error;
  },
};

export type Tr069SyncResult = Awaited<ReturnType<typeof synchronizeTr069Inventory>> | { ok: false; error: string };
let runningSync: Promise<Tr069SyncResult> | null = null;

/** Solo sincroniza una enumeracion completa. Nunca borra ni desvincula ausentes. */
export function syncTr069Devices(): Promise<Tr069SyncResult> {
  if (runningSync) return runningSync;
  runningSync = (async (): Promise<Tr069SyncResult> => {
    try { return await synchronizeTr069Inventory(await readTr069Inventory(nbi()), repository); }
    catch { return { ok: false, error: 'No se pudo verificar y sincronizar el inventario completo de GenieACS. Los registros guardados se conservan.' }; }
  })().finally(() => { runningSync = null; });
  return runningSync;
}

// Consulta de presencia: no escribe en Supabase ni solicita tareas al CPE.
tr069SyncRoutes.get('/inventory', async c => {
  c.header('Cache-Control', 'no-store');
  try { return c.json(await readTr069Inventory(nbi())); }
  catch { return c.json({ error: 'No se pudo comprobar el inventario actual de GenieACS. Conserva la ultima comprobacion; no se confirma ninguna retirada.' }, 502); }
});

tr069SyncRoutes.post('/', async c => {
  const result = await syncTr069Devices();
  return c.json(result, result.ok ? 200 : 502);
});
