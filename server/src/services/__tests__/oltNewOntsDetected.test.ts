import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { startFakeOltCli } from './fakeOltCli';
import { TEST_USERNAME, TEST_PASSWORD } from '../../telnet/__tests__/fakeOltServer';
import { requireAuth } from '../../middleware/auth';
import { beginOltReadOperation } from '../oltReadOperation';

/**
 * Deteccion automatica de ONT autorizadas externamente (2026-11-04) --
 * integra `runOltFullSync` (sync periodico real) + la ruta real
 * `GET /:id/onts/new-detected`, contra una OLT simulada (fakeOltCli, Telnet
 * real) y un Supabase simulado via fetch (mismo patron que
 * oltTelemetryIntegration.test.ts). Caso de referencia del propietario:
 * Gustavo Reyes Sandoval (ZTEGD4FE1386, 1/2/8:26), ya autorizado en la OLT
 * y NUNCA importado a `olt_onts`.
 */
test('deteccion automatica: nueva ONT real, duplicados, conflicto, vinculos existentes, sync fallida y permisos', { timeout: 30000 }, async () => {
  let failState = false;
  const linked = { id: 'row-mayco', olt_device_id: 'olt-1', serial: 'ZTEGDC5C139E', frame: 1, slot: 2, port: 4, ont_id: 19, status: 'online', admin_state: 'enable', rx_power: -19, tx_power: 2, last_synced_at: '2026-10-01T00:00:00Z', client_id: 'mayco', contract_id: 'contract-mayco', description: 'Mayco' };
  const conflict = { id: 'row-clara', olt_device_id: 'olt-1', serial: 'SERIALVIEJOCLARA', frame: 1, slot: 2, port: 9, ont_id: 4, status: 'online', admin_state: 'enable', rx_power: -20, tx_power: 2, last_synced_at: '2026-10-01T00:00:00Z', client_id: 'clara', contract_id: 'contract-clara', description: 'Clara' };
  const rows = [structuredClone(linked), structuredClone(conflict)];
  let cache: any = null;

  // Entidades reales en la OLT: Mayco (ya vinculada, igual), Clara (OLT ahora
  // reporta OTRO serial en su posicion -- conflicto, nunca "nueva") y
  // Gustavo (serial nuevo en una posicion sin ninguna fila -- caso real).
  const stateEntries: { key: string; adminState: string; runState: string }[] = [
    { key: '1/2/4:19', adminState: 'enable', runState: 'working' },
    { key: '1/2/9:4', adminState: 'enable', runState: 'working' },
    { key: '1/2/8:26', adminState: 'enable', runState: 'working' },
  ];
  function stateText() {
    const body = stateEntries.map((e) => `${e.key}    ${e.adminState}       enable      ${e.runState}      1(GPON)`).join('\r\n');
    return `OnuIndex AdminState OMCC RunState Type\r\n${body}\r\nONU Number: ${stateEntries.length}/${stateEntries.length}`;
  }

  const cli = await startFakeOltCli({
    initialEntries: {
      '1/2/4:19': { onuType: 'GPT', serial: 'ZTEGDC5C139E', description: 'Mayco' },
      '1/2/9:4': { onuType: 'GPT', serial: 'SERIALNUEVOCLARA', description: 'Clara (reemplazo real)' },
      '1/2/8:26': { onuType: 'GPT', serial: 'ZTEGD4FE1386', description: 'Gustavo Reyes Sandoval' },
    },
    intercept: (c) => {
      if (c === 'show gpon onu state') return failState ? { action: 'reject', message: '%Error 20202: Invalid input detected' } : { action: 'customResponse', text: stateText() };
      if (['show gpon onu uncfg', 'show system-group', 'show card-temperature', 'show processor'].includes(c)) return { action: 'customResponse', text: '' };
      return undefined;
    },
  });

  const device = { id: 'olt-1', name: 'OLT Test', host: '127.0.0.1', telnet_port: cli.port, username: TEST_USERNAME, password: TEST_PASSWORD, brand: 'zte' };
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: process.env.VITE_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-only';

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, 'http://127.0.0.1:1', 'red externa prohibida');
    const table = url.pathname.split('/').at(-1)!;
    const filters = url.searchParams;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...(Array.isArray(body) ? { 'Content-Range': `0-${Math.max(0, body.length - 1)}/${body.length}` } : {}) } });
    if (request.method === 'GET') {
      if (table === 'olt_devices') return json(device);
      if (table === 'olt_onts') {
        const serialsFilter = filters.get('serial');
        let found = rows.filter((r) => [...filters].every(([k, v]) => !v.startsWith('eq.') || String((r as any)[k]) === v.slice(3)));
        if (serialsFilter?.startsWith('in.')) {
          const wanted = new Set(serialsFilter.slice(4, -1).split(','));
          found = rows.filter((r) => wanted.has(r.serial));
        }
        return json(found);
      }
      if (table === 'olt_sync_cache') return json(cache);
      return json(null);
    }
    // POST = upsert: PostgREST solo pisa las columnas presentes en el body
    // (nunca las omitidas) -- se modela asi a proposito, es el contrato real
    // que server/src/services/oltSyncService.ts necesita para no borrar un
    // resultado valido anterior con uno vacio.
    const body: any = await request.json();
    if (table === 'olt_sync_cache') {
      cache = { ...(cache ?? {}), ...body };
      return json(cache);
    }
    return json(body);
  }) as typeof fetch;

  try {
    const { runOltFullSync } = await import('../oltSyncService');
    const { oltRoutes } = await import('../../routes/olt');
    const app = new Hono();
    app.use('*', async (c, next) => { (c as any).set('user', (c.req.header('x-test-role') ? { id: 'tester', role: c.req.header('x-test-role') } : null)); await next(); });
    for (const route of oltRoutes.routes) if (route.handler !== requireAuth) app.on(route.method, '/devices' + route.path, route.handler);
    const getNewOnts = (role: string | null) => app.request('/devices/olt-1/onts/new-detected', role ? { headers: { 'x-test-role': role } } : {});

    // 1) Ciclo exitoso: Gustavo (nueva) aparece; Mayco (vinculada, igual) y
    //    Clara (conflicto de serial) NUNCA aparecen como "nueva".
    const result1 = await runOltFullSync(device);
    assert(result1?.scanComplete);
    assert.equal(result1!.newOntsDetected, 1);
    assert.deepEqual(rows[0], linked); // Mayco intacta
    assert.deepEqual(rows[1], conflict); // Clara intacta (conflicto no se auto-resuelve)
    assert(cache, 'debio escribirse la cache');
    const detected1 = cache!.new_onts_detected as any[];
    assert.equal(detected1.length, 1);
    assert.equal(detected1[0].serial, 'ZTEGD4FE1386');
    assert.equal(detected1[0].frame, 1); assert.equal(detected1[0].slot, 2); assert.equal(detected1[0].port, 8); assert.equal(detected1[0].ontId, 26);
    assert.equal(detected1[0].status, 'online');
    const checkedAt1 = cache!.new_onts_checked_at;
    assert(checkedAt1);

    const resGet1 = await getNewOnts('ADMIN');
    assert.equal(resGet1.status, 200);
    const body1 = await resGet1.json() as any;
    assert.equal(body1.items.length, 1);
    assert.equal(body1.items[0].serial, 'ZTEGD4FE1386');
    assert.equal(body1.checkedAt, checkedAt1);

    // 2) DUPLICADOS: correr otra vez con los mismos datos -- sigue habiendo
    //    exactamente 1 (nunca 2, nunca se acumula entre corridas). Como esta
    //    corrida TAMBIEN tiene exito, su propio checked_at SI avanza (es
    //    correcto -- cada corrida exitosa reconfirma la deteccion).
    const result2 = await runOltFullSync(device);
    assert.equal(result2!.newOntsDetected, 1);
    assert.equal((cache!.new_onts_detected as any[]).length, 1);
    const checkedAt2 = cache!.new_onts_checked_at as string;
    assert.notEqual(checkedAt2, checkedAt1, 'una corrida exitosa SI reconfirma la fecha de deteccion');

    // 3) SINCRONIZACION FALLIDA: la OLT rechaza el escaneo de estado esta
    //    vez -- la deteccion anterior (Gustavo, de la corrida #2) NO se
    //    reemplaza por una lista vacia; el checked_at de la deteccion se
    //    queda exactamente en el de la ultima corrida que SI tuvo exito.
    failState = true;
    const result3 = await runOltFullSync(device);
    assert.equal(result3!.scanComplete, false);
    assert.equal((cache!.new_onts_detected as any[]).length, 1, 'un fallo de sync nunca borra una deteccion valida anterior');
    assert.equal((cache!.new_onts_detected as any[])[0].serial, 'ZTEGD4FE1386');
    assert.equal(cache!.new_onts_checked_at, checkedAt2, 'new_onts_checked_at no avanza si este ciclo no detecto nada de verdad');
    const resGetStale = await getNewOnts('ADMIN');
    const bodyStale = await resGetStale.json() as any;
    assert.equal(bodyStale.items.length, 1); // sigue sirviendo el ultimo resultado valido
    assert.equal(bodyStale.checkedAt, checkedAt2); // pero con la fecha vieja, para que el panel avise que esta desactualizado
    failState = false;

    // 4) PRESERVACION DE VINCULOS EXISTENTES: tras los 3 ciclos (incluido uno
    //    fallido), ninguna fila vinculada se tocó.
    assert.deepEqual(rows[0], linked);
    assert.deepEqual(rows[1], conflict);

    // 5) CONCURRENCIA: un sync ya en curso (lock tomado manualmente, igual
    //    que el resto de las pruebas de este servicio) hace que una segunda
    //    corrida no haga nada y no reescriba la cache.
    const busy = beginOltReadOperation(device.id);
    assert(busy);
    const cacheBeforeConcurrent = structuredClone(cache);
    assert.equal(await runOltFullSync(device), null);
    assert.deepEqual(cache, cacheBeforeConcurrent);
    busy();

    // 6) PERMISOS: TECNICO_RED (lectura) SI puede ver la lista; sin sesion
    //    (ni rol) se bloquea -- import-existing/link siguen siendo rutas
    //    separadas y de escritura, esta ruta nunca las reemplaza.
    const resTecnico = await getNewOnts('TECNICO_RED');
    assert.equal(resTecnico.status, 200);
    const resSinSesion = await getNewOnts(null);
    assert.equal(resSinSesion.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv.url === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = originalEnv.url;
    if (originalEnv.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.key;
    await cli.close();
  }
});
