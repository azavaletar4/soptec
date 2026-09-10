import { Hono, type Context } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { runTelnetCommands } from '../telnet/client';
import {
  testConnectionCommands,
  listOntsCommands,
  listUnconfiguredOntsCommands,
  registerOntCommands,
  setAdminStateCommands,
  deleteOntCommands,
  opticalInfoCommands,
} from '../ssh/zteCommands';
import { parseOntList, parseOpticalInfo, parseUnconfiguredOnts } from '../ssh/zteParsers';

// Rango de senal optica GPON aceptable segun el glosario del curso: -8 a -27 dBm.
const LOW_SIGNAL_THRESHOLD_DBM = -27;

export const oltRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
const STAFF_WRITE = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED'] as const;

const DEVICE_PUBLIC_FIELDS = 'id, name, host, brand, telnet_port, username, zone_id, is_active, created_at';

oltRoutes.use('*', requireAuth);

interface OltDeviceRow {
  id: string;
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

// ---- CRUD olt_devices ----

oltRoutes.get('/', requireRole(...STAFF_READ), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('olt_devices')
    .select(DEVICE_PUBLIC_FIELDS)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

oltRoutes.post('/', requireRole(...STAFF_WRITE), async (c) => {
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

oltRoutes.put('/:id', requireRole(...STAFF_WRITE), async (c) => {
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

oltRoutes.delete('/:id', requireRole(...STAFF_WRITE), async (c) => {
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
 * Resumen estilo SmartOLT: sin autorizar (en vivo, ~200ms confirmado en Fase 4),
 * online/offline/senal baja (del cache local olt_onts — solo refleja los
 * puertos ya sincronizados, no es un escaneo completo de la OLT).
 */
oltRoutes.get('/:id/summary', requireRole(...STAFF_READ), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  let unconfigured = 0;
  try {
    const outputs = await runTelnetCommands(telnetTargetFor(device), listUnconfiguredOntsCommands());
    unconfigured = parseUnconfiguredOnts(outputs.join('\n')).length;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[olt/summary] No se pudo consultar ONUs sin autorizar:', e);
  }

  const { data: onts } = await supabaseAdmin
    .from('olt_onts')
    .select('status, rx_power')
    .eq('olt_device_id', device.id);

  const rows = onts ?? [];
  const online = rows.filter((r) => r.status === 'online').length;
  const offline = rows.filter((r) => r.status === 'offline').length;
  const lowSignal = rows.filter((r) => r.rx_power != null && r.rx_power < LOW_SIGNAL_THRESHOLD_DBM).length;

  return c.json({
    unconfigured,
    online,
    offline,
    lowSignal,
    syncedTotal: rows.length,
    checkedAt: new Date().toISOString(),
  });
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

oltRoutes.post('/:id/onts/sync', requireRole(...STAFF_WRITE), async (c: Context) => {
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

oltRoutes.post('/:id/onts', requireRole(...STAFF_WRITE), async (c) => {
  const device = await getDeviceOrNull(c.req.param('id'));
  if (!device) return c.json({ error: 'OLT no encontrada' }, 404);

  const body = await c.req.json();
  const shelf = body.shelf ?? 1;
  const { slot, port, serial, onuType, description, vlan, clientId } = body;
  let onuId: number = body.onuId;

  if (onuId == null) {
    const { data: existing } = await supabaseAdmin
      .from('olt_onts')
      .select('ont_id')
      .eq('olt_device_id', device.id)
      .eq('slot', slot)
      .eq('port', port);
    const used = new Set((existing ?? []).map((r: { ont_id: number }) => r.ont_id));
    onuId = 0;
    while (used.has(onuId)) onuId += 1;
  }

  try {
    await runTelnetCommands(
      telnetTargetFor(device),
      registerOntCommands({ ref: { shelf, slot, port }, onuId, serial, onuType, vlan, description }),
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

oltRoutes.post('/:id/onts/:ontDbId/activate', requireRole(...STAFF_WRITE), (c) => toggleActivation(c, true));
oltRoutes.post('/:id/onts/:ontDbId/deactivate', requireRole(...STAFF_WRITE), (c) => toggleActivation(c, false));

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

oltRoutes.delete('/:id/onts/:ontDbId', requireRole(...STAFF_WRITE), async (c) => {
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
    const info = parseOpticalInfo(outputs.join('\n'));
    await supabaseAdmin.from('olt_onts').update({ rx_power: info.rxPower, tx_power: info.txPower }).eq('id', ont.id);
    return c.json(info);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al leer la senal optica' }, 502);
  }
});
