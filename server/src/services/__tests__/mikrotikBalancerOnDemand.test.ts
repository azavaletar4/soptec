import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureFreshBalancerData,
  runScheduledBalancerCycle,
  resetBalancerOnDemandStateForTests,
} from '../mikrotikBalancerOnDemand';
import type { BalancerDbClient, BalancerDeviceRow } from '../mikrotikBalancerDiscoveryService';
import type { MacvlanRaw, PppoeClientRaw } from '../../mikrotik/balancerDiscovery';

// Fase 174c (18/11/2026) -- alternativa C del diagnostico de Log Ingestion
// de Supabase: el ciclo esencial (conexiones+alertas) pasa de 60s a 5 min
// de fondo, y las muestras se refrescan bajo demanda cuando se abre la
// vista. Estas pruebas cubren la capa NUEVA (mikrotikBalancerOnDemand.ts):
// concurrencia, frescura, fallos de red y que caida/recuperacion sigan
// funcionando a traves de ella -- nunca repiten las pruebas ya existentes
// de discoverAndSyncBalancerConnections (mikrotikBalancerDiscoveryBatch.test.ts)
// ni las de la decision pura de alertas (mikrotikBalancerAlerts.test.ts).
// Nunca toca MikroTik, Supabase ni equipos reales.

type FakeOp = 'select' | 'upsert' | 'insert' | 'update';
interface FakeCall { table: string; op: FakeOp; payload?: unknown }
interface FakeResponse { data: unknown; error: { message: string } | null }

function createFakeBalancerDb(responses: Partial<Record<string, Partial<Record<FakeOp, FakeResponse>>>> = {}) {
  const calls: FakeCall[] = [];
  function from(table: string) {
    let op: FakeOp = 'select';
    const builder: PromiseLike<FakeResponse> & Record<string, unknown> = {
      select() { op = 'select'; return builder; },
      upsert(p: unknown) { op = 'upsert'; calls.push({ table, op, payload: p }); return builder; },
      insert(p: unknown) { op = 'insert'; calls.push({ table, op, payload: p }); return builder; },
      update(p: unknown) { op = 'update'; calls.push({ table, op, payload: p }); return builder; },
      eq() { return builder; },
      is() { return builder; },
      in() { return builder; },
      order() { return builder; },
      then(resolve: (v: FakeResponse) => unknown, reject?: (e: unknown) => unknown) {
        if (op === 'select') calls.push({ table, op });
        const programmed = responses[table]?.[op];
        const result: FakeResponse = programmed ?? (op === 'select' ? { data: [], error: null } : { data: null, error: null });
        try { return Promise.resolve(resolve(result)); } catch (e) { if (reject) return Promise.resolve(reject(e)); throw e; }
      },
    } as unknown as PromiseLike<FakeResponse> & Record<string, unknown>;
    return builder;
  }
  const db: BalancerDbClient = { from: from as unknown as BalancerDbClient['from'] };
  return { db, calls };
}

const DEVICE: BalancerDeviceRow = {
  id: 'device-ondemand-1',
  name: 'Balanceador-OnDemand-Test',
  host: '203.0.113.20',
  port: 443,
  use_tls: true,
  username: 'fake-user',
  password: 'fake-password',
};

const MACVLAN: MacvlanRaw = { name: 'MAC-PPPoE_900', interface: 'sfp-sfpplus9', disabled: 'false', running: 'true' };

function makeFetch(opts: { running: boolean; calls?: { count: number }; fail?: boolean }) {
  return async <T>(_t: unknown, path: string): Promise<T> => {
    if (opts.calls) opts.calls.count += 1;
    if (opts.fail) throw new Error('simulado: router sin respuesta');
    if (path === '/interface/macvlan') return [MACVLAN] as unknown as T;
    if (path === '/interface/pppoe-client') {
      const client: PppoeClientRaw = { name: 'PPPoE-WAN900', interface: 'MAC-PPPoE_900', user: 'speedy', disabled: 'false', running: String(opts.running) };
      return [client] as unknown as T;
    }
    if (path === '/interface') return [{ name: 'PPPoE-WAN900', 'rx-byte': '0', 'tx-byte': '0' }] as unknown as T;
    throw new Error(`ruta no programada: ${path}`);
  };
}

const CONNECTION_ROWS = [{ id: 'conn-900', pppoe_interface_name: 'PPPoE-WAN900', disabled: false }];
function happyResponses() {
  return { mikrotik_balancer_connections: { select: { data: CONNECTION_ROWS, error: null } } };
}

test('caida y recuperacion siguen funcionando a traves del ciclo esencial, sin que nadie abra el panel', async (t) => {
  resetBalancerOnDemandStateForTests();
  const { db, calls } = createFakeBalancerDb(happyResponses());

  // Ciclo 1 (scheduler, "panel cerrado"): la conexion esta caida (running:false).
  await runScheduledBalancerCycle(DEVICE, db, makeFetch({ running: false }));
  const alertInserts1 = calls.filter((c) => c.table === 'mikrotik_balancer_link_alerts' && c.op === 'insert');
  assert.equal(alertInserts1.length, 1, 'una conexion habilitada pero caida debe disparar una alerta nueva');
  assert.equal((alertInserts1[0].payload as any).status, 'active');

  // El "activeAlertRows" de la siguiente llamada debe reflejar la alerta que se acaba de crear.
  const activeId = 'alert-900';
  const { db: db2, calls: calls2 } = createFakeBalancerDb({
    mikrotik_balancer_connections: { select: { data: CONNECTION_ROWS, error: null } },
    mikrotik_balancer_link_alerts: { select: { data: [{ id: activeId, link_kind: 'pppoe_connection', link_name: 'PPPoE-WAN900' }], error: null } },
  });

  // Ciclo 2 (scheduler, 5 min despues, "panel sigue cerrado"): se recupera.
  await runScheduledBalancerCycle(DEVICE, db2, makeFetch({ running: true }));
  const alertResolves = calls2.filter((c) => c.table === 'mikrotik_balancer_link_alerts' && c.op === 'update');
  assert.equal(alertResolves.length, 1, 'la recuperacion debe resolver la alerta activa');
  assert.equal((alertResolves[0].payload as any).status, 'resolved');
});

test('panel abierto: ensureFreshBalancerData dispara un ciclo fresco cuando no hay nada reciente', async () => {
  resetBalancerOnDemandStateForTests();
  const { db, calls } = createFakeBalancerDb(happyResponses());
  await ensureFreshBalancerData(DEVICE, db, makeFetch({ running: true }), 0);
  assert.ok(calls.some((c) => c.table === 'mikrotik_balancer_connections' && c.op === 'upsert'), 'debe haber corrido un ciclo real al abrir la vista');
});

test('ventana de frescura: una segunda solicitud bajo demanda inmediata no repite el ciclo', async () => {
  resetBalancerOnDemandStateForTests();
  const { db, calls } = createFakeBalancerDb(happyResponses());
  const fetchCalls = { count: 0 };
  await ensureFreshBalancerData(DEVICE, db, makeFetch({ running: true, calls: fetchCalls }), 9999);
  const callsAfterFirst = calls.length;
  const fetchCallsAfterFirst = fetchCalls.count;

  await ensureFreshBalancerData(DEVICE, db, makeFetch({ running: true, calls: fetchCalls }), 9999);
  assert.equal(calls.length, callsAfterFirst, 'ninguna llamada nueva a Supabase dentro de la ventana de frescura');
  assert.equal(fetchCalls.count, fetchCallsAfterFirst, 'ninguna llamada nueva al router dentro de la ventana de frescura');
});

test('concurrencia: 2 solicitudes bajo demanda simultaneas para el mismo dispositivo comparten UN solo ciclo', async () => {
  resetBalancerOnDemandStateForTests();
  const { db, calls } = createFakeBalancerDb(happyResponses());
  const fetchCalls = { count: 0 };
  const fetchFn = makeFetch({ running: true, calls: fetchCalls });

  await Promise.all([
    ensureFreshBalancerData(DEVICE, db, fetchFn, 0),
    ensureFreshBalancerData(DEVICE, db, fetchFn, 0),
  ]);

  // 3 llamadas al router (macvlan+pppoe-client+interface) por ciclo -- si
  // se hubieran disparado 2 ciclos independientes serian 6.
  assert.equal(fetchCalls.count, 3, 'las 2 solicitudes simultaneas deben compartir un unico ciclo (nunca 2 en paralelo)');
  const connectionsUpserts = calls.filter((c) => c.table === 'mikrotik_balancer_connections' && c.op === 'upsert');
  assert.equal(connectionsUpserts.length, 1, 'un solo upsert de conexiones, no uno por cada solicitud concurrente');
});

test('concurrencia: un ciclo del scheduler y uno bajo demanda al mismo tiempo tambien comparten resultado', async () => {
  resetBalancerOnDemandStateForTests();
  const { db, calls } = createFakeBalancerDb(happyResponses());
  const fetchCalls = { count: 0 };
  const fetchFn = makeFetch({ running: true, calls: fetchCalls });

  await Promise.all([
    runScheduledBalancerCycle(DEVICE, db, fetchFn),
    ensureFreshBalancerData(DEVICE, db, fetchFn, 0),
  ]);

  assert.equal(fetchCalls.count, 3, 'el ciclo del scheduler y el bajo demanda deben coalescerse en 1 solo ciclo real');
  assert.equal(calls.filter((c) => c.table === 'mikrotik_balancer_connections' && c.op === 'upsert').length, 1);
});

test('el scheduler NUNCA se salta por frescura -- corre de nuevo aunque el ultimo intento fue hace instantes', async () => {
  resetBalancerOnDemandStateForTests();
  const { db, calls } = createFakeBalancerDb(happyResponses());
  await runScheduledBalancerCycle(DEVICE, db, makeFetch({ running: true }));
  const afterFirst = calls.filter((c) => c.table === 'mikrotik_balancer_connections' && c.op === 'upsert').length;
  await runScheduledBalancerCycle(DEVICE, db, makeFetch({ running: true }));
  const afterSecond = calls.filter((c) => c.table === 'mikrotik_balancer_connections' && c.op === 'upsert').length;
  assert.equal(afterFirst, 1);
  assert.equal(afterSecond, 2, 'el ciclo esencial del scheduler debe correr de nuevo sin importar la ventana de frescura de lo bajo demanda');
});

test('error de red: ensureFreshBalancerData nunca lanza, y no reintenta en cada solicitud dentro de la ventana de frescura', async () => {
  resetBalancerOnDemandStateForTests();
  const { db } = createFakeBalancerDb(happyResponses());
  const fetchCalls = { count: 0 };
  const failingFetch = makeFetch({ running: true, calls: fetchCalls, fail: true });

  await assert.doesNotReject(() => ensureFreshBalancerData(DEVICE, db, failingFetch, 9999));
  // 3 llamadas (macvlan+pppoe-client+interface) = UN solo intento real.
  assert.equal(fetchCalls.count, 3, 'un primer intento real al router (las 3 llamadas de un solo ciclo)');

  await assert.doesNotReject(() => ensureFreshBalancerData(DEVICE, db, failingFetch, 9999));
  assert.equal(fetchCalls.count, 3, 'el fallo tambien cuenta como "intento reciente" -- no se reintenta dentro de la ventana de frescura');
});

test('error de red en el ciclo del scheduler: se registra pero no interrumpe el resto (el llamador decide)', async () => {
  resetBalancerOnDemandStateForTests();
  const { db } = createFakeBalancerDb(happyResponses());
  // discoverAndSyncBalancerConnections ya maneja un fallo del router
  // devolviendo sin tocar la BD (ver mikrotikBalancerDiscoveryBatch.test.ts,
  // "si el router no responde..."); aqui solo se confirma que
  // runScheduledBalancerCycle no agrega una excepcion propia encima de eso.
  await assert.doesNotReject(() => runScheduledBalancerCycle(DEVICE, db, makeFetch({ running: true, fail: true })));
});
