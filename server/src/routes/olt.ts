import { Hono, type Context } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { runTelnetCommands } from '../telnet/client';
import {
  testConnectionCommands,
  listOntsCommands,
  listAllOntsCommands,
  listUnconfiguredOntsCommands,
  registerOntCommands,
  setAdminStateCommands,
  deleteOntCommands,
  opticalInfoCommands,
  oltHealthCommands,
  listTcontProfilesCommands,
  listTrafficProfilesCommands,
  setTr069AcsCommands,
  disableTr069Commands,
} from '../ssh/zteCommands';
import {
  parseOntList,
  parseGlobalOntState,
  parseOpticalInfo,
  parseUnconfiguredOnts,
  parseUptime,
  parseCardTemperatures,
  parseProcessorLoad,
  parseProfileNames,
  type OltUptime,
  type SlotTemperature,
  type SlotLoad,
} from '../ssh/zteParsers';

// Rango de senal optica GPON aceptable segun el glosario del curso: -8 a -27 dBm.
const LOW_SIGNAL_THRESHOLD_DBM = -27;

export const oltRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
// Gestionar el registro de la OLT (alta/edicion/baja del equipo) es tarea de
// administracion, no del tecnico de campo.
const DEVICE_WRITE = ['SUPERADMIN', 'ADMIN'] as const;
// Gestionar ONTs (registrar, activar/desactivar, eliminar, senal) si es
// trabajo del tecnico de campo con el equipo ya dado de alta.
const ONT_WRITE = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] as const;

const DEVICE_PUBLIC_FIELDS = 'id, name, host, brand, telnet_port, username, zone_id, is_active, created_at';

oltRoutes.use('*', requireAuth);

export interface OltDeviceRow {
  id: string;
  name: string;
  host: string;
  telnet_port: number;
  username: string;
  password: string;
  brand: string;
}

async function getDeviceOrNull(id: string | undefined): Promise<OltDeviceRow | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin.from('olt_devices').select('*').eq('id', id).single();
  if (error || !data) return null;
  return data as OltDeviceRow;
}

// La OLT ZTE C300 solo tiene Telnet habilitado (SSH resetea la conexion,
// confirmado manualmente). Ver server/src/telnet/client.ts.
function telnetTargetFor(device: OltDeviceRow) {
  return { host: device.host, port: device.telnet_port, username: device.username, password: device.password };
}

export interface OltSummaryResult {
  unconfigured: number;
  online: number;
  offline: number;
  lowSignal: number;
  scanComplete: boolean;
}

/**
 * Resumen estilo SmartOLT de una sola OLT, con escaneo EN VIVO ("sin
 * autorizar" via show gpon onu uncfg, online/offline via show gpon onu
 * state sin filtro de puerto). Compartido entre el endpoint por-OLT y el
 * agregado del Dashboard. Ver comentario original en la ruta /:id/summary.
 */
export async function computeOltSummary(device: OltDeviceRow): Promise<OltSummaryResult> {
  let unconfigured = 0;
  let online = 0;
  let offline = 0;

  try {
    const outputs = await runTelnetCommands(telnetTargetFor(device), listUnconfiguredOntsCommands());
    unconfigured = parseUnconfiguredOnts(outputs.join('\n')).length;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[olt/summary] No se pudo consultar ONUs sin autorizar:', e);
  }

  let globalScanOk = false;
  try {
    const outputs = await runTelnetCommands(telnetTargetFor(device), listAllOntsCommands(), { timeoutMs: 45000 });
    const all = parseGlobalOntState(outputs.join('\n'));
    online = all.filter((o) => o.runState === 'working').length;
    offline = all.length - online;
    globalScanOk = true;

    // Actualizar de paso el estado de las ONTs que ya tenemos localmente.
    const byKey = new Map(all.map((o) => [`${o.frame}/${o.slot}/${o.port}:${o.onuId}`, o]));
    const { data: known } = await supabaseAdmin
      .from('olt_onts')
      .select('id, frame, slot, port, ont_id')
      .eq('olt_device_id', device.id);

    for (const row of known ?? []) {
      const found = byKey.get(`${row.frame}/${row.slot}/${row.port}:${row.ont_id}`);
      if (found) {
        await supabaseAdmin
          .from('olt_onts')
          .update({ status: found.runState === 'working' ? 'online' : 'offline', last_synced_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[olt/summary] Fallo el escaneo global, usando cache local:', e);
  }

  if (!globalScanOk) {
    // Respaldo: si el escaneo en vivo falla (timeout, etc.), no dejar el
    // resumen en cero — usar lo que ya tengamos sincronizado localmente.
    const { data: onts } = await supabaseAdmin.from('olt_onts').select('status').eq('olt_device_id', device.id);
    const rows = onts ?? [];
    online = rows.filter((r) => r.status === 'online').length;
    offline = rows.filter((r) => r.status === 'offline').length;
  }

  const { data: signalRows } = await supabaseAdmin
    .from('olt_onts')
    .select('rx_power')
    .eq('olt_device_id', device.id)
    .not('rx_power', 'is', null);
  const lowSignal = (signalRows ?? []).filter((r) => (r.rx_power as number) < LOW_SIGNAL_THRESHOLD_DBM).length;

  return { unconfigured, online, offline, lowSignal, scanComplete: globalScanOk };
}

export interface OltHealthResult {
  uptime: OltUptime | null;
  temperature: SlotTemperature[];
  load: SlotLoad[];
}

/**
 * Salud del chasis (uptime, temperatura y CPU/RAM por tarjeta), en vivo via
 * Telnet. Compartida entre el endpoint por-OLT y el agregado del Dashboard.
 * Ver comentarios de oltHealthCommands() en zteCommands.ts.
 */
export async function computeOltHealth(device: OltDeviceRow): Promise<OltHealthResult> {
  try {
    const outputs = await runTelnetCommands(telnetTargetFor(device), oltHealthCommands());
    return {
      uptime: parseUptime(outputs[1] ?? ''),
      temperature: parseCardTemperatures(outputs[2] ?? ''),
      load: parseProcessorLoad(outputs[3] ?? ''),
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[olt/health] No se pudo consultar la salud de la OLT:', e);
    return { uptime: null, temperature: [], load: [] };
  }
}

// ---- CRUD olt_devices ----

oltRoutes.get('/', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_devices')
    .select(DEVICE_PUBLIC_FIELDS)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
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
    const outputs = await runTelnetCommands(telnetTargetFor(device), testConnectionCommands());
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
 * Resumen estilo SmartOLT, con escaneo EN VIVO de toda la OLT (no solo el
 * cache local): "sin autorizar" via show gpon onu uncfg, y online/offline
 * via show gpon onu state SIN filtro de puerto (lista todas las ONUs de
 * una vez — validado contra el equipo real: ~646/675 filas, ver
 * zteCommands.ts). De paso, actualiza el estado de las ONTs que ya
 * tenemos registradas localmente (por frame/slot/port/ont_id), sin
 * llamadas extra. "Senal baja" sigue viniendo del cache local (rx_power
 * solo se lee ONT por ONT, ver /onts/:ontDbId/signal).
 */
oltRoutes.get('/:id/summary', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const summary = await computeOltSummary(device);
  return c.json({ ...summary, checkedAt: new Date().toISOString() });
});

/**
 * Salud del chasis en vivo: horas activas (uptime), temperatura y CPU/RAM
 * por tarjeta. Ver computeOltHealth().
 */
oltRoutes.get('/:id/health', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const health = await computeOltHealth(device);
  return c.json({ ...health, checkedAt: new Date().toISOString() });
});

/** Perfiles de ancho de banda (tcont/traffic) ya configurados en la OLT. */
oltRoutes.get('/:id/profiles', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  try {
    const [tcontOut, trafficOut] = await Promise.all([
      runTelnetCommands(telnetTargetFor(device), listTcontProfilesCommands(), { timeoutMs: 15000 }),
      runTelnetCommands(telnetTargetFor(device), listTrafficProfilesCommands(), { timeoutMs: 15000 }),
    ]);
    return c.json({
      tcontProfiles: parseProfileNames(tcontOut[1] ?? ''),
      trafficProfiles: parseProfileNames(trafficOut[1] ?? ''),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar los perfiles de la OLT' }, 502);
  }
});

// ---- ONTs (cache local en olt_onts, sincronizada bajo demanda por Telnet) ----

oltRoutes.get('/:id/onts', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select('*, clients(id, first_name, last_name)')
    .eq('olt_device_id', c.req.param('id'))
    .order('slot')
    .order('port')
    .order('ont_id');
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

oltRoutes.post('/:id/onts/sync', requireRole(...ONT_WRITE), async (c: Context) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const body = await c.req.json();
  const shelf = body.shelf ?? 1;
  const { slot, port } = body;
  if (slot == null || port == null) return c.json({ error: 'slot y port son requeridos' }, 400);

  try {
    const outputs = await runTelnetCommands(telnetTargetFor(device), listOntsCommands({ shelf, slot, port }));
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

      await supabaseAdmin
        .from('olt_onts')
        .update({
          status: ont.runState === 'working' ? 'online' : 'offline',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      updated += 1;
    }

    return c.json({ synced: updated, foundInOlt: parsed.length, notInDb, raw });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al sincronizar con la OLT' }, 502);
  }
});

oltRoutes.post('/:id/onts', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const body = await c.req.json();
  const shelf = body.shelf ?? 1;
  const { slot, port, serial, onuType, description, vlan, clientId, tcontProfile, trafficProfile } = body;
  if (!tcontProfile || !trafficProfile) {
    return c.json({ error: 'tcontProfile y trafficProfile son requeridos (ver "show gpon profile tcont/traffic" en la OLT)' }, 400);
  }
  let onuId: number = body.onuId;

  if (onuId == null) {
    // El ID libre se calcula contra la OLT EN VIVO, no solo contra nuestra
    // cache local (olt_onts) — la cache puede estar incompleta y reusar un
    // ID que ya pertenece a una ONT real existente en el equipo.
    let usedLive = new Set<number>();
    try {
      const outputs = await runTelnetCommands(telnetTargetFor(device), listOntsCommands({ shelf, slot, port }), {
        timeoutMs: 20000,
      });
      usedLive = new Set(parseOntList(outputs.join('\n')).map((o) => o.onuId));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'No se pudo verificar los IDs en uso en la OLT' }, 502);
    }
    const { data: existing } = await supabaseAdmin
      .from('olt_onts')
      .select('ont_id')
      .eq('olt_device_id', device.id)
      .eq('slot', slot)
      .eq('port', port);
    for (const r of existing ?? []) usedLive.add((r as { ont_id: number }).ont_id);

    onuId = 1;
    while (usedLive.has(onuId)) onuId += 1;
  }

  try {
    await runTelnetCommands(
      telnetTargetFor(device),
      registerOntCommands({ ref: { shelf, slot, port }, onuId, serial, onuType, vlan, description, tcontProfile, trafficProfile }),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al registrar en la OLT' }, 502);
  }

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .upsert(
      {
        olt_device_id: device.id,
        client_id: clientId ?? null,
        frame: shelf,
        slot,
        port,
        ont_id: onuId,
        serial,
        description,
        onu_type: onuType,
        vlan,
        tcont_profile: tcontProfile,
        traffic_profile: trafficProfile,
        status: 'unknown',
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'olt_device_id,frame,slot,port,ont_id' },
    )
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

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
    await runTelnetCommands(
      telnetTargetFor(device),
      setAdminStateCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id, activate),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al cambiar estado en la OLT' }, 502);
  }

  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .update({ status: activate ? 'online' : 'offline' })
    .eq('id', ont.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
}

oltRoutes.delete('/:id/onts/:ontDbId', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  try {
    await runTelnetCommands(
      telnetTargetFor(device),
      deleteOntCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al eliminar en la OLT' }, 502);
  }

  const { error } = await supabaseAdmin.from('olt_onts').delete().eq('id', ont.id);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

oltRoutes.get('/:id/onts/:ontDbId/signal', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);

  try {
    const outputs = await runTelnetCommands(
      telnetTargetFor(device),
      opticalInfoCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id),
    );
    const raw = outputs.join('\n');
    const info = parseOpticalInfo(raw);
    if (info.rxPower == null && info.txPower == null) {
      // eslint-disable-next-line no-console
      console.error(`[olt/signal] Parser no encontro Rx/Tx en la salida real:\n---\n${raw}\n---`);
    }
    await supabaseAdmin.from('olt_onts').update({ rx_power: info.rxPower, tx_power: info.txPower }).eq('id', ont.id);
    return c.json(info);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al leer la senal optica' }, 502);
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
    await runTelnetCommands(
      telnetTargetFor(device),
      setTr069AcsCommands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id, veip, acsUrl),
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
  return c.json(data);
});

oltRoutes.delete('/:id/onts/:ontDbId/tr069', requireRole(...ONT_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);
  const ont = await getOntOrNull(c.req.param('ontDbId'));
  if (!ont) return c.json({ error: 'ONT no encontrada' }, 404);
  const veip = Number(c.req.query('veip') ?? 1);

  try {
    await runTelnetCommands(
      telnetTargetFor(device),
      disableTr069Commands({ shelf: ont.frame, slot: ont.slot, port: ont.port }, ont.ont_id, veip),
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
  return c.json(data);
});
