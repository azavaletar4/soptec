import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';
import { getLastReconcileReport, reconcileMikrotikDevice } from '../services/mikrotikReconcileService';
import { DEFAULT_MIKROTIK_DEVICE_ROLE, isPppoeAdminRole, isValidMikrotikDeviceRole } from '../mikrotik/deviceRole';
import { getLiveSnapshot } from '../services/mikrotikBorderTrafficService';
import { getBalancerConnectionsSnapshot, getBalancerTrafficHistory } from '../services/mikrotikBalancerDiscoveryService';
import { BALANCER_HISTORY_RANGES, type BalancerHistoryRange } from '../mikrotik/balancerTrafficSeries';

export const mikrotikRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
// Dar de alta/editar/eliminar el registro del router es tarea de
// administracion, no del tecnico de campo (igual criterio que OLT).
const DEVICE_WRITE = ['SUPERADMIN', 'ADMIN'] as const;
// Gestionar usuarios PPPoE (habilitar/deshabilitar) si es trabajo de campo.
const PPP_WRITE = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] as const;

const DEVICE_PUBLIC_FIELDS =
  'id, name, host, port, use_tls, username, zone_id, is_active, device_role, ' +
  'monitored_interface_name, uplink_interface_name, capacity_download_mbps, capacity_upload_mbps, ' +
  'latitude, longitude, created_at';

mikrotikRoutes.use('*', requireAuth);

interface MikrotikDeviceRow {
  id: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
  device_role: string;
  monitored_interface_name: string | null;
  capacity_download_mbps: number;
  capacity_upload_mbps: number;
}

async function getDeviceOrNull(id: string | undefined): Promise<MikrotikDeviceRow | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin.from('mikrotik_devices').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as MikrotikDeviceRow;
}

// Las operaciones PPPoE (secretos/perfiles/sesiones) solo aplican al router
// administrador — un borde (dedicado o balanceador) no corre PPP de clientes.
function requirePppoeAdmin(device: MikrotikDeviceRow): { error: string } | null {
  if (!isPppoeAdminRole(device.device_role)) {
    return { error: `"${device.host}" esta clasificado como router de borde — no administra PPPoE de clientes` };
  }
  return null;
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
  if ('device_role' in body && body.device_role && !isValidMikrotikDeviceRole(body.device_role)) {
    return c.json({ error: 'Tipo de router invalido' }, 400);
  }
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
      device_role: body.device_role || DEFAULT_MIKROTIK_DEVICE_ROLE,
    })
    .select(DEVICE_PUBLIC_FIELDS)
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

mikrotikRoutes.put('/:id', requireRole(...DEVICE_WRITE), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  if ('device_role' in body && body.device_role && !isValidMikrotikDeviceRole(body.device_role)) {
    return c.json({ error: 'Tipo de router invalido' }, 400);
  }
  // Fase 172: capacidad contratada — solo para estadisticas/alertas, nunca
  // toca queues/perfiles/rutas reales del router. Debe ser un numero > 0.
  for (const key of ['capacity_download_mbps', 'capacity_upload_mbps'] as const) {
    if (key in body && body[key] != null) {
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n <= 0) return c.json({ error: 'La capacidad debe ser un numero mayor a 0' }, 400);
    }
  }
  const update: Record<string, unknown> = {};
  for (const key of [
    'name', 'host', 'port', 'use_tls', 'username', 'zone_id', 'is_active', 'device_role',
    'monitored_interface_name', 'uplink_interface_name', 'capacity_download_mbps', 'capacity_upload_mbps',
    'latitude', 'longitude',
  ] as const) {
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

// ---- Reconciliacion MikroTik -> Panel (Fase 31/170, ver mikrotikReconcileService.ts) ----
// SIEMPRE acotada a UN router por `:id` (nunca "reconciliar todos" desde
// esta ruta) — y SIEMPRE validada en backend contra device_role, nunca solo
// confiando en que el frontend oculte el boton a un router de borde.

mikrotikRoutes.get('/:id/reconcile/report', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
  return c.json(getLastReconcileReport(device.id));
});

mikrotikRoutes.post('/:id/reconcile/run', requireRole(...PPP_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
  try {
    const report = await reconcileMikrotikDevice(device.id);
    return c.json(report);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al reconciliar' }, 500);
  }
});

mikrotikRoutes.get('/:id/ppp-secrets', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
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
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
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

// Crea un secreto PPPoE nuevo (alta de credencial de cliente) — hasta ahora
// esto solo se hacia a mano en Winbox; usado por AuthorizeOnuModal.vue para
// activar el servicio en un solo paso junto con la ONU en la OLT.
mikrotikRoutes.post('/:id/ppp-secrets', requireRole(...PPP_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
  const body = await c.req.json();
  const { name, password, profile, comment } = body;
  if (!name || !password || !profile) {
    return c.json({ error: 'name, password y profile son requeridos' }, 400);
  }
  try {
    const data = await mikrotikRequest(targetFor(device), '/ppp/secret', {
      method: 'POST',
      body: {
        name: String(name),
        password: String(password),
        profile: String(profile),
        service: 'pppoe',
        comment: comment ? String(comment) : undefined,
      },
    });
    return c.json(data, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al crear el secreto en el router' }, 502);
  }
});

mikrotikRoutes.get('/:id/ppp-profiles', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
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
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
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
  const roleError = requirePppoeAdmin(device);
  if (roleError) return c.json(roleError, 400);
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

// Interfaces + trafico acumulado (rx/tx-byte) — solo lectura, util para los
// 3 tipos de router (admin PPPoE y los 2 de borde). No asume el mecanismo de
// balanceo (PCC, ECMP, nth...): eso se identifica despues con otra consulta
// de solo lectura una vez confirmado contra un balanceador real (Fase 3).
mikrotikRoutes.get('/:id/interfaces', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  try {
    const data = await mikrotikRequest(targetFor(device), '/interface');
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el router' }, 502);
  }
});

// ---- Monitoreo de trafico del borde dedicado (Fase 172) ----
// Solo lectura: sirve la cache en memoria del scheduler (mikrotikBorderTrafficScheduler.ts)
// y consultas a Supabase — nunca llama al router directamente desde aqui
// (eso lo hace unicamente el scheduler, para no multiplicar consultas si
// varios admins tienen el panel abierto a la vez).

mikrotikRoutes.get('/:id/traffic-live', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  if (!device.monitored_interface_name) {
    return c.json({ status: 'not_configured', message: 'Todavia no se eligio que interfaz monitorear en este router' });
  }
  const snapshot = getLiveSnapshot(device.id);
  if (!snapshot) {
    return c.json({ status: 'warming_up', message: 'Esperando la primera lectura del router (hasta unos segundos)...' });
  }
  return c.json(snapshot);
});

const HISTORY_RANGES = {
  '15m': { sinceMinutes: 15, bucketSeconds: 60 },
  '1h': { sinceMinutes: 60, bucketSeconds: 60 },
  '24h': { sinceMinutes: 24 * 60, bucketSeconds: 300 },
  '7d': { sinceMinutes: 7 * 24 * 60, bucketSeconds: 1800 },
} as const;
type HistoryRange = keyof typeof HISTORY_RANGES;
function isHistoryRange(v: unknown): v is HistoryRange {
  return typeof v === 'string' && v in HISTORY_RANGES;
}

mikrotikRoutes.get('/:id/traffic-history', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  if (!device.monitored_interface_name) return c.json({ error: 'Todavia no se eligio que interfaz monitorear en este router' }, 400);

  const rangeParam = c.req.query('range');
  const range: HistoryRange = isHistoryRange(rangeParam) ? rangeParam : '1h';
  const { sinceMinutes, bucketSeconds } = HISTORY_RANGES[range];
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

  const { data, error } = await supabaseAdmin.rpc('fn_mikrotik_interface_series', {
    p_device_id: device.id,
    p_interface_name: device.monitored_interface_name,
    p_since: since,
    p_bucket_seconds: bucketSeconds,
  });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ range, points: data ?? [] });
});

mikrotikRoutes.get('/:id/saturation-alerts', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  if (!device.monitored_interface_name) return c.json([]);

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('mikrotik_saturation_alerts')
    .select('id, direction, status, started_at, resolved_at, peak_bps, threshold_bps')
    .eq('device_id', device.id)
    .eq('interface_name', device.monitored_interface_name)
    .gte('started_at', since)
    .order('started_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

// ---- Fase 174: descubrimiento de conexiones WAN del balanceador ----
// Solo lectura -- sirve lo que ya descubrio/guardo el scheduler
// (mikrotikBalancerDiscoveryScheduler.ts); esta ruta nunca llama al router
// directamente ni modifica su configuracion.
mikrotikRoutes.get('/:id/balancer/connections', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  if (device.device_role !== 'borde_balanceador') {
    return c.json({ error: `"${device.host}" no esta clasificado como router balanceador` }, 400);
  }
  try {
    const health = await getBalancerConnectionsSnapshot(device.id);
    return c.json(health);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar las conexiones del balanceador' }, 500);
  }
});

function isBalancerHistoryRange(v: unknown): v is BalancerHistoryRange {
  return typeof v === 'string' && v in BALANCER_HISTORY_RANGES;
}

// Historico de trafico del balanceador -- total, por puerto fisico o de
// una sola sesion PPPoE (nunca mezclado). Agregado en el backend sobre las
// muestras ya guardadas (una sola fuente por conexion, el nivel PPPoE) --
// no requiere ninguna tabla ni migracion nueva.
mikrotikRoutes.get('/:id/balancer/traffic-history', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'Router no encontrado' }, 404);
  if (device.device_role !== 'borde_balanceador') {
    return c.json({ error: `"${device.host}" no esta clasificado como router balanceador` }, 400);
  }
  const rangeParam = c.req.query('range');
  const range: BalancerHistoryRange = isBalancerHistoryRange(rangeParam) ? rangeParam : '1h';
  const port = c.req.query('port') || undefined;
  const connectionId = c.req.query('connectionId') || undefined;
  try {
    const result = await getBalancerTrafficHistory(device.id, range, { port, connectionId });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar el historico del balanceador' }, 500);
  }
});
