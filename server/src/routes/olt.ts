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
import { oltEvents, type OntChangedEvent, type SummaryChangedEvent } from '../services/oltEvents';
import {
  testConnectionCommands,
  listOntsCommands,
  listAllOntsCommands,
  listUnconfiguredOntsCommands,
  configureWanPppoeCommands,
  changeOntProfileCommands,
  setAdminStateCommands,
  deleteOntCommands,
  runningConfigCommands,
  fullRunningConfigCommand,
  bulkOnuRxCommands,
  bulkOnuTxCommands,
  listTcontProfilesCommands,
  listTrafficProfilesCommands,
  setTr069AcsCommands,
  disableTr069Commands,
  type ZteInterfaceRef,
} from '../ssh/zteCommands';
import {
  parseOntList,
  parseGlobalOntState,
  parseBulkPower,
  parseFullRunningConfig,
  parseUnconfiguredOnts,
  parseProfileNames,
} from '../ssh/zteParsers';
import { createSupabaseProvisioningStore } from '../services/oltProvisioningStore';
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

/**
 * Potencia optica de UNA ONU puntual. "show pon power attenuation
 * gpon-onu_S/L/P:ID" (por ONU individual) NO existe en este firmware real
 * — confirmado contra el equipo (10.15.15.2): "%Error 20202: Invalid input
 * detected". Se usa en su lugar el comando bulk por puerto ya validado
 * (bulkOnuRxCommands/bulkOnuTxCommands, el mismo que usa el sync en
 * background) y se extrae solo esta ONU del resultado.
 *
 * OJO: no adquiere su propio withOltLock — el caller (endpoint /signal o el
 * registro de una ONT) ya debe estar corriendo dentro de uno. Adquirirlo
 * aqui tambien causaria un deadlock si el caller ya tiene el turno tomado.
 */
async function readOntSignal(device: OltDeviceRow, ref: ZteInterfaceRef, onuId: number) {
  const rxOut = await runTelnetCommands(telnetTargetFor(device), bulkOnuRxCommands(ref), { timeoutMs: 30000 });
  const txOut = await runTelnetCommands(telnetTargetFor(device), bulkOnuTxCommands(ref), { timeoutMs: 30000 });
  const rxPower = parseBulkPower(rxOut[1] ?? '').get(onuId) ?? null;
  const txPower = parseBulkPower(txOut[1] ?? '').get(onuId) ?? null;
  return { rxPower, txPower };
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
    .select('status, admin_state, rx_power')
    .eq('olt_device_id', device.id);
  const rows = onts ?? [];
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
      void stream.writeSSE({ event: 'ontChanged', data: JSON.stringify(payload.ont) });
    };
    const onSummaryChanged = (payload: SummaryChangedEvent) => {
      if (payload.oltDeviceId !== deviceId) return;
      void stream.writeSSE({ event: 'summaryChanged', data: JSON.stringify(payload) });
    };

    oltEvents.on('ontChanged', onOntChanged);
    oltEvents.on('summaryChanged', onSummaryChanged);

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
    }
  });
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
    .select('serial, client_id, contract_id, clients(id, first_name, last_name, document_number)')
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
 * background), y (b) el cliente vinculado esta en corte por mora
 * (service_contracts.debt_hold_status='suspended' — ver debtHoldService.ts,
 * que solo reduce el ancho de banda via changeOntProfileCommands, NUNCA
 * toca admin-state). El vinculo con el cliente es por client_id, misma
 * limitacion ya conocida y aceptada que usa debtHoldService.ts.
 *
 * 100% lectura de Supabase (cache ya poblada por el sync de fondo o por
 * activate/deactivate) — sin Telnet, sin withOltLock, instantaneo.
 */
oltRoutes.get('/:id/onts/disabled', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const { data: manualRows } = await supabaseAdmin
    .from('olt_onts')
    .select('*, clients(id, first_name, last_name, phone, address), zones(id, name)')
    .eq('olt_device_id', device.id)
    .eq('admin_state', 'disable');

  const { data: suspendedContracts } = await supabaseAdmin
    .from('service_contracts')
    .select('client_id')
    .eq('debt_hold_status', 'suspended');
  const suspendedClientIds = [...new Set((suspendedContracts ?? []).map((r) => r.client_id))];

  let billingRows: NonNullable<typeof manualRows> = [];
  if (suspendedClientIds.length) {
    const { data } = await supabaseAdmin
      .from('olt_onts')
      .select('*, clients(id, first_name, last_name, phone, address), zones(id, name)')
      .eq('olt_device_id', device.id)
      .in('client_id', suspendedClientIds);
    billingRows = data ?? [];
  }

  const byId = new Map<string, Record<string, unknown> & { id: string; reasons: string[] }>();
  for (const r of manualRows ?? []) byId.set(r.id, { ...r, reasons: ['manual'] });
  for (const r of billingRows) {
    const existing = byId.get(r.id);
    if (existing) existing.reasons.push('billing');
    else byId.set(r.id, { ...r, reasons: ['billing'] });
  }

  const items = [...byId.values()].map(({ reasons, ...r }) => ({
    ...r,
    reason: reasons.includes('manual') && reasons.includes('billing') ? 'both' : reasons.includes('manual') ? 'manual' : 'billing',
  }));

  return c.json({ items, checkedAt: new Date().toISOString() });
});

// ---- ONTs (cache local en olt_onts, sincronizada en background por Telnet) ----

oltRoutes.get('/:id/onts', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select('*, clients(id, first_name, last_name, phone, address), zones(id, name)')
    .eq('olt_device_id', c.req.param('id'))
    .order('slot')
    .order('port')
    .order('ont_id');
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

/**
 * ONT(s) de un cliente puntual, sin conocer de antemano a que OLT
 * pertenece — usado por la ficha de Cliente para ofrecer el cambio rapido
 * de plan sin pasar por la seccion OLT.
 */
oltRoutes.get('/onts/by-client/:clientId', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select('*, plans(id, name, download_speed, upload_speed, olt_tcont_profile, olt_traffic_profile)')
    .eq('client_id', c.req.param('clientId'))
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
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
    .select('id, olt_device_id, serial, description, ont_id, slot, port, status, olt_devices(id, name)')
    .is('client_id', null)
    .ilike('serial', `%${serial}%`)
    .limit(20);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
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

  const { data, error } = await supabaseAdmin.from('olt_onts').select('serial, status, description').in('serial', serials);
  if (error) return c.json({ error: error.message }, 500);

  const byserial: Record<string, { status: string; description: string | null }> = {};
  for (const row of data ?? []) byserial[row.serial] = { status: row.status, description: row.description };
  return c.json(byserial);
});

/**
 * Importa TODAS las ONTs ya configuradas en la OLT (heredadas de SmartOLT u
 * otra herramienta, nunca registradas via esta app) hacia olt_onts, con su
 * nombre/plan/VLAN/senal. Solo lectura contra la OLT (no toca la config
 * real):
 *   1. "show gpon onu state" global -> frame/slot/port/onuId/runState de
 *      TODAS las ONUs de una sola vez (mismo comando que usa el sync).
 *   2. "show running-config" (TODO el equipo, sin filtro) -> UN SOLO
 *      comando (~10s con 675 ONUs, validado) trae serial/tipo/nombre/
 *      descripcion/plan/VLAN de TODAS las ONUs a la vez. Mucho mas barato
 *      que pedir el running-config de cada ONU por separado (675 comandos).
 *   3. Por cada puerto PON unico, 2 comandos que traen la senal optica de
 *      TODAS sus ONUs de una vez (bulkOnuRxCommands/bulkOnuTxCommands) — la
 *      senal es telemetria en vivo, no config, asi que no sale del dump
 *      anterior. Secuencial, NO en paralelo: 3 conexiones Telnet
 *      simultaneas al mismo equipo causaron timeouts reales en los puertos
 *      con mas ONUs (ver incidente 2026-09-11 — 8 de 19 puertos fallaron).
 *      OJO: rx y tx tampoco se pueden combinar en una sola conexion — se
 *      probo (2026-09-22) y el equipo real se cuelga sin dar el prompt al
 *      encadenar "onu-tx" justo despues de "onu-rx" en la misma sesion.
 *   4. Upsert en bloque. Nunca pisa client_id (esa vinculacion es decision
 *      de esta app, no de la OLT) — todo lo demas se sincroniza desde la
 *      OLT en cada import, que es la fuente de verdad de su propia config.
 *
 * Todo el paso 1-3 corre dentro de UN SOLO turno de withOltLock (el sync en
 * background espera a que termine antes de tomar su turno).
 */
oltRoutes.post('/:id/onts/import-existing', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  let scanResult: {
    globalOnts: ReturnType<typeof parseGlobalOntState>;
    fullConfig: ReturnType<typeof parseFullRunningConfig>;
    ports: Map<string, { shelf: number; slot: number; port: number }>;
    rxByPort: Map<string, Map<number, number>>;
    txByPort: Map<string, Map<number, number>>;
    failedPorts: string[];
  };
  try {
    scanResult = await withOltLock(device.id, async () => {
      const stateOut = await runTelnetCommands(telnetTargetFor(device), listAllOntsCommands(), { timeoutMs: 60000 });
      const globalOnts = parseGlobalOntState(stateOut.join('\n'));
      const configOut = await runTelnetCommands(telnetTargetFor(device), fullRunningConfigCommand(), { timeoutMs: 120000 });
      const fullConfig = parseFullRunningConfig(configOut[1] ?? '');

      const ports = new Map<string, { shelf: number; slot: number; port: number }>();
      for (const o of globalOnts) {
        const key = `${o.frame}/${o.slot}/${o.port}`;
        if (!ports.has(key)) ports.set(key, { shelf: o.frame, slot: o.slot, port: o.port });
      }

      const rxByPort = new Map<string, Map<number, number>>();
      const txByPort = new Map<string, Map<number, number>>();
      const failedPorts: string[] = [];
      for (const ref of ports.values()) {
        const key = `${ref.shelf}/${ref.slot}/${ref.port}`;
        try {
          const rxOut = await runTelnetCommands(telnetTargetFor(device), bulkOnuRxCommands(ref), { timeoutMs: 30000 });
          const txOut = await runTelnetCommands(telnetTargetFor(device), bulkOnuTxCommands(ref), { timeoutMs: 30000 });
          rxByPort.set(key, parseBulkPower(rxOut[1] ?? ''));
          txByPort.set(key, parseBulkPower(txOut[1] ?? ''));
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(`[olt/import] fallo el puerto ${key}:`, e);
          failedPorts.push(key);
        }
      }

      return { globalOnts, fullConfig, ports, rxByPort, txByPort, failedPorts };
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al escanear la OLT' }, 502);
  }

  const { globalOnts, fullConfig, ports, rxByPort, txByPort, failedPorts } = scanResult;
  const now = new Date().toISOString();
  const rows = globalOnts
    .map((o) => {
      const key = `${o.frame}/${o.slot}/${o.port}`;
      const b = fullConfig.get(`${key}:${o.onuId}`);
      if (!b || !b.serial) return null;
      return {
        olt_device_id: device.id,
        frame: o.frame,
        slot: o.slot,
        port: o.port,
        ont_id: o.onuId,
        serial: b.serial,
        onu_type: b.onuType,
        description: b.name,
        tcont_profile: b.tcontProfile,
        traffic_profile: b.trafficProfile,
        vlan: b.vlan,
        status: o.runState === 'working' ? 'online' : 'offline',
        rx_power: rxByPort.get(key)?.get(o.onuId) ?? null,
        tx_power: txByPort.get(key)?.get(o.onuId) ?? null,
        last_synced_at: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length) {
    const { error } = await supabaseAdmin
      .from('olt_onts')
      .upsert(rows, { onConflict: 'olt_device_id,frame,slot,port,ont_id' });
    if (error) return c.json({ error: error.message }, 400);
  }

  return c.json({ ok: true, scanned: globalOnts.length, imported: rows.length, ports: ports.size, failedPorts });
});

oltRoutes.post('/:id/onts/sync', requireRole(...ONT_WRITE), async (c: Context) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const body = await c.req.json();
  const shelf = body.shelf ?? 1;
  const { slot, port } = body;
  if (slot == null || port == null) return c.json({ error: 'slot y port son requeridos' }, 400);

  try {
    const outputs = await withOltLock(device.id, () =>
      runTelnetCommands(telnetTargetFor(device), listOntsCommands({ shelf, slot, port })),
    );
    const raw = outputs.join('\n');
    const parsed = parseOntList(raw);

    // "show gpon onu state" (validado contra el equipo real) no trae numero
    // de serie, solo el estado por onu-id. Por eso solo actualizamos el
    // estado de ONTs que ya conocemos (registradas por esta app, que si
    // tienen serial); las que aparecen en la OLT pero no en nuestra BD se
    // reportan aparte (para registrarlas manualmente con su serial real,
    // ej. via "show gpon onu uncfg" si aun no estan configuradas).
    let updated = 0;
    const notInDb: number[] = [];

    for (const ont of parsed) {
      const { data: existing } = await supabaseAdmin
        .from('olt_onts')
        .select('id')
        .eq('olt_device_id', device.id)
        .eq('frame', shelf)
        .eq('slot', slot)
        .eq('port', port)
        .eq('ont_id', ont.onuId)
        .maybeSingle();

      if (!existing) {
        notInDb.push(ont.onuId);
        continue;
      }

      const { data: updatedRow } = await supabaseAdmin
        .from('olt_onts')
        .update({
          status: ont.runState === 'working' ? 'online' : 'offline',
          admin_state: ont.adminState,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (updatedRow) oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: updatedRow });
      updated += 1;
    }

    return c.json({ synced: updated, foundInOlt: parsed.length, notInDb, raw });
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
  const { data } = await supabaseAdmin.from('olt_onts').select('*').eq('id', id).single();
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

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .update({ status: activate ? 'online' : 'offline', admin_state: activate ? 'enable' : 'disable' })
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(data);
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
    .update({ tcont_profile: tcontProfile, traffic_profile: trafficProfile, plan_id: planId ?? null })
    .eq('id', ont.id)
    .select('*, clients(id, first_name, last_name, phone, address), zones(id, name), plans(id, name, download_speed, upload_speed)')
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(data);
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
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(data);
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
    .update(update)
    .eq('id', ont.id)
    .select('*, clients(id, first_name, last_name, phone, address), zones(id, name)')
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: ont.olt_device_id, ont: data });
  return c.json(data);
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

  const { error } = await supabaseAdmin.from('olt_onts').delete().eq('id', ont.id);
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
    const info = await withOltLock(device.id, () =>
      readOntSignal(device, { shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id),
    );
    const { data } = await supabaseAdmin
      .from('olt_onts')
      .update({ rx_power: info.rxPower, tx_power: info.txPower })
      .eq('id', ont.id)
      .select()
      .single();
    if (data) oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
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
    .update({ tr069_enabled: true, tr069_acs_url: acsUrl })
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(data);
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
    .update({ tr069_enabled: false })
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  oltEvents.emitOntChanged({ oltDeviceId: device.id, ont: data });
  return c.json(data);
});
