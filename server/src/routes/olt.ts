import { collectOltTelemetry, evaluateOntEvidence, rememberOntEvidence, ontTelemetry, presentOntData } from '../services/oltTelemetry';
import { persistOntMeasurement } from '../services/oltTelemetryPersistence';
import { readVerifiedOntSignal } from '../services/oltVerifiedRead';
import { guardOltReadOperation, createOltReadBudget } from '../services/oltReadOperation';
import { validateProvisioningContract } from '../services/provisioningContract';
import { createOltProvisioningRoutes } from './oltProvisioning';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { runTelnetCommands } from '../telnet/client';
import { type OltDeviceRow, telnetTargetFor } from '../lib/oltDevice';
import { withOltLock } from '../services/oltTelnetLock';
import {
  runOltFullSync,
  isOltSyncRunning,
  LOW_SIGNAL_THRESHOLD_DBM,
  type CachedUnconfiguredOnt,
} from '../services/oltSyncService';
import { oltEvents, type OntChangedEvent, type SummaryChangedEvent, type OltAlertEvent } from '../services/oltEvents';
import { presentAlertHistoryOnt, type AlertHistoryOnt } from '../services/oltAlertHistoryOnt';
import { computeRecoveryDurations } from '../services/oltAlertLog';
import { resolveDisabledReason } from '../services/oltDisabledReason';
import {
  testConnectionCommands,
  listUnconfiguredOntsCommands,
  configureWanPppoeCommands,
  changeOntProfileCommands,
  setAdminStateCommands,
  deleteOntCommands,
  runningConfigCommands,
  listTcontProfilesCommands,
  listTrafficProfilesCommands,
  setTr069AcsCommands,
  disableTr069Commands,
  fullRunningConfigCommand,
  type ZteInterfaceRef,
} from '../ssh/zteCommands';
import {
  parseUnconfiguredOnts,
  parseProfileNames,
  parseFullRunningConfig,
} from '../ssh/zteParsers';
import { TR069_ENABLE_ROLES, validateTr069EnableRequest, verifyLivePosition } from '../services/tr069Enable';
import { createSingleFlightGuard } from '../services/singleFlightGuard';
import { createSupabaseProvisioningStore } from '../services/oltProvisioningStore';
import { classifyImportCandidates, type LinkedPosition } from '../services/oltImportDescriptionGuard';
import {
  type ProvisionHandlerDeps,
  type ProvisionRequestBody,
} from '../services/oltProvisioningHandler';
import { mikrotikRequest, type MikrotikTarget } from '../mikrotik/client';

export const oltRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
// Gestionar el registro de la OLT (alta/edicion/baja del equipo) es tarea de
// administracion, no del tecnico de campo.
const DEVICE_WRITE = ['SUPERADMIN', 'ADMIN'] as const;
// Gestionar ONTs (activar/desactivar, eliminar, autorizar, TR-069) si es
// trabajo del tecnico de campo con el equipo ya dado de alta.
const ONT_WRITE = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] as const;
// Habilitacion GUIADA de TR-069 (boton individual, 2026-10-27): el propietario
// pidio esta accion puntual SOLO para ADMIN/SUPERADMIN, mas angosta que
// ONT_WRITE (que si incluye TECNICO_RED para el modal manual existente).
// TR069_ENABLE_ROLES vive en services/tr069Enable.ts para que la regla de
// permisos sea una sola fuente de verdad, compartida con validateTr069EnableRequest.

// Guardia en memoria contra 2 solicitudes de habilitacion simultaneas sobre
// la MISMA ONT (requisito 9) — ver services/singleFlightGuard.ts.
const tr069EnableGuard = createSingleFlightGuard();
// New authorization and reconciliation roles live in oltProvisioning.ts.

const DEVICE_PUBLIC_FIELDS = 'id, name, host, brand, telnet_port, username, zone_id, is_active, created_at';
// extra_params solo se pide en el listado para sacar lat/lng (capa OLT del
// mapa, Fase 7) — nunca se expone completo al frontend, solo esos dos campos.
const DEVICE_LIST_FIELDS = `${DEVICE_PUBLIC_FIELDS}, extra_params`;

function withCoords<T extends { extra_params?: Record<string, unknown> | null }>(row: T) {
  const { extra_params, ...rest } = row;
  const lat = typeof extra_params?.lat === 'number' ? extra_params.lat : null;
  const lng = typeof extra_params?.lng === 'number' ? extra_params.lng : null;
  return { ...rest, lat, lng };
}

oltRoutes.use('*', requireAuth);

async function getDeviceOrNull(id: string | undefined): Promise<OltDeviceRow | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin.from('olt_devices').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as OltDeviceRow;
}

// ---- CRUD olt_devices ----

oltRoutes.get('/', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_devices')
    .select(DEVICE_LIST_FIELDS)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json((data ?? []).map(withCoords));
});

/** Guarda la posicion del marcador OLT en el mapa (capa OLT, Fase 7). */
oltRoutes.put('/:id/coords', requireRole(...STAFF_READ), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { lat, lng } = body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return c.json({ error: 'lat y lng son requeridos (numeros)' }, 400);
  }

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('olt_devices')
    .select('extra_params')
    .eq('id', id)
    .single();
  if (fetchError || !current) return c.json({ error: 'OLT no encontrada' }, 404);

  const { data, error } = await supabaseAdmin
    .from('olt_devices')
    .update({ extra_params: { ...(current.extra_params ?? {}), lat, lng } })
    .eq('id', id)
    .select(DEVICE_LIST_FIELDS)
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(withCoords(data));
});

oltRoutes.post('/', requireRole(...DEVICE_WRITE), async (c) => {
  const body = await c.req.json();
  const { data, error } = await supabaseAdmin
    .from('olt_devices')
    .insert({
      name: body.name,
      host: body.host,
      brand: body.brand ?? 'zte',
      telnet_port: body.telnet_port ?? 23,
      username: body.username,
      password: body.password,
      zone_id: body.zone_id ?? null,
    })
    .select(DEVICE_PUBLIC_FIELDS)
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

oltRoutes.put('/:id', requireRole(...DEVICE_WRITE), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  for (const key of ['name', 'host', 'brand', 'telnet_port', 'username', 'zone_id', 'is_active'] as const) {
    if (key in body) update[key] = body[key];
  }
  if (body.password) update.password = body.password; // solo si mandan una nueva

  const { data, error } = await supabaseAdmin
    .from('olt_devices')
    .update(update)
    .eq('id', id)
    .select(DEVICE_PUBLIC_FIELDS)
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

oltRoutes.delete('/:id', requireRole(...DEVICE_WRITE), async (c) => {
  const { error } = await supabaseAdmin.from('olt_devices').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

oltRoutes.post('/:id/test', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  // eslint-disable-next-line no-console
  console.log(`[olt/test] Conectando a ${device.host}:${device.telnet_port} (usuario: ${device.username})...`);
  const start = Date.now();
  try {
    const outputs = await withOltLock(device.id, () => runTelnetCommands(telnetTargetFor(device), testConnectionCommands()));
    // eslint-disable-next-line no-console
    console.log(`[olt/test] OK en ${Date.now() - start}ms. Output:\n${outputs.join('\n')}`);
    await supabaseAdmin
      .from('olt_devices')
      .update({ last_test_ok: true, last_tested_at: new Date().toISOString() })
      .eq('id', device.id);
    return c.json({ status: 'ok', ms: Date.now() - start, output: outputs.join('\n') });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error de conexion';
    // eslint-disable-next-line no-console
    console.error(`[olt/test] FALLO tras ${Date.now() - start}ms:`, e);
    await supabaseAdmin
      .from('olt_devices')
      .update({ last_test_ok: false, last_tested_at: new Date().toISOString() })
      .eq('id', device.id);
    return c.json({ status: 'error', message }, 502);
  }
});

/**
 * Resumen estilo SmartOLT de una OLT — YA NO escanea la OLT en vivo (ver
 * Fase 40): lee `olt_sync_cache`, llenada en segundo plano por
 * oltSyncScheduler.ts (cada OLT_SYNC_INTERVAL_MINUTES) y por "Actualizar
 * ahora" (POST /:id/sync/full). Respuesta instantanea.
 */
oltRoutes.get('/:id/summary', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const { data: cache } = await supabaseAdmin
    .from('olt_sync_cache')
    .select('unconfigured, online, offline, disabled, low_signal, scan_complete, checked_at')
    .eq('olt_device_id', device.id)
    .maybeSingle();

  if (cache) {
    return c.json({
      unconfigured: cache.unconfigured,
      online: cache.online,
      offline: cache.offline,
      disabled: cache.disabled,
      lowSignal: cache.low_signal,
      scanComplete: cache.scan_complete,
      checkedAt: cache.checked_at,
    });
  }

  // Todavia no corrio ningun sync para esta OLT (recien dada de alta) —
  // mientras tanto, contar lo que ya haya en olt_onts en vez de puros ceros.
  const { data: onts } = await supabaseAdmin
    .from('olt_onts')
    .select('id, olt_device_id, serial, frame, slot, port, ont_id, status, admin_state, rx_power, tx_power, last_synced_at').is('retired_at', null)
    .eq('olt_device_id', device.id);
  const rows = (onts ?? []).map(row => ontTelemetry.project(row));
  return c.json({
    unconfigured: 0,
    online: rows.filter((r) => r.status === 'online').length,
    offline: rows.filter((r) => r.status === 'offline').length,
    disabled: rows.filter((r) => r.admin_state === 'disable').length,
    lowSignal: rows.filter((r) => typeof r.rx_power === 'number' && r.rx_power < LOW_SIGNAL_THRESHOLD_DBM).length,
    scanComplete: false,
    checkedAt: null,
  });
});

/**
 * Salud del chasis (uptime, temperatura y CPU/RAM por tarjeta) — YA NO en
 * vivo (ver Fase 40): lee `olt_sync_cache`.
 */
oltRoutes.get('/:id/health', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const { data: cache } = await supabaseAdmin
    .from('olt_sync_cache')
    .select('uptime_hours, uptime_raw, temperature, load, checked_at')
    .eq('olt_device_id', device.id)
    .maybeSingle();

  return c.json({
    uptime: cache?.uptime_raw ? { raw: cache.uptime_raw, totalHours: cache.uptime_hours ?? 0 } : null,
    temperature: cache?.temperature ?? [],
    load: cache?.load ?? [],
    checkedAt: cache?.checked_at ?? null,
  });
});

/**
 * Refresco manual ("Actualizar ahora" en el panel): encola un sync completo
 * en segundo plano y responde de inmediato (202), sin bloquear al que hizo
 * clic. El resultado llega despues via SSE (GET /:id/events,
 * "summaryChanged"/"ontChanged") o consultando GET /:id/sync/status.
 */
oltRoutes.post('/:id/sync/full', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  if (isOltSyncRunning(device.id)) {
    return c.json({ status: 'already_running' }, 202);
  }

  // Fire-and-forget: no se espera a que termine (puede tardar varios
  // minutos con cientos de ONTs, ver oltSyncService.ts).
  void runOltFullSync(device).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[olt/sync] ${device.name}: fallo el sync manual:`, e);
  });

  return c.json({ status: 'queued' }, 202);
});

/** Barato: para el fallback de polling si el SSE se desconecta. */
oltRoutes.get('/:id/sync/status', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const { data: cache } = await supabaseAdmin
    .from('olt_sync_cache')
    .select('checked_at')
    .eq('olt_device_id', device.id)
    .maybeSingle();

  return c.json({ running: isOltSyncRunning(device.id), lastFullSyncAt: cache?.checked_at ?? null });
});

/**
 * Tiempo real: cambios de estado/senal de las ONUs de esta OLT via Server-
 * Sent Events. NO se usa Supabase Realtime directo porque olt_onts es de
 * acceso EXCLUSIVO del backend (RLS sin policies a proposito, ver Fase 4) —
 * este endpoint mantiene ese limite intacto. Los eventos los emite
 * oltSyncService.runOltFullSync() (sync en background) y cada endpoint de
 * abajo que escribe en olt_onts (activar/desactivar, eliminar, plan,
 * senal, TR-069).
 */
oltRoutes.get('/:id/events', requireRole(...STAFF_READ), async (c) => {
  const deviceId = c.req.param('id');

  return streamSSE(c, async (stream) => {
    const onOntChanged = (payload: OntChangedEvent) => {
      if (payload.oltDeviceId !== deviceId) return;
      void stream.writeSSE({ event: 'ontChanged', data: JSON.stringify(presentOntData(payload.ont)) });
    };
    const onSummaryChanged = (payload: SummaryChangedEvent) => {
      if (payload.oltDeviceId !== deviceId) return;
      void stream.writeSSE({ event: 'summaryChanged', data: JSON.stringify(payload) });
    };
    // Fase 3 comercial OLT: alerta proactiva (ver oltAlerts.ts/oltEvents.ts)
    // — mismo stream, ya protegido por STAFF_READ arriba; ningun rol fuera
    // de esa lista puede abrir esta conexion ni recibir esto.
    const onOltAlert = (payload: OltAlertEvent) => {
      if (payload.oltDeviceId !== deviceId) return;
      void stream.writeSSE({ event: 'oltAlert', data: JSON.stringify(payload) });
    };

    oltEvents.on('ontChanged', onOntChanged);
    oltEvents.on('summaryChanged', onSummaryChanged);
    oltEvents.on('oltAlert', onOltAlert);

    try {
      // Mantiene la conexion viva (algunos proxies la cierran por
      // inactividad); termina solo cuando el cliente se desconecta.
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: 'ping' });
        await stream.sleep(25000);
      }
    } finally {
      oltEvents.off('ontChanged', onOntChanged);
      oltEvents.off('summaryChanged', onSummaryChanged);
      oltEvents.off('oltAlert', onOltAlert);
    }
  });
});

/**
 * Fase 4 OLT — historial de desconexiones/reconexiones (ver
 * ESTADO_DESARROLLO.md 13au). Solo lectura de `olt_alert_log` (Fase 160,
 * ver 13at) — mismos 3 roles reales que ya exige la RLS de esa tabla
 * (ONT_WRITE = SUPERADMIN/ADMIN/TECNICO_RED, regla 9 de la migracion
 * OLT), reutilizado aqui aunque el nombre diga "WRITE": es exactamente
 * el mismo tercio de roles, no se duplica la lista.
 *
 * Filtros: from/to (rango de `at`, ISO), clientId, zoneId (resuelto via
 * service_contracts.zone_id — olt_alert_log no guarda zona propia, ver
 * 13at), kind. Paginado simple por limit/offset (maximo 200 por pagina).
 *
 * client_id/contract_id que devuelve cada fila son el SNAPSHOT guardado
 * al momento del evento (no el vinculo actual de la ONT) — por diseño,
 * un historial no se reescribe si la ONT se traslada despues.
 */
oltRoutes.get('/:id/alert-log', requireRole(...ONT_WRITE), async (c) => {
  const deviceId = c.req.param('id');
  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const clientId = url.searchParams.get('clientId');
  const zoneId = url.searchParams.get('zoneId');
  const kind = url.searchParams.get('kind');
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 50, 200));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  // La zona no se guarda en olt_alert_log (ver 13at) — se resuelve a los
  // contract_id de esa zona ANTES de filtrar el historial, mismo criterio
  // de lectura que ya usa Fase B.
  let contractIdsForZone: string[] | null = null;
  if (zoneId) {
    const { data: contractsInZone, error: zoneErr } = await supabaseAdmin
      .from('service_contracts')
      .select('id')
      .eq('zone_id', zoneId);
    if (zoneErr) return c.json({ error: zoneErr.message }, 500);
    contractIdsForZone = (contractsInZone ?? []).map((r) => r.id as string);
    if (contractIdsForZone.length === 0) return c.json({ items: [], total: 0 });
  }

  // OJO: el select va en UN solo literal de string (no concatenado con +) —
  // supabase-js necesita el literal completo para tipar el embed; partido
  // en pedazos degrada a GenericStringError (sin relacion con el esquema
  // real, confirmado al compilar).
  let query = supabaseAdmin
    .from('olt_alert_log')
    .select(
      'id, olt_ont_id, kind, at, detail, client_id, contract_id, clients(id, first_name, last_name), service_contracts(id, contract_number, client_code, zones(id, name)), olt_onts(id, olt_device_id, serial, description, frame, slot, port, ont_id, status, retired_at)',
      { count: 'exact' },
    )
    .eq('olt_device_id', deviceId)
    .order('at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (from) query = query.gte('at', from);
  if (to) query = query.lte('at', to);
  if (clientId) query = query.eq('client_id', clientId);
  if (kind) query = query.eq('kind', kind);
  if (contractIdsForZone) query = query.in('contract_id', contractIdsForZone);

  const { data, error, count } = await query;
  if (error) return c.json({ error: error.message }, 500);
  // Sin un generic `Database` en supabaseAdmin (todo este archivo es asi,
  // confirmado), supabase-js no puede saber que estos embeds son de
  // cardinalidad 1 (cada fila tiene a lo sumo 1 cliente/contrato/ONT) y los
  // tipa como arreglo — se castea a la forma real una sola vez aqui.
  interface AlertLogRow {
    id: string;
    olt_ont_id: string | null;
    kind: string;
    at: string;
    detail: string | null;
    clients: { id: string; first_name: string; last_name: string } | null;
    service_contracts: {
      id: string;
      contract_number: string | null;
      client_code: string | null;
      zones: { id: string; name: string } | null;
    } | null;
    olt_onts: AlertHistoryOnt | null;
  }
  const rows = (data ?? []) as unknown as AlertLogRow[];

  // Duracion (13at: se calcula en lectura, nunca se guarda como columna):
  // una sola consulta extra, acotada a las ONTs que aparecen en ESTA
  // pagina — nunca una consulta masiva de toda la tabla.
  const ontIds = [...new Set(rows.map((r) => r.olt_ont_id).filter((id): id is string => !!id))];
  let durationByRecoveredId = new Map<string, number>();
  if (ontIds.length) {
    const { data: timeline } = await supabaseAdmin
      .from('olt_alert_log')
      .select('id, olt_ont_id, kind, at')
      .eq('olt_device_id', deviceId)
      .in('olt_ont_id', ontIds)
      .in('kind', ['offline', 'recovered'])
      .order('at', { ascending: true });
    durationByRecoveredId = computeRecoveryDurations(
      (timeline ?? []).map((t) => ({ id: t.id as string, oltOntId: t.olt_ont_id as string, kind: t.kind as 'offline' | 'recovered', at: t.at as string })),
    );
  }

  const items = rows.map((row) => ({
    id: row.id,
    oltOntId: row.olt_ont_id,
    kind: row.kind,
    at: row.at,
    detail: row.detail,
    durationMinutes: durationByRecoveredId.get(row.id as string) ?? null,
    client: row.clients ? { id: row.clients.id, name: `${row.clients.first_name} ${row.clients.last_name}`.trim() } : null,
    contract: row.service_contracts
      ? { id: row.service_contracts.id, contractNumber: row.service_contracts.contract_number, clientCode: row.service_contracts.client_code }
      : null,
    zoneName: row.service_contracts?.zones?.name ?? null,
    ont: presentAlertHistoryOnt(row.olt_onts),
  }));

  return c.json({ items, total: count ?? items.length });
});

/** Perfiles de ancho de banda (tcont/traffic) ya configurados en la OLT. */
oltRoutes.get('/:id/profiles', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  try {
    // Secuencial dentro del mismo turno de lock (no en paralelo — ver
    // leccion aprendida en /onts/import-existing mas abajo: multiples
    // conexiones Telnet simultaneas a la misma OLT causaron timeouts reales).
    const [tcontOut, trafficOut] = await withOltLock(device.id, async () => {
      const tcont = await runTelnetCommands(telnetTargetFor(device), listTcontProfilesCommands(), { timeoutMs: 15000 });
      const traffic = await runTelnetCommands(telnetTargetFor(device), listTrafficProfilesCommands(), { timeoutMs: 15000 });
      return [tcont, traffic] as const;
    });
    return c.json({
      tcontProfiles: parseProfileNames(tcontOut[1] ?? ''),
      trafficProfiles: parseProfileNames(trafficOut[1] ?? ''),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar los perfiles de la OLT' }, 502);
  }
});

/**
 * ONUs detectadas por la OLT pero SIN autorizar/registrar todavia — estilo
 * "unconfigured ONUs" de SmartOLT. Por defecto lee la CACHE
 * (olt_sync_cache.unconfigured_onts, llenada por el sync en background) —
 * instantaneo. `?live=1` fuerza un escaneo Telnet en vivo ("show gpon onu
 * uncfg"), para el momento justo antes de registrar una ONT nueva, donde SI
 * importa el dato mas fresco posible.
 *
 * OJO: el sufijo ":N" en el interfaceRef que devuelve la OLT (ej.
 * "gpon-onu_1/2/2:1") NO es un onu-id libre confiable — fue la causa real
 * de un incidente (2026-09-11, ver memoria del proyecto) donde se asumio
 * que ese numero era un ID disponible y en realidad ya pertenecia a una
 * clienta real. El frontend NO debe usar ese sufijo como onuId al
 * registrar; debe dejarlo en blanco para que POST /onts lo calcule con un
 * escaneo en vivo (mismo mecanismo ya usado ahi).
 */
/**
 * Cruza cada serial "sin configurar" contra olt_onts de ESTA OLT — si ya
 * existe (ej. un cliente real al que le borraron/perdieron la ONU de la OLT,
 * o que SmartOLT desconfiguro por corte de deuda en el equipo anterior), se
 * le agrega el cliente/contrato encontrado. El frontend usa esto para
 * separar "Nuevas por Autorizar" (existing=null) de "Desconfiguradas / Por
 * Reconectar" (existing!=null) — evita ademas el bug real de mostrar
 * "+Autorizar" para un serial que YA esta en "ONTs registradas" pero que la
 * cache de "sin configurar" (llenada por el sync cada 20 min) todavia no
 * reflejo.
 */
async function enrichUnconfigured<T extends { serial: string }>(deviceId: string, items: T[]) {
  const serials = [...new Set(items.map((i) => i.serial).filter(Boolean))];
  if (!serials.length) return items.map((i) => ({ ...i, existingClient: null, existingContract: null }));

  const { data: existingOnts } = await supabaseAdmin
    .from('olt_onts')
    .select('serial, client_id, contract_id, clients(id, first_name, last_name, document_number)').is('retired_at', null)
    .eq('olt_device_id', deviceId)
    .in('serial', serials);
  const ontBySerial = new Map((existingOnts ?? []).map((o) => [o.serial, o]));

  const contractIds = [...new Set((existingOnts ?? []).map((o) => o.contract_id).filter((v): v is string => !!v))];
  const clientIdsWithoutContract = [
    ...new Set((existingOnts ?? []).filter((o) => !o.contract_id && o.client_id).map((o) => o.client_id as string)),
  ];

  const CONTRACT_FIELDS = 'id, client_id, contract_number, pppoe_username, installation_address, debt_hold_status, status';
  const contractById = new Map<string, Record<string, unknown>>();
  if (contractIds.length) {
    const { data } = await supabaseAdmin.from('service_contracts').select(CONTRACT_FIELDS).in('id', contractIds);
    for (const ct of data ?? []) contractById.set(ct.id as string, ct);
  }
  const contractByClientId = new Map<string, Record<string, unknown>>();
  if (clientIdsWithoutContract.length) {
    const { data } = await supabaseAdmin
      .from('service_contracts')
      .select(CONTRACT_FIELDS)
      .in('client_id', clientIdsWithoutContract)
      .order('created_at', { ascending: false });
    for (const ct of data ?? []) if (!contractByClientId.has(ct.client_id as string)) contractByClientId.set(ct.client_id as string, ct);
  }

  return items.map((item) => {
    const ont = ontBySerial.get(item.serial);
    if (!ont) return { ...item, existingClient: null, existingContract: null };
    const contract = ont.contract_id
      ? (contractById.get(ont.contract_id) ?? null)
      : ont.client_id
        ? (contractByClientId.get(ont.client_id) ?? null)
        : null;
    return { ...item, existingClient: ont.clients ?? null, existingContract: contract };
  });
}

oltRoutes.get('/:id/onts/unconfigured', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const live = c.req.query('live') === '1';
  if (!live) {
    const { data: cache } = await supabaseAdmin
      .from('olt_sync_cache')
      .select('unconfigured_onts, checked_at')
      .eq('olt_device_id', device.id)
      .maybeSingle();
    const items = await enrichUnconfigured(device.id, (cache?.unconfigured_onts as CachedUnconfiguredOnt[] | null) ?? []);
    return c.json({ items, checkedAt: cache?.checked_at ?? null, live: false });
  }

  try {
    const outputs = await withOltLock(device.id, () =>
      runTelnetCommands(telnetTargetFor(device), listUnconfiguredOntsCommands(), { timeoutMs: 20000 }),
    );
    const list = parseUnconfiguredOnts(outputs.join('\n'));
    // "gpon-onu_1/2/2:1" -> { frame: 1, slot: 2, port: 2 } (se descarta el
    // sufijo, ver advertencia arriba).
    const withRef = list.map((o) => {
      const m = o.interfaceRef.match(/^gpon-onu_(\d+)\/(\d+)\/(\d+):/);
      return {
        serial: o.serial,
        interfaceRef: o.interfaceRef,
        frame: m ? Number(m[1]) : 1,
        slot: m ? Number(m[2]) : null,
        port: m ? Number(m[3]) : null,
      };
    });
    const items = await enrichUnconfigured(device.id, withRef);
    return c.json({ items, checkedAt: new Date().toISOString(), live: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar ONUs sin autorizar' }, 502);
  }
});

/**
 * ONTs deshabilitadas/cortadas — estilo "Disabled ONUs" de SmartOLT. Combina
 * DOS motivos que en este sistema son mecanismos separados y no se unifican
 * (decision tomada explicitamente): (a) admin-state=disable real en la OLT
 * (desactivacion manual de soporte, via activate/deactivate o el sync en
 * background), y (b) el CONTRATO/SERVICIO exacto vinculado esta en corte
 * por mora (service_contracts.debt_hold_status='suspended' — ver
 * debtHoldService.ts, que solo reduce el ancho de banda via
 * changeOntProfileCommands, NUNCA toca admin-state).
 *
 * Correccion 13ay (ver ESTADO_DESARROLLO.md y
 * server/src/services/oltDisabledReason.ts): el cruce de mora es por
 * `contract_id` EXACTO de cada ONT — nunca por `client_id`. Un cliente con
 * 2+ contratos, donde solo UNO esta en mora, ya NO contagia 'billing' a los
 * demas servicios de ese mismo cliente que estan al dia. Una ONT sin
 * `contract_id` (sin vincular o vinculo parcial) nunca puede calificar
 * como 'billing' — sin un contrato exacto y verificable, el motivo queda
 * administrativo generico (`resolveDisabledReason` lo decide de forma
 * pura, ver sus pruebas).
 *
 * 100% lectura de Supabase (cache ya poblada por el sync de fondo o por
 * activate/deactivate) — sin Telnet, sin withOltLock, instantaneo.
 */
oltRoutes.get('/:id/onts/disabled', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const { data: suspendedContracts } = await supabaseAdmin
    .from('service_contracts')
    .select('id')
    .eq('debt_hold_status', 'suspended');
  const suspendedContractIds = new Set((suspendedContracts ?? []).map((r) => r.id as string));

  const { data: onts } = await supabaseAdmin
    .from('olt_onts')
    .select('*, clients(id, first_name, last_name, phone, address), zones(id, name)').is('retired_at', null)
    .eq('olt_device_id', device.id);

  const items: Record<string, unknown>[] = [];
  for (const r of onts ?? []) {
    const reason = resolveDisabledReason({ admin_state: r.admin_state, contract_id: r.contract_id }, suspendedContractIds);
    if (reason) items.push({ ...ontTelemetry.project(r), reason });
  }

  return c.json({ items, checkedAt: new Date().toISOString() });
});

// ---- ONTs (cache local en olt_onts, sincronizada en background por Telnet) ----

oltRoutes.get('/:id/onts/retired', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin.from('olt_onts').select('*')
    .eq('olt_device_id', c.req.param('id')).not('retired_at', 'is', null)
    .order('retired_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(presentOntData(data ?? []));
});

oltRoutes.get('/:id/onts', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select(
      '*, clients(id, first_name, last_name, phone, address), zones(id, name), ' +
        'service_contracts(id, contract_number, client_code, status, zones(id, name))',
    ).is('retired_at', null)
    .eq('olt_device_id', c.req.param('id'))
    .order('slot')
    .order('port')
    .order('ont_id');
  if (error) return c.json({ error: error.message }, 500);
  return c.json(presentOntData(data));
});

/**
 * ONT(s) de un cliente puntual, sin conocer de antemano a que OLT
 * pertenece — usado por la ficha de Cliente para ofrecer el cambio rapido
 * de plan sin pasar por la seccion OLT.
 */
oltRoutes.get('/onts/by-client/:clientId', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select('*, plans(id, name, download_speed, upload_speed, olt_tcont_profile, olt_traffic_profile)').is('retired_at', null)
    .eq('client_id', c.req.param('clientId'))
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(presentOntData(data));
});

/**
 * Busca ONTs SIN cliente vinculado por numero de serie (parcial) — la
 * inmensa mayoria de las ONTs vienen de "import-existing" (Fase 4b), que
 * nunca asigna client_id a proposito (esa vinculacion es decision de esta
 * app). Usado desde la ficha de Cliente para vincular una ONT ya
 * registrada en la OLT sin tener que ir a la seccion OLT a buscarla.
 */
oltRoutes.get('/onts/search', requireRole(...STAFF_READ), async (c) => {
  const serial = c.req.query('serial')?.trim();
  if (!serial || serial.length < 3) return c.json({ error: 'Ingresa al menos 3 caracteres del numero de serie' }, 400);

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select('id, olt_device_id, serial, description, ont_id, frame, slot, port, status, olt_devices(id, name)').is('retired_at', null)
    .is('client_id', null)
    .ilike('serial', `%${serial}%`)
    .limit(20);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(presentOntData(data));
});

/**
 * Estado online/offline (segun olt_onts.status, cacheado del ultimo sync de
 * la OLT) para un lote de numeros de serie, sin filtrar por client_id (a
 * diferencia de onts/search) — usado desde /tr069 para mostrar el estado
 * real de la ONU al lado de cada dispositivo TR-069.
 */
oltRoutes.get('/onts/status', requireRole(...STAFF_READ), async (c) => {
  const raw = c.req.query('serials')?.trim();
  if (!raw) return c.json({ error: 'Falta el parametro serials (separados por coma)' }, 400);
  const serials = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (!serials.length) return c.json({});

  const { data, error } = await supabaseAdmin.from('olt_onts').select('id, olt_device_id, serial, frame, slot, port, ont_id, status, description, rx_power, tx_power, last_synced_at').is('retired_at', null).in('serial', serials);
  if (error) return c.json({ error: error.message }, 500);

  const byserial: Record<string, unknown> = {};
  for (const row of data ?? []) {
    const projected = ontTelemetry.project(row);
    byserial[row.serial] = { status: projected.status, description: row.description, telemetry: projected.telemetry, rx_power: projected.rx_power, tx_power: projected.tx_power };
  }
  return c.json(byserial);
});

/** Explicit metadata import; telemetry is published only by the shared serial-verified reader. */
oltRoutes.post('/:id/onts/import-existing', requireRole(...ONT_WRITE), guardOltReadOperation, async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  // Explicit import remains metadata-only: measurements use the shared serial-verified reader.
  const budget = createOltReadBudget(device);
  let scan: Awaited<ReturnType<typeof collectOltTelemetry>>;
  try {
    scan = await collectOltTelemetry(budget.read, { includeSignal: false });
    if (!scan.before || !scan.after || !scan.states) throw Error('Identidad o estado no confirmados; no se importó nada.');
  } catch { return c.json({ error: 'No se pudo verificar el inventario de seriales de la OLT.' }, 502); }
  const globalOnts = scan.states!;
  const fullConfig = scan.after!;
  const ports = new Set(globalOnts.map(o => `${o.frame}/${o.slot}/${o.port}`));
  const failedPorts = scan.failedPorts;
  // Preserve every existing identity, linked or unlinked, when a position is reused.
  const { data: linkedRows, error: identityError, count: identityCount } = await supabaseAdmin
    .from('olt_onts')
    .select('id, frame, slot, port, ont_id, serial, client_id', { count: 'exact' }).is('retired_at', null)
    .eq('olt_device_id', device.id).abortSignal(budget.signal);
  // Fail closed on transport/RLS errors AND truncated inventories. No mutation before this gate.
  if (identityError || !linkedRows || identityCount === null || linkedRows.length !== identityCount) {
    return c.json({ error: 'No se pudo obtener el inventario completo de identidades; no se importó nada.' }, 503);
  }
  const linkedPositions: LinkedPosition[] = (linkedRows ?? []).map((r) => ({
    frame: r.frame, slot: r.slot, port: r.port, ontId: r.ont_id, serial: r.serial, clientId: r.client_id as string | null,
  }));

  const candidates = globalOnts
    .map((o) => {
      const key = `${o.frame}/${o.slot}/${o.port}`;
      const b = fullConfig.get(`${key}:${o.onuId}`);
      if (!b || !b.serial) return null;
      const evidence = evaluateOntEvidence({ id: "candidate", olt_device_id: device.id, frame: o.frame, slot: o.slot, port: o.port, ont_id: o.onuId, serial: b.serial }, scan);
      if (evidence.outcome !== 'valid') return null;
      return {
        frame: o.frame,
        slot: o.slot,
        port: o.port,
        ontId: o.onuId,
        serial: b.serial,
        base: {
          olt_device_id: device.id,
          frame: o.frame,
          slot: o.slot,
          port: o.port,
          ont_id: o.onuId,
          serial: b.serial,
          onu_type: b.onuType,
          tcont_profile: b.tcontProfile,
          traffic_profile: b.trafficProfile,
          vlan: b.vlan,
          // No telemetry fields: import cannot make a historical value appear current.
        },
        name: b.name,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const { fullRefresh, keepDescription, conflicts } = classifyImportCandidates(candidates, linkedPositions);
  // Linked descriptions remain application-owned. Conflicts never reach a write.
  const rowsWithoutDescription = keepDescription.map((c) => c.base);
  const rowsWithDescription = fullRefresh.map((c) => ({ ...c.base, description: c.name }));

  let imported = 0;
  for (const metadata of [...rowsWithDescription, ...rowsWithoutDescription]) {
    if (budget.signal.aborted) return c.json({ error: 'Tiempo de importación agotado; no se iniciaron más escrituras.', imported }, 503);
    const existing = linkedRows.find(r => r.frame === metadata.frame && r.slot === metadata.slot && r.port === metadata.port && r.ont_id === metadata.ont_id);
    if (existing) {
      // Never update identity fields. Atomic predicates protect against a concurrent replacement/link.
      const { olt_device_id, frame, slot, port, ont_id, serial, ...patch } = metadata;
      let query = supabaseAdmin.from('olt_onts').update(patch).is('retired_at', null)
        .eq('id', existing.id).eq('olt_device_id', olt_device_id).eq('serial', existing.serial)
        .eq('frame', frame).eq('slot', slot).eq('port', port).eq('ont_id', ont_id);
      query = existing.client_id === null ? query.is('client_id', null) : query.eq('client_id', existing.client_id);
      const { data, error } = await query.select('id').abortSignal(budget.signal).maybeSingle();
      if (error || !data) return c.json({ error: 'Identidad o vínculo cambiado; importación detenida.', imported }, 409);
    } else {
      // Plain INSERT: a concurrently occupied position must fail, never take the UPDATE branch.
      const { error } = await supabaseAdmin.from('olt_onts').insert(metadata).abortSignal(budget.signal);
      if (error) return c.json({ error: 'No se pudo insertar la identidad sin sobrescribir registros.', imported }, 409);
    }
    imported++;
  }

  if (conflicts.length) {
    // eslint-disable-next-line no-console
    console.warn(`[olt/import] ${conflicts.length} conflicto(s) de identidad (ONT reemplazada/trasladada), requieren revision manual:`, conflicts.map(c => ({ position: c.position, expectedSerial: c.previousSerial, observedSerial: c.scannedSerial })));
  }

  return c.json({
    ok: true,
    scanned: globalOnts.length,
    imported,
    ports: ports.size,
    failedPorts,
    conflicts,
  });
});

oltRoutes.post('/:id/onts/sync', requireRole(...ONT_WRITE), guardOltReadOperation, async (c: Context) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const body = await c.req.json();
  const shelf = body.shelf ?? 1;
  const { slot, port } = body;
  if (slot == null || port == null) return c.json({ error: 'slot y port son requeridos' }, 400);

  try {
    const budget = createOltReadBudget(device);
    const scan = await collectOltTelemetry(budget.read, { includeSignal: false });
    const { data: rows, error } = await supabaseAdmin.from('olt_onts').select('*').is('retired_at', null)
      .eq('olt_device_id', device.id).eq('frame', shelf).eq('slot', slot).eq('port', port).abortSignal(budget.signal);
    if (error) throw Error('No se pudo consultar la identidad de las ONT.');
    let updated = 0;
    const conflicts: object[] = [];
    for (const row of rows ?? []) {
      const e = evaluateOntEvidence(row, scan); rememberOntEvidence(row, e);
      if (e.outcome !== 'valid') { conflicts.push({ serial: row.serial, position: e.position, observedSerial: e.observedSerial, outcome: e.outcome }); continue; }
      await persistOntMeasurement(row, { status: e.status as 'online' | 'offline', admin_state: e.adminState, last_synced_at: e.checkedAt }, undefined, budget.signal);
      updated++;
    }
    const found = (scan.states ?? []).filter(o => o.frame === shelf && o.slot === slot && o.port === port);
    return c.json({ synced: updated, foundInOlt: found.length, notInDb: found.filter(o => !(rows ?? []).some(r => r.ont_id === o.onuId)).map(o => o.onuId), identityConflicts: conflicts, raw: '' });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al sincronizar con la OLT' }, 502);
  }
});

// ---- Aprovisionamiento confiable (Fase 2) — ver oltProvisioningService.ts,
// oltProvisioningStore.ts, oltProvisioningHandler.ts y
// docs/auditoria/fase-2-aprovisionamiento.html ----

const provisioningStore = createSupabaseProvisioningStore(supabaseAdmin);

interface MikrotikDeviceRowForProvision {
  id: string;
  host: string;
  port: number;
  use_tls: boolean;
  username: string;
  password: string;
}

async function getMikrotikDeviceOrNull(id: string): Promise<MikrotikDeviceRowForProvision | null> {
  const { data, error } = await supabaseAdmin.from('mikrotik_devices').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as MikrotikDeviceRowForProvision;
}

/**
 * Fabrica del paso de WAN/PPPoE por OMCI — a diferencia de MikroTik, SI
 * necesita el onu-id (se conoce solo despues de que la OLT responde), por
 * eso es una funcion que recibe `onuId` en vez de una funcion ya armada
 * (ver buildSyncWan en oltProvisioningHandler.ts, que la llama justo a
 * tiempo). La clave en texto plano SOLO vive en este closure, nunca se
 * persiste en ningun lado (ni en `requested` ni en `steps`).
 */
function buildWanSyncFactory(
  device: OltDeviceRow,
  ref: ZteInterfaceRef,
  body: Record<string, unknown>,
): ((onuId: number) => () => Promise<void>) | undefined {
  const wan = body.wan as Record<string, unknown> | undefined;
  if (!wan?.username || !wan?.password || !wan?.vlanProfile) return undefined;

  return (onuId: number) => async () => {
    await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        configureWanPppoeCommands({
          ref,
          onuId,
          username: String(wan.username),
          password: String(wan.password),
          vlanProfile: String(wan.vlanProfile),
        }),
        { timeoutMs: 20000 },
      ),
    );
  };
}

function buildLinkDeps(body: ProvisionRequestBody): Pick<ProvisionHandlerDeps, 'preflight' | 'syncLinks'> {
  return {
    preflight: async () => {
      await validateProvisioningContract({
        getContract: async id => {
          const { data, error } = await supabaseAdmin.from('service_contracts')
            .select('id, client_id, mikrotik_device_id, pppoe_username, mikrotik_profile').eq('id', id).maybeSingle();
          if (error) throw new Error('No se pudo validar el contrato');
          return data;
        },
        hasOtherContract: async (routerId, username, contractId) => {
          const { data, error } = await supabaseAdmin.from('service_contracts').select('id')
            .eq('mikrotik_device_id', routerId).eq('pppoe_username', username).neq('id', contractId);
          if (error) throw new Error('No se pudo validar la referencia PPPoE');
          return !!data?.length;
        },
        readSecrets: async routerId => {
          const router = await getMikrotikDeviceOrNull(routerId);
          if (!router) throw new Error('Router del contrato no encontrado');
          const target: MikrotikTarget = { host: router.host, port: router.port, useTls: router.use_tls, username: router.username, password: router.password };
          try { return await mikrotikRequest(target, '/ppp/secret', { method: 'GET', retries: 0 }); }
          catch { throw new Error('No se pudo consultar la referencia PPPoE del contrato'); }
        },
      }, body);
    },
    syncLinks: async () => {
      if (!body.napId) return;
      const linked = await supabaseAdmin.rpc('assign_provisioning_nap', {
        p_nap_id: body.napId, p_contract_id: body.contractId, p_client_id: body.clientId,
      });
      if (linked.error) throw new Error('No se pudo asignar la NAP: ' + linked.error.message);
    },
  };
}

oltRoutes.route('/', createOltProvisioningRoutes({
  store: provisioningStore,
  buildDeps: async (deviceId, body, rawBody) => {
    const device = await getDeviceOrNull(deviceId);
    if (!device) return null;
    const links = buildLinkDeps(body);
    // Only a read-only reference stage is allowed, including legacy replays.
    return {
      store: provisioningStore, ...links, deviceId: device.id,
      sensitiveValues: [String((rawBody.wan as Record<string, unknown> | undefined)?.password ?? '')].filter(Boolean),
      withOltLock: fn => withOltLock(device.id, fn),
      runTelnet: (commands, opts) => runTelnetCommands(telnetTargetFor(device), commands, opts),
      syncMikrotik: body.mikrotik ? links.preflight : undefined,
      buildSyncWan: buildWanSyncFactory(device, { shelf: body.shelf ?? 1, slot: body.slot, port: body.port }, rawBody),
      onOntChanged: ont => oltEvents.emitOntChanged({ oltDeviceId: device.id, ont }),
    };
  },
}));

async function getOntOrNull(id: string | undefined) {
  if (!id) return null;
  const { data } = await supabaseAdmin.from('olt_onts').select('*').is('retired_at', null).eq('id', id).single();
  return data;
}

oltRoutes.post('/:id/onts/:ontDbId/activate', requireRole(...ONT_WRITE), (c) => toggleActivation(c, true));
oltRoutes.post('/:id/onts/:ontDbId/deactivate', requireRole(...ONT_WRITE), (c) => toggleActivation(c, false));

async function toggleActivation(c: Context, activate: boolean) {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  try {
    await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        setAdminStateCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id, activate),
      ),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al cambiar estado en la OLT' }, 502);
  }

  ontTelemetry.invalidate(ont.id);
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .update({ status: 'unknown', admin_state: activate ? 'enable' : 'disable' }).is('retired_at', null)
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(presentOntData(data));
}

/**
 * Cambia el plan (ancho de banda real) de una ONT ya registrada: aplica el
 * par tcont/traffic en la OLT via Telnet y lo deja guardado en olt_onts
 * junto con el plan_id (catalogo de negocio), si se envio uno. Ver
 * advertencia en changeOntProfileCommands() — comando de escritura nuevo,
 * probar primero con una ONT de baja criticidad.
 */
oltRoutes.put('/:id/onts/:ontDbId/plan', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  const body = await c.req.json();
  const { tcontProfile, trafficProfile, planId } = body;
  if (!tcontProfile || !trafficProfile) {
    return c.json({ error: 'tcontProfile y trafficProfile son requeridos (ver "show gpon profile tcont/traffic" en la OLT)' }, 400);
  }

  try {
    await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        changeOntProfileCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id, tcontProfile, trafficProfile),
      ),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al cambiar el plan en la OLT' }, 502);
  }

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .update({ tcont_profile: tcontProfile, traffic_profile: trafficProfile, plan_id: planId ?? null }).is('retired_at', null)
    .eq('id', ont.id)
    .select('*, clients(id, first_name, last_name, phone, address), zones(id, name), plans(id, name, download_speed, upload_speed)')
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(presentOntData(data));
});

/**
 * Validado contra el equipo real (2026-10-02) — ver advertencia en
 * configureWanPppoeCommands (Fase 75/76). "Autorizar ONU" ya llama esto solo
 * (PASO 6 de handleAuthorize en AuthorizeOnuModal.vue) cuando tiene la clave
 * en texto plano a mano — credencial nueva, o existente si el tecnico la
 * escribio en el formulario. Este endpoint sigue existiendo aparte para el
 * boton manual "Configurar WAN/PPPoE" en la ficha de la ONT, para cuando ese
 * paso automatico no corrio (secreto existente sin clave a mano) o fallo. No
 * persiste username/password en ningun lado (se piden en el formulario cada
 * vez) — a diferencia de otras rutas, esta NO actualiza olt_onts salvo
 * last_synced_at, porque la credencial no es dato nuestro.
 */
oltRoutes.post('/:id/onts/:ontDbId/wan-pppoe', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  const body = await c.req.json();
  const { username, password, vlanProfile, wanId, host } = body;
  if (!username || !password || !vlanProfile) {
    return c.json({ error: 'username, password y vlanProfile son requeridos (el vlan-profile debe existir ya en la OLT)' }, 400);
  }

  try {
    await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        configureWanPppoeCommands({
          ref: { shelf: ont.frame, slot: ont.slot, port: ont.port },
          onuId: ont.ont_id,
          username,
          password,
          vlanProfile,
          wanId,
          host,
        }),
        { timeoutMs: 20000 },
      ),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al configurar el WAN/PPPoE en la OLT' }, 502);
  }

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .update({ last_synced_at: new Date().toISOString() }).is('retired_at', null)
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(presentOntData(data));
});

/**
 * Metadata de topologia/contacto de una ONT (zona, splitter, direccion,
 * contacto, coordenadas, cliente vinculado) — estilo SmartOLT. Solo escribe
 * en Supabase, NO toca la OLT (a diferencia de activate/deactivate/delete
 * de arriba). "client_id" vive aqui porque es la misma naturaleza: una
 * decision de esta app, nunca sincronizada desde la OLT (ver import-existing).
 */
const ONT_META_FIELDS = [
  'zone_id',
  'splitter',
  'splitter_port',
  'description',
  'address_comment',
  'contact',
  'latitude',
  'longitude',
  'client_id',
  // A que servicio/linea del cliente pertenece este ONT (Fase 37) — mismo
  // criterio que client_id: decision de esta app, nunca sincronizada desde
  // la OLT.
  'contract_id',
] as const;

oltRoutes.put('/:id/onts/:ontDbId/meta', requireRole(...ONT_WRITE), async (c) => {
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  const body = await c.req.json();
  const update: Record<string, unknown> = {};
  for (const key of ONT_META_FIELDS) {
    if (key in body) update[key] = body[key] === '' ? null : body[key];
  }

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .update(update).is('retired_at', null)
    .eq('id', ont.id)
    .select('*, clients(id, first_name, last_name, phone, address), zones(id, name)')
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: ont.olt_device_id, ont: data });
  return c.json(presentOntData(data));
});

oltRoutes.delete('/:id/onts/:ontDbId', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  try {
    await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        deleteOntCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id),
      ),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al eliminar en la OLT' }, 502);
  }

  const { error } = await supabaseAdmin.from('olt_onts').delete().is('retired_at', null).eq('id', ont.id);
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: { id: ont.id, deleted: true } });
  return c.json({ ok: true });
});

oltRoutes.get('/:id/onts/:ontDbId/signal', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  try {
    const info = await readVerifiedOntSignal(device, ont);
    oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: info.ont });
    return c.json(info);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al leer la senal optica' }, 502);
  }
});

/** Config aplicada en la OLT para esta ONT puntual (solo lectura, texto crudo). */
oltRoutes.get('/:id/onts/:ontDbId/running-config', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  try {
    const outputs = await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        runningConfigCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id),
        { timeoutMs: 15000 },
      ),
    );
    return c.json({ raw: outputs[1] ?? '' });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al leer la configuracion de la ONT' }, 502);
  }
});

/**
 * Asigna el ACS (GenieACS) a una ONT via TR-069. body: { acsUrl, veip? }.
 * Ver setTr069AcsCommands() en zteCommands.ts — sintaxis confirmada contra
 * el equipo real, pero sin verificar aun de punta a punta (requiere una
 * ONT con VEIP, ej. tipo ZTE-F660, y GenieACS corriendo).
 */
oltRoutes.post('/:id/onts/:ontDbId/tr069', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  const body = await c.req.json();
  const acsUrl: string = body.acsUrl;
  const veip: number = body.veip ?? 1;
  if (!acsUrl) return c.json({ error: 'acsUrl es requerido' }, 400);

  try {
    await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        setTr069AcsCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id, veip, acsUrl),
      ),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al configurar TR-069 en la OLT' }, 502);
  }

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .update({ tr069_enabled: true, tr069_acs_url: acsUrl }).is('retired_at', null)
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(presentOntData(data));
});

oltRoutes.delete('/:id/onts/:ontDbId/tr069', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);
  const veip = Number(c.req.query('veip') ?? 1);

  try {
    await withOltLock(device.id, () =>
      runTelnetCommands(
        telnetTargetFor(device),
        disableTr069Commands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id, veip),
      ),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al desactivar TR-069 en la OLT' }, 502);
  }

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    // Reversion individual (requisito 10): limpia tambien quien/cuando lo
    // habilito — "habilitado por X el Y" deja de tener sentido una vez
    // desactivado. No toca service-port/VLAN/PPPoE: mismo alcance exacto
    // que disableTr069Commands() (pon-onu-mng/tr069-mgmt unicamente).
    .update({ tr069_enabled: false, tr069_enabled_by: null, tr069_enabled_at: null }).is('retired_at', null)
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(presentOntData(data));
});

/**
 * Habilitacion GUIADA de TR-069 por ONT (boton individual, 2026-10-27,
 * primer metodo experimental: OMCI via la OLT). A diferencia de
 * POST /:id/onts/:ontDbId/tr069 (generico, URL/VEIP a mano, ONT_WRITE), esta
 * ruta:
 *   1. Exige ADMIN/SUPERADMIN (TR069_ENABLE_ROLES) - validado en backend,
 *      nunca solo ocultando el boton en el frontend.
 *   2. Valida identidad/vinculo ANTES de tocar la OLT (validateTr069EnableRequest,
 *      logica pura — ver services/tr069Enable.ts y sus pruebas).
 *   3. Reverifica el serial EN VIVO en la posicion exacta (fullRunningConfigCommand,
 *      ya validado contra el equipo real) antes de escribir nada — nunca confia
 *      ciegamente en el ultimo sync guardado.
 *   4. Usa SIEMPRE el perfil ACS por defecto de esta OLT (olt_tr069_acs_profiles),
 *      nunca una URL escrita a mano por este flujo.
 *   5. Guarda quien/cuando (tr069_enabled_by/at) - requisito 8, minimo cambio
 *      de esquema.
 * No toca service-port/VLAN/PPPoE de esta ni de ninguna otra ONT: el unico
 * comando que se ejecuta es setTr069AcsCommands() (igual que el flujo manual).
 */
oltRoutes.post('/:id/onts/:ontDbId/tr069/enable-guided', requireRole(...TR069_ENABLE_ROLES), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);
  const user = c.get('user');

  if (!tr069EnableGuard.tryAcquire(ont.id)) {
    return c.json({ error: 'Ya hay una solicitud de habilitación en curso para esta ONT.' }, 409);
  }

  try {
    const { data: serviceContract } = ont.contract_id
      ? await supabaseAdmin.from('service_contracts').select('id').eq('id', ont.contract_id).maybeSingle()
      : { data: null };

    const check = validateTr069EnableRequest({
      role: user.role,
      oltBrand: device.brand,
      ont: {
        serial: ont.serial,
        retired_at: ont.retired_at,
        tr069_enabled: ont.tr069_enabled,
        client_id: ont.client_id,
        contract_id: ont.contract_id,
        service_contract: serviceContract ?? null,
      },
    });
    if (!check.ok) {
      return c.json({ error: check.message, rejection: check.rejection, vendor: check.vendor }, 422);
    }

    const { data: profile } = await supabaseAdmin
      .from('olt_tr069_acs_profiles')
      .select('acs_url')
      .eq('olt_device_id', device.id)
      .eq('is_default', true)
      .maybeSingle();
    if (!profile?.acs_url) {
      return c.json({ error: 'No hay un perfil ACS por defecto configurado para esta OLT. Configúralo primero en "Perfil ACS".' }, 422);
    }

    const ref: ZteInterfaceRef = { shelf: ont.frame, slot: ont.slot, port: ont.port };
    const veip = 1;

    const result = await withOltLock(device.id, async () => {
      // Paso 1 (solo lectura): reverifica el serial EN VIVO en esta posicion
      // exacta — nunca se escribe sobre una posicion sin volver a confirmarla.
      const configOut = await runTelnetCommands(telnetTargetFor(device), fullRunningConfigCommand(), { timeoutMs: 120000 });
      const fullConfig = parseFullRunningConfig(configOut[1] ?? '');
      const key = `${ref.shelf}/${ref.slot}/${ref.port}:${ont.ont_id}`;
      const liveSerial = fullConfig.get(key)?.serial ?? null;
      const positionCheck = verifyLivePosition({ expectedSerial: ont.serial, liveSerial });
      if (!positionCheck.ok) return { kind: 'position_mismatch' as const, message: positionCheck.message! };

      // Paso 2 (unica escritura): exactamente el mismo comando que el modal manual.
      await runTelnetCommands(telnetTargetFor(device), setTr069AcsCommands(ref, ont.ont_id, veip, profile.acs_url));
      return { kind: 'applied' as const };
    });

    if (result.kind === 'position_mismatch') {
      return c.json({ error: result.message }, 409);
    }

    const { data, error } = await supabaseAdmin
      .from('olt_onts')
      .update({ tr069_enabled: true, tr069_acs_url: profile.acs_url, tr069_enabled_by: user.id, tr069_enabled_at: new Date().toISOString() })
      .is('retired_at', null)
      .eq('id', ont.id)
      .select()
      .single();
    if (error) return c.json({ error: error.message }, 400);
    oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
    return c.json({ ont: presentOntData(data), vendor: check.vendor, thirdPartyVendor: check.thirdPartyVendor });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al habilitar TR-069 en la OLT' }, 502);
  } finally {
    tr069EnableGuard.release(ont.id);
  }
});

/**
 * Estado de confirmacion de identidad (requisito 6/7): busca en tr069_devices
 * (ya sincronizada por el scheduler, server/src/services/tr069Scheduler.ts)
 * un dispositivo cuyo cpe_serial coincida EXACTO con el de esta ONT. Nunca
 * basta con "apareció algún CPE nuevo" — tiene que ser ESTE serial.
 */
oltRoutes.get('/:id/onts/:ontDbId/tr069/status', requireRole(...STAFF_READ), async (c) => {
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  const { data: matchedDevice } = await supabaseAdmin
    .from('tr069_devices')
    .select('cpe_serial, last_seen_at')
    .ilike('cpe_serial', ont.serial)
    .maybeSingle();

  return c.json({
    tr069_enabled: ont.tr069_enabled,
    requestInFlight: tr069EnableGuard.has(ont.id),
    matchedDevice: matchedDevice ?? null,
  });
});
