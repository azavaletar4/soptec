import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverAndSyncBalancerConnections, type BalancerDbClient, type BalancerDeviceRow } from '../mikrotikBalancerDiscoveryService';
import type { MacvlanRaw, PppoeClientRaw } from '../../mikrotik/balancerDiscovery';

// Corrige el patron N+1 diagnosticado 18/11/2026 (exceso de Log Ingestion
// de Supabase, ver docs/SUPABASE-LOG-INGESTION-*): antes, cada conexion WAN
// del balanceador generaba su propia llamada HTTP a Supabase (upsert,
// insert, upsert) en vez de una sola llamada por lote para todas. Estas
// pruebas usan un cliente de Supabase y un fetch a MikroTik FALSOS (nunca
// datos/equipos reales) para contar exactamente cuantas llamadas hace un
// solo ciclo, antes y despues de la correccion.

type FakeOp = 'select' | 'upsert' | 'insert' | 'update';
interface FakeCall {
  table: string;
  op: FakeOp;
  payload?: unknown;
  conflict?: string;
}
interface FakeResponse {
  data: unknown;
  error: { message: string } | null;
}

/**
 * Cliente de Supabase falso, en memoria: cada `await db.from(t)....` cuenta
 * como UNA llamada real (asi se mide lo mismo que un request a PostgREST).
 * `responses` programa que debe devolver cada tabla/operacion; por defecto
 * select->[] y escritura->sin error, para no tener que programar cada caso.
 */
function createFakeBalancerDb(responses: Partial<Record<string, Partial<Record<FakeOp, FakeResponse>>>> = {}) {
  const calls: FakeCall[] = [];

  function from(table: string) {
    let op: FakeOp = 'select';
    let payload: unknown;
    let conflict: string | undefined;

    const builder: PromiseLike<FakeResponse> & Record<string, unknown> = {
      select() {
        op = 'select';
        return builder;
      },
      upsert(p: unknown, opts?: { onConflict?: string }) {
        op = 'upsert';
        payload = p;
        conflict = opts?.onConflict;
        calls.push({ table, op, payload, conflict });
        return builder;
      },
      insert(p: unknown) {
        op = 'insert';
        payload = p;
        calls.push({ table, op, payload });
        return builder;
      },
      update(p: unknown) {
        op = 'update';
        payload = p;
        calls.push({ table, op, payload });
        return builder;
      },
      eq() {
        return builder;
      },
      is() {
        return builder;
      },
      in() {
        return builder;
      },
      order() {
        return builder;
      },
      then(resolve: (v: FakeResponse) => unknown, reject?: (e: unknown) => unknown) {
        if (op === 'select') calls.push({ table, op });
        const programmed = responses[table]?.[op];
        const result: FakeResponse = programmed ?? (op === 'select' ? { data: [], error: null } : { data: null, error: null });
        try {
          return Promise.resolve(resolve(result));
        } catch (e) {
          if (reject) return Promise.resolve(reject(e));
          throw e;
        }
      },
    } as unknown as PromiseLike<FakeResponse> & Record<string, unknown>;
    return builder;
  }

  const db: BalancerDbClient = { from: from as unknown as BalancerDbClient['from'] };
  return { db, calls };
}

const DEVICE: BalancerDeviceRow = {
  id: 'device-1',
  name: 'Balanceador-Test',
  host: '203.0.113.10',
  port: 443,
  use_tls: true,
  username: 'fake-user',
  password: 'fake-password',
};

// Mismos datos (anonimizados) que ../../mikrotik/__tests__ usa para probar
// la logica pura -- 5 conexiones, 4 habilitadas+corriendo, 1 deshabilitada.
const MACVLANS: MacvlanRaw[] = [
  { name: 'MAC-PPPoE_031', interface: 'sfp-sfpplus2', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_037', interface: 'sfp-sfpplus3', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_043', interface: 'sfp-sfpplus6', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_049', interface: 'sfp-sfpplus7', disabled: 'false', running: 'true' },
  { name: 'MAC-PPPoE_055', interface: 'sfp-sfpplus1', disabled: 'true', running: 'false' },
];
const PPPOE_CLIENTS: PppoeClientRaw[] = [
  { name: 'PPPoE-WAN031', interface: 'MAC-PPPoE_031', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN037', interface: 'MAC-PPPoE_037', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN043', interface: 'MAC-PPPoE_043', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN049', interface: 'MAC-PPPoE_049', user: 'speedy', disabled: 'false', running: 'true' },
  { name: 'PPPoE-WAN055', interface: 'MAC-PPPoE_055', user: 'speedy', disabled: 'true', running: 'false' },
];
// /interface incluye, ademas del puerto fisico, las propias interfaces
// PPPoE -- las 4 habilitadas traen contador real; la deshabilitada (055) a
// proposito no se muestrea (requisito 8), asi que no necesita contador.
const INTERFACE_COUNTERS = [
  { name: 'PPPoE-WAN031', 'rx-byte': '1000', 'tx-byte': '500' },
  { name: 'PPPoE-WAN037', 'rx-byte': '2000', 'tx-byte': '900' },
  { name: 'PPPoE-WAN043', 'rx-byte': '3000', 'tx-byte': '1200' },
  { name: 'PPPoE-WAN049', 'rx-byte': '4000', 'tx-byte': '1600' },
];

function fakeFetch(now: Date = new Date('2026-11-18T12:00:00.000Z')) {
  return async <T>(_target: unknown, path: string): Promise<T> => {
    if (path === '/interface/macvlan') return MACVLANS as unknown as T;
    if (path === '/interface/pppoe-client') return PPPOE_CLIENTS as unknown as T;
    if (path === '/interface') return INTERFACE_COUNTERS as unknown as T;
    throw new Error(`ruta MikroTik no programada en la prueba: ${path}`);
  };
}

// connectionRows que la BD "ya tiene" tras el upsert -- un fake en memoria
// no aplica el upsert de verdad, asi que esto se programa a mano para que
// coincida con lo que un upsert real habria dejado.
const CONNECTION_ROWS_AFTER_UPSERT = [
  { id: 'conn-031', pppoe_interface_name: 'PPPoE-WAN031', disabled: false },
  { id: 'conn-037', pppoe_interface_name: 'PPPoE-WAN037', disabled: false },
  { id: 'conn-043', pppoe_interface_name: 'PPPoE-WAN043', disabled: false },
  { id: 'conn-049', pppoe_interface_name: 'PPPoE-WAN049', disabled: false },
  { id: 'conn-055', pppoe_interface_name: 'PPPoE-WAN055', disabled: true },
];

function happyResponses(): Partial<Record<string, Partial<Record<FakeOp, FakeResponse>>>> {
  return {
    mikrotik_balancer_connections: {
      select: { data: CONNECTION_ROWS_AFTER_UPSERT, error: null },
    },
  };
}

test('un solo ciclo hace UN upsert por lote a mikrotik_balancer_connections, no uno por conexion', async () => {
  const { db, calls } = createFakeBalancerDb(happyResponses());
  await discoverAndSyncBalancerConnections(DEVICE, new Date('2026-11-18T12:00:00.000Z'), db, fakeFetch());

  const connectionsUpserts = calls.filter((c) => c.table === 'mikrotik_balancer_connections' && c.op === 'upsert');
  assert.equal(connectionsUpserts.length, 1, 'debe ser una sola llamada de upsert, nunca una por conexion');
  const payload = connectionsUpserts[0].payload as Record<string, unknown>[];
  assert.equal(payload.length, 5, 'el lote debe incluir las 5 conexiones resueltas en una sola llamada');
  assert.equal(connectionsUpserts[0].conflict, 'device_id,pppoe_interface_name');

  // Mismas columnas/valores que la version anterior (parida de comportamiento).
  const wan031 = payload.find((p) => p.pppoe_interface_name === 'PPPoE-WAN031')!;
  assert.deepEqual(wan031, {
    device_id: 'device-1',
    pppoe_interface_name: 'PPPoE-WAN031',
    macvlan_interface_name: 'MAC-PPPoE_031',
    physical_interface_name: 'sfp-sfpplus2',
    pppoe_user: 'speedy',
    disabled: false,
    running: true,
    last_seen_at: '2026-11-18T12:00:00.000Z',
    removed_at: null,
  });
});

test('las muestras de trafico y los contadores tambien se mandan en un solo lote cada uno, no por conexion', async () => {
  const { db, calls } = createFakeBalancerDb(happyResponses());
  await discoverAndSyncBalancerConnections(DEVICE, new Date('2026-11-18T12:00:00.000Z'), db, fakeFetch());

  const sampleInserts = calls.filter((c) => c.table === 'mikrotik_balancer_connection_samples' && c.op === 'insert');
  assert.equal(sampleInserts.length, 1, 'un solo insert por lote de muestras');
  assert.equal((sampleInserts[0].payload as unknown[]).length, 4, '4 conexiones habilitadas con contador -- la 5ta esta deshabilitada y no se muestrea');

  const stateUpserts = calls.filter((c) => c.table === 'mikrotik_balancer_connection_counters_state' && c.op === 'upsert');
  assert.equal(stateUpserts.length, 1, 'un solo upsert por lote de contadores');
  assert.equal((stateUpserts[0].payload as unknown[]).length, 4);
  assert.equal(stateUpserts[0].conflict, 'connection_id');
});

test('solicitudes HTTP por ciclo: de 16 (version anterior, 1 por conexion) a 6 (version en lote) para estas 5 conexiones', async () => {
  const { db, calls } = createFakeBalancerDb(happyResponses());
  await discoverAndSyncBalancerConnections(DEVICE, new Date('2026-11-18T12:00:00.000Z'), db, fakeFetch());

  const hotTables = ['mikrotik_balancer_connections', 'mikrotik_balancer_connection_samples', 'mikrotik_balancer_connection_counters_state'];
  const newRequestCount = calls.filter((c) => hotTables.includes(c.table)).length;
  assert.equal(newRequestCount, 6, 'select existentes(1) + upsert lote(1) + select activas(1) + select contadores(1) + insert muestras lote(1) + upsert contadores lote(1)');

  // Equivalente de la version anterior para el MISMO ciclo (1 por fila):
  // select existentes(1) + upsert x5 conexiones(5) + select activas(1) +
  // select contadores(1) + insert x4 muestras(4) + upsert x4 contadores(4) = 16.
  const resolvedCount = 5;
  const activeSampledCount = 4;
  const oldRequestCount = 1 + resolvedCount + 1 + 1 + activeSampledCount + activeSampledCount;
  assert.equal(oldRequestCount, 16);
  assert.ok(newRequestCount < oldRequestCount, 'el lote debe reducir las solicitudes frente a 1-por-fila');
});

test('el descubrimiento de alertas sigue evaluandose igual (misma cantidad de llamadas que antes)', async () => {
  const { db, calls } = createFakeBalancerDb(happyResponses());
  await discoverAndSyncBalancerConnections(DEVICE, new Date('2026-11-18T12:00:00.000Z'), db, fakeFetch());

  const alertSelects = calls.filter((c) => c.table === 'mikrotik_balancer_link_alerts' && c.op === 'select');
  assert.equal(alertSelects.length, 1, 'la tabla de alertas no es parte de esta correccion -- sigue igual');
  // Sin transiciones de estado (mismo running/disabled de siempre, sin alerta
  // previa activa) no deberia dispararse ningun fire/resolve nuevo.
  const alertWrites = calls.filter((c) => c.table === 'mikrotik_balancer_link_alerts' && (c.op === 'insert' || c.op === 'update'));
  assert.equal(alertWrites.length, 0);
});

test('conexiones con el mismo pppoe_interface_name repetido se deduplican antes del lote -- nunca se manda la clave de conflicto 2 veces en el mismo upsert', async () => {
  const dupPppoeClients: PppoeClientRaw[] = [
    { name: 'PPPoE-WAN031', interface: 'MAC-PPPoE_031', user: 'speedy', disabled: 'false', running: 'true' },
    // Mismo nombre, estado distinto (ej. un glitch del router en el mismo sondeo) -- debe prevalecer esta ULTIMA aparicion.
    { name: 'PPPoE-WAN031', interface: 'MAC-PPPoE_031', user: 'speedy', disabled: 'true', running: 'false' },
  ];
  const dupFetch = async <T>(_t: unknown, path: string): Promise<T> => {
    if (path === '/interface/macvlan') return [MACVLANS[0]] as unknown as T;
    if (path === '/interface/pppoe-client') return dupPppoeClients as unknown as T;
    if (path === '/interface') return [] as unknown as T;
    throw new Error(`ruta no programada: ${path}`);
  };

  const { db, calls } = createFakeBalancerDb({
    mikrotik_balancer_connections: { select: { data: [], error: null } },
  });
  await discoverAndSyncBalancerConnections(DEVICE, new Date('2026-11-18T12:00:00.000Z'), db, dupFetch);

  const connectionsUpserts = calls.filter((c) => c.table === 'mikrotik_balancer_connections' && c.op === 'upsert');
  assert.equal(connectionsUpserts.length, 1);
  const payload = connectionsUpserts[0].payload as Record<string, unknown>[];
  assert.equal(payload.length, 1, 'las 2 filas duplicadas deben colapsar en 1 sola fila en el lote');
  assert.equal(payload[0].disabled, true, 'debe prevalecer la ULTIMA aparicion, igual que el loop anterior ejecutando sus upserts en orden');
});

test('fallo parcial: si el insert de muestras falla, el upsert de contadores y la evaluacion de alertas se intentan igual, y el error se reporta (nunca se pierde en silencio)', async () => {
  const { db, calls } = createFakeBalancerDb({
    mikrotik_balancer_connections: { select: { data: CONNECTION_ROWS_AFTER_UPSERT, error: null } },
    mikrotik_balancer_connection_samples: { insert: { data: null, error: { message: 'simulado: fallo de red en el insert de muestras' } } },
  });

  await assert.rejects(
    () => discoverAndSyncBalancerConnections(DEVICE, new Date('2026-11-18T12:00:00.000Z'), db, fakeFetch()),
    /simulado: fallo de red en el insert de muestras/,
  );

  // El upsert de contadores es independiente del insert de muestras -- debe haberse intentado igual.
  const stateUpserts = calls.filter((c) => c.table === 'mikrotik_balancer_connection_counters_state' && c.op === 'upsert');
  assert.equal(stateUpserts.length, 1, 'el upsert de contadores no debe saltarse por el fallo del insert de muestras');

  // La evaluacion de alertas tambien debe haberse intentado (mismo orden que la version anterior).
  const alertSelects = calls.filter((c) => c.table === 'mikrotik_balancer_link_alerts' && c.op === 'select');
  assert.equal(alertSelects.length, 1, 'las alertas deben evaluarse igual, aunque el insert de muestras haya fallado');

  // Sin reintentos agresivos: el insert fallido se intento una sola vez, no mas.
  const sampleInserts = calls.filter((c) => c.table === 'mikrotik_balancer_connection_samples' && c.op === 'insert');
  assert.equal(sampleInserts.length, 1, 'un fallo no debe disparar un reintento automatico dentro del mismo ciclo');
});

test('si el router no responde, no se toca la BD en absoluto (comportamiento sin cambios)', async () => {
  const { db, calls } = createFakeBalancerDb();
  const failingFetch = async () => {
    throw new Error('simulado: router no responde');
  };
  await discoverAndSyncBalancerConnections(DEVICE, new Date(), db, failingFetch as never);
  assert.equal(calls.length, 0, 'ninguna llamada a Supabase cuando el sondeo al router falla');
});
