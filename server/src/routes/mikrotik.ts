import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';
import { getLastReconcileReport, reconcileMikrotik } from '../services/mikrotikReconcileService';

export const mikrotikRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
// Dar de alta/editar/eliminar el registro del router es tarea de
// administracion, no del tecnico de campo (igual criterio que OLT).
const DEVICE_WRITE = ['SUPERADMIN', 'ADMIN'] as const;
// Gestionar usuarios PPPoE (habilitar/deshabilitar) si es trabajo de campo.
const PPP_WRITE = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] as const;

const DEVICE_PUBLIC_FIELDS = 'id, name, host, port, use_tls, username, zone_id, is_active, latitude, longitude, created_at';

mikrotikRoutes.use('*', requireAuth);

interface MikrotikDeviceRow {
  id: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
}

async function getDeviceOrNull(id: string | undefined): Promise<MikrotikDeviceRow | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin.from('mikrotik_devices').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as MikrotikDeviceRow;
}

function targetFor(device: MikrotikDeviceRow): MikrotikTarget {
  return {
    host: device.host,
    port: device.port,
    useTls: device.use_tls,
    username: device.username,
    password: device.password,
  };
}

// ---- Reconciliacion MikroTik -> Panel (Fase 31, ver mikrotikReconcileService.ts) ----
// Registradas antes de "/:id/..." para que "reconcile" nunca se confunda con un id de router.

mikrotikRoutes.get('/reconcile/report', requireRole(...STAFF_READ), async (c) => {
  return c.json(getLastReconcileReport());
});

mikrotikRoutes.post('/reconcile/run', requireRole(...PPP_WRITE), async (c) => {
  try {
    const report = await reconcileMikrotik();
    return c.json(report);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al reconciliar' }, 500);
  }
});

// ---- CRUD mikrotik_devices ----

mikrotikRoutes.get('/', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('mikrotik_devices')
    .select(DEVICE_PUBLIC_FIELDS)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

mikrotikRoutes.post('/', requireRole(...DEVICE_WRITE), async (c) => {
  const body = await c.req.json();
  const { data, error } = await supabaseAdmin
    .from('mikrotik_devices')
    .insert({
      name: body.name,
      host: body.host,
      port: body.port ?? 443,
      use_tls: body.use_tls ?? true,
      username: body.username,
      password: body.password,
      zone_id: body.zone_id ?? null,
    })
    .select(DEVICE_PUBLIC_FIELDS)
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

mikrotikRoutes.put('/:id', requireRole(...DEVICE_WRITE), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  for (const key of ['name', 'host', 'port', 'use_tls', 'username', 'zone_id', 'is_active', 'latitude', 'longitude'] as const) {
    if (key in body) update[key] = body[key];
  }
  if (body.password) update.password = body.password;

  const { data, error } = await supabaseAdmin
    .from('mikrotik_devices')
    .update(update)
    .eq('id', id)
    .select(DEVICE_PUBLIC_FIELDS)
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

mikrotikRoutes.delete('/:id', requireRole(...DEVICE_WRITE), async (c) => {
  const { error } = await supabaseAdmin.from('mikrotik_devices').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

mikrotikRoutes.post('/:id/test', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);

  const start = Date.now();
  try {
    const resource = await mikrotikRequest(targetFor(device), '/system/resource');
    await supabaseAdmin
      .from('mikrotik_devices')
      .update({ last_test_ok: true, last_tested_at: new Date().toISOString() })
      .eq('id', device.id);
    return c.json({ status: 'ok', ms: Date.now() - start, resource });
  } catch (e) {
    await supabaseAdmin
      .from('mikrotik_devices')
      .update({ last_test_ok: false, last_tested_at: new Date().toISOString() })
      .eq('id', device.id);
    return c.json({ status: 'error', message: e instanceof Error ? e.message : 'Error de conexion' }, 502);
  }
});

// ---- Datos en vivo del router ----

mikrotikRoutes.get('/:id/resource', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    const data = await mikrotikRequest(targetFor(device), '/system/resource');
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el router' }, 502);
  }
});

mikrotikRoutes.get('/:id/ppp-secrets', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    const data = await mikrotikRequest(targetFor(device), '/ppp/secret');
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el router' }, 502);
  }
});

mikrotikRoutes.put('/:id/ppp-secrets/:secretId', requireRole(...PPP_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  const body = await c.req.json();
  // El ancho de banda se controla en la OLT; aqui solo se habilita/deshabilita
  // el secreto PPPoE y/o se le asigna el profile (usado para el plan contratado).
  const patch: Record<string, string> = {};
  if ('disabled' in body) patch.disabled = body.disabled ? 'true' : 'false';
  if ('profile' in body && body.profile) patch.profile = String(body.profile);
  if ('password' in body && body.password) patch.password = String(body.password);
  try {
    const data = await mikrotikRequest(
      targetFor(device),
      `/ppp/secret/${c.req.param('secretId')}`,
      { method: 'PATCH', body: patch },
    );
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al actualizar en el router' }, 502);
  }
});

mikrotikRoutes.get('/:id/ppp-profiles', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    const data = await mikrotikRequest(targetFor(device), '/ppp/profile');
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el router' }, 502);
  }
});

mikrotikRoutes.get('/:id/ppp-active', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    const data = await mikrotikRequest(targetFor(device), '/ppp/active');
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el router' }, 502);
  }
});

// RouterOS no re-negocia una sesion PPPoE ya conectada cuando cambia el
// profile del secreto: hay que forzar la desconexion (igual que "Remove" en
// Winbox > PPP > Active Connections) para que el cliente reconecte con el
// profile nuevo.
mikrotikRoutes.delete('/:id/ppp-active/:activeId', requireRole(...PPP_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    await mikrotikRequest(targetFor(device), `/ppp/active/${c.req.param('activeId')}`, { method: 'DELETE' });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al desconectar en el router' }, 502);
  }
});

mikrotikRoutes.get('/:id/dhcp-leases', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    const data = await mikrotikRequest(targetFor(device), '/ip/dhcp-server/lease');
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el router' }, 502);
  }
});

mikrotikRoutes.get('/:id/ip-addresses', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    const data = await mikrotikRequest(targetFor(device), '/ip/address');
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el router' }, 502);
  }
});
