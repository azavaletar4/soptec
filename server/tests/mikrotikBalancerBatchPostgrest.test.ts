import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
// PostgrestClient (no createClient de @supabase/supabase-js): supabase-js
// SIEMPRE antepone "/rest/v1" a la URL (asi lo expone Kong en el Supabase
// alojado real) -- un PostgREST puro y aislado como este no tiene ese
// prefijo, sirve las tablas en la raiz. PostgrestClient es la MISMA
// libreria que supabase-js usa por debajo para `.from()`, asi que el
// comportamiento HTTP que se prueba aqui es idéntico al de producción.
import { PostgrestClient } from '@supabase/postgrest-js';
import {
  discoverAndSyncBalancerConnections,
  type BalancerDbClient,
  type BalancerDeviceRow,
} from '../src/services/mikrotikBalancerDiscoveryService';
import type { MacvlanRaw, PppoeClientRaw } from '../src/mikrotik/balancerDiscovery';

// Validacion 18/11/2026 de la correccion del exceso de Log Ingestion de
// Supabase (ver docs/SUPABASE-LOG-INGESTION-* y el commit 414778e de la
// rama fix/mikrotik-balancer-batch-logs-20261118): las pruebas con un
// cliente de Supabase FALSO (mikrotikBalancerDiscoveryBatch.test.ts) ya
// validan la logica de control (lotes/independencia de errores/sin
// reintentos). Esta prueba usa Postgres 17 + PostgREST REALES en Docker,
// 100% aislados (red propia, sin tocar produccion ni datos/equipos
// reales) para confirmar lo que un cliente falso NO puede probar:
//  - que PostgREST de verdad acepta el upsert en lote con `onConflict`
//    y que un segundo ciclo actualiza en vez de duplicar filas,
//  - que Postgres de verdad rechaza un upsert en lote con la misma
//    clave de conflicto repetida (justificando por que el dedupe hace
//    falta) y que, con el dedupe de la correccion, no pasa,
//  - que un error real de Postgres (violacion de FK) llega como un
//    mensaje breve y sin datos sensibles,
//  - que un lote de mas de 500 filas se divide en varios chunks reales y
//    los datos llegan completos.
//
// Imagenes fijadas por digest para que la prueba sea reproducible.
const POSTGRES_IMAGE = 'postgres:17@sha256:a63c1ea3f6a3a5a1621f97d2aba3b30faecfab4224c1b0000cc85ced57bb1939';
const POSTGREST_IMAGE = 'postgrest/postgrest@sha256:5ce030c153500fe90ba157da4da8ba99ab51d3bc7b95e071bd0b544b67a632f7';
const JWT_SECRET = 'solo-para-prueba-aislada-nunca-produccion-32-caracteres-min';
const DB_ROLE = 'postgrest_test'; // rol de prueba con BYPASSRLS -- nunca el service_role real

const sh = (cmd: string, args: string[], input?: string) =>
  execFileSync(cmd, args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

function waitFor(checkOk: () => boolean, label: string, attempts = 100, delayMs = 150): void {
  for (let i = 0; i < attempts; i++) {
    if (checkOk()) return;
    spawnSyncSleep(delayMs);
  }
  throw new Error(`timeout esperando: ${label}`);
}
function spawnSyncSleep(ms: number) {
  // sleep sincrono -- aceptable aqui, solo se usa en el arranque de los
  // contenedores de prueba (nunca en el codigo de produccion).
  spawnSync(process.platform === 'win32' ? 'ping' : 'sleep', process.platform === 'win32' ? ['-n', '1', '-w', String(ms), '127.0.0.1'] : [String(ms / 1000)]);
}

const SCHEMA_SQL = `
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create table public.mikrotik_devices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  host       text not null,
  port       int not null default 443,
  use_tls    boolean not null default true,
  username   text not null,
  password   text not null,
  device_role text not null default 'pppoe_admin' check (device_role in ('pppoe_admin','borde_dedicado','borde_balanceador')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_mikrotik_devices_updated_at before update on public.mikrotik_devices for each row execute procedure public.set_updated_at();
alter table public.mikrotik_devices enable row level security;

create table public.mikrotik_balancer_connections (
  id                       uuid primary key default gen_random_uuid(),
  device_id                uuid not null references public.mikrotik_devices(id) on delete cascade,
  pppoe_interface_name     text not null,
  macvlan_interface_name   text,
  physical_interface_name  text,
  pppoe_user               text,
  disabled                 boolean not null default false,
  running                  boolean not null default false,
  first_seen_at            timestamptz not null default now(),
  last_seen_at             timestamptz not null default now(),
  removed_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (device_id, pppoe_interface_name)
);
create trigger trg_mikrotik_balancer_connections_updated_at before update on public.mikrotik_balancer_connections for each row execute procedure public.set_updated_at();
create index idx_mikrotik_balancer_connections_device on public.mikrotik_balancer_connections (device_id) where removed_at is null;

create table public.mikrotik_balancer_connection_samples (
  id               uuid primary key default gen_random_uuid(),
  connection_id    uuid not null references public.mikrotik_balancer_connections(id) on delete cascade,
  sampled_at       timestamptz not null default now(),
  interval_seconds int not null,
  rx_bytes         bigint not null default 0,
  tx_bytes         bigint not null default 0,
  rx_bps           bigint not null default 0,
  tx_bps           bigint not null default 0,
  online           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index idx_mikrotik_balancer_connection_samples_time on public.mikrotik_balancer_connection_samples (connection_id, sampled_at desc);

create table public.mikrotik_balancer_connection_counters_state (
  connection_id  uuid primary key references public.mikrotik_balancer_connections(id) on delete cascade,
  last_rx_bytes  bigint not null default 0,
  last_tx_bytes  bigint not null default 0,
  updated_at     timestamptz not null default now()
);
create trigger trg_mikrotik_balancer_connection_counters_state_updated_at before update on public.mikrotik_balancer_connection_counters_state for each row execute procedure public.set_updated_at();

create table public.mikrotik_balancer_link_alerts (
  id                       uuid primary key default gen_random_uuid(),
  device_id                uuid not null references public.mikrotik_devices(id) on delete cascade,
  link_kind                text not null check (link_kind in ('pppoe_connection', 'physical_port')),
  link_name                text not null,
  connection_id            uuid references public.mikrotik_balancer_connections(id) on delete set null,
  physical_interface_name  text,
  status                   text not null check (status in ('active', 'resolved')) default 'active',
  started_at               timestamptz not null default now(),
  resolved_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index idx_mikrotik_balancer_link_alerts_active on public.mikrotik_balancer_link_alerts (device_id, link_kind, link_name) where status = 'active';

alter table public.mikrotik_balancer_connections enable row level security;
alter table public.mikrotik_balancer_connection_samples enable row level security;
alter table public.mikrotik_balancer_connection_counters_state enable row level security;
alter table public.mikrotik_balancer_link_alerts enable row level security;

-- Rol de prueba: BYPASSRLS, igual mecanismo que service_role en produccion
-- (service_role real NUNCA se usa ni se referencia aqui), para que
-- PostgREST pueda leer/escribir sin politicas (como ya hace el backend real).
create role ${DB_ROLE} login password 'test-password-solo-aislado' bypassrls;
grant usage on schema public to ${DB_ROLE};
grant all on all tables in schema public to ${DB_ROLE};
`;

async function waitForHttp(url: string, attempts = 100, delayMs = 150): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* todavia no esta arriba */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`timeout esperando PostgREST en ${url}`);
}

function createSpy(real: BalancerDbClient) {
  const calls: { table: string }[] = [];
  const from: BalancerDbClient['from'] = (table: string) => {
    calls.push({ table });
    return real.from(table);
  };
  return { db: { from } as BalancerDbClient, calls };
}

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
const INTERFACE_COUNTERS = [
  { name: 'PPPoE-WAN031', 'rx-byte': '1000', 'tx-byte': '500' },
  { name: 'PPPoE-WAN037', 'rx-byte': '2000', 'tx-byte': '900' },
  { name: 'PPPoE-WAN043', 'rx-byte': '3000', 'tx-byte': '1200' },
  { name: 'PPPoE-WAN049', 'rx-byte': '4000', 'tx-byte': '1600' },
];
function makeFetch(rxBump = 0) {
  return async <T>(_t: unknown, path: string): Promise<T> => {
    if (path === '/interface/macvlan') return MACVLANS as unknown as T;
    if (path === '/interface/pppoe-client') return PPPOE_CLIENTS as unknown as T;
    if (path === '/interface') return INTERFACE_COUNTERS.map((c) => ({ ...c, 'rx-byte': String(Number(c['rx-byte']) + rxBump) })) as unknown as T;
    throw new Error(`ruta no programada: ${path}`);
  };
}

test('PostgreSQL + PostgREST reales (aislados): validacion de la correccion de lotes del balanceador MikroTik', { timeout: 120_000 }, async (t) => {
  const suffix = `${process.pid}-${Date.now()}`;
  const network = `smartrayco-balancer-pgrest-test-${suffix}`;
  const pgName = `smartrayco-balancer-pg-${suffix}`;
  const pgrestName = `smartrayco-balancer-pgrest-${suffix}`;
  let baseUrl = '';

  try {
    sh('docker', ['network', 'create', network]);
    sh('docker', [
      'run', '--rm', '-d', '--name', pgName, '--network', network,
      '--tmpfs', '/var/lib/postgresql/data',
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
      POSTGRES_IMAGE,
    ]);
    waitFor(() => {
      try { sh('docker', ['exec', pgName, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); return true; } catch { return false; }
    }, 'Postgres aislado listo');

    sh('docker', ['exec', '-i', pgName, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], SCHEMA_SQL);

    sh('docker', [
      'run', '--rm', '-d', '--name', pgrestName, '--network', network, '-p', '0:3000',
      '-e', `PGRST_DB_URI=postgres://${DB_ROLE}:test-password-solo-aislado@${pgName}:5432/postgres`,
      '-e', 'PGRST_DB_SCHEMAS=public',
      '-e', `PGRST_DB_ANON_ROLE=${DB_ROLE}`,
      '-e', `PGRST_JWT_SECRET=${JWT_SECRET}`,
      POSTGREST_IMAGE,
    ]);
    const portOut = sh('docker', ['port', pgrestName, '3000/tcp']).trim(); // ej. "0.0.0.0:54321"
    const hostPort = portOut.split(':').pop();
    assert.ok(hostPort, `no se pudo leer el puerto publicado de PostgREST: "${portOut}"`);
    baseUrl = `http://127.0.0.1:${hostPort}`;
    await waitForHttp(baseUrl);

    const jwt = await new SignJWT({ role: DB_ROLE }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().sign(new TextEncoder().encode(JWT_SECRET));
    const realClient = new PostgrestClient(baseUrl, { headers: { Authorization: `Bearer ${jwt}` } });

    async function insertDevice(name: string): Promise<BalancerDeviceRow> {
      const id = randomUUID();
      const { error } = await realClient.from('mikrotik_devices').insert({
        id, name, host: '203.0.113.10', port: 443, use_tls: true,
        username: 'fake-user', password: 'fake-password', device_role: 'borde_balanceador', is_active: true,
      });
      assert.equal(error, null, `insert de dispositivo de prueba fallo: ${error?.message}`);
      return { id, name, host: '203.0.113.10', port: 443, use_tls: true, username: 'fake-user', password: 'fake-password' };
    }

    await t.test('primer ciclo: el upsert en lote escribe las mismas columnas/valores que la version anterior', async () => {
      const device = await insertDevice('balanceador-happy-path');
      const { db, calls } = createSpy(realClient as unknown as BalancerDbClient);
      const now = new Date('2026-11-18T12:00:00.000Z');
      await discoverAndSyncBalancerConnections(device, now, db, makeFetch());

      const { data: conns, error } = await realClient.from('mikrotik_balancer_connections').select('*').eq('device_id', device.id).order('pppoe_interface_name');
      assert.equal(error, null);
      assert.equal(conns?.length, 5, 'las 5 conexiones resueltas deben quedar como filas reales');
      const wan031 = conns!.find((c: any) => c.pppoe_interface_name === 'PPPoE-WAN031');
      assert.equal(wan031.macvlan_interface_name, 'MAC-PPPoE_031');
      assert.equal(wan031.physical_interface_name, 'sfp-sfpplus2');
      assert.equal(wan031.disabled, false);
      assert.equal(wan031.removed_at, null);

      const { data: samples } = await realClient.from('mikrotik_balancer_connection_samples').select('connection_id, rx_bytes, tx_bytes').eq('connection_id', wan031.id);
      assert.equal(samples?.length, 1, 'una sola muestra para esta conexion en este ciclo');
      // Primera muestra de la vida de esta conexion -- sin contador previo,
      // computeInterfaceDelta no inventa un delta (mismo comportamiento de
      // siempre, no cambia con esta correccion): el baseline recien se
      // establece, el delta real llega desde el SEGUNDO ciclo (ver prueba siguiente).
      assert.equal(samples![0].rx_bytes, 0);

      const { data: states } = await realClient.from('mikrotik_balancer_connection_counters_state').select('connection_id, last_rx_bytes').eq('connection_id', wan031.id);
      assert.equal(states?.length, 1);
      assert.equal(states![0].last_rx_bytes, 1000);

      assert.equal(calls.filter((c) => c.table === 'mikrotik_balancer_connections').length, 3, 'select existentes + upsert lote + select activas = 3 llamadas reales');
    });

    await t.test('segundo ciclo: el upsert con onConflict real ACTUALIZA, nunca duplica -- sigue habiendo 5 filas', async () => {
      const device = await insertDevice('balanceador-onconflict');
      const { db } = createSpy(realClient as unknown as BalancerDbClient);
      // `updated_at` de mikrotik_balancer_connection_counters_state lo pone
      // el TRIGGER real de Postgres con su propio now() de reloj -- para que
      // el intervalo que calcula discoverAndSyncBalancerConnections tenga
      // sentido contra ese dato real, aqui se usa tiempo real (con una
      // pausa real chica entre ciclos), no fechas simuladas como en las
      // pruebas con cliente falso.
      await discoverAndSyncBalancerConnections(device, new Date(), db, makeFetch(0));
      await new Promise((r) => setTimeout(r, 1200));
      await discoverAndSyncBalancerConnections(device, new Date(), db, makeFetch(500)); // mismo router, instante despues, contador avanzo

      const { data: conns, error } = await realClient.from('mikrotik_balancer_connections').select('id, pppoe_interface_name').eq('device_id', device.id);
      assert.equal(error, null);
      assert.equal(conns?.length, 5, 'el segundo ciclo debe ACTUALIZAR las mismas 5 filas, no crear 5 nuevas');

      const wan031 = conns!.find((c: any) => c.pppoe_interface_name === 'PPPoE-WAN031');
      assert.ok(wan031, 'PPPoE-WAN031 debe existir tras el segundo ciclo');
      const { data: samples } = await realClient.from('mikrotik_balancer_connection_samples').select('rx_bytes, interval_seconds').eq('connection_id', wan031.id).order('sampled_at');
      assert.equal(samples?.length, 2, 'cada ciclo agrega su propia muestra historica (nunca se pisa, a diferencia de la fila de conexion)');
      assert.equal(samples![1].rx_bytes, 500, 'el delta del segundo ciclo debe calcularse contra el contador previo real guardado por el primero (leido de Postgres real, no simulado)');
      assert.ok(samples![1].interval_seconds >= 1 && samples![1].interval_seconds <= 10, `intervalo real esperado ~1s, obtuvo ${samples![1].interval_seconds}s`);
    });

    await t.test('duplicado real: Postgres rechaza un upsert en lote con la misma clave repetida; la funcion real (con dedupe) no lo manda nunca', async () => {
      const device = await insertDevice('balanceador-duplicado');

      // 1) Se demuestra la falla REAL que justifica el dedupe: un upsert en
      // lote con la misma clave de conflicto 2 veces en la misma llamada.
      const { error: dupError } = await realClient.from('mikrotik_balancer_connections').upsert(
        [
          { device_id: device.id, pppoe_interface_name: 'PPPoE-WAN031', disabled: false, running: true, last_seen_at: new Date().toISOString(), removed_at: null },
          { device_id: device.id, pppoe_interface_name: 'PPPoE-WAN031', disabled: true, running: false, last_seen_at: new Date().toISOString(), removed_at: null },
        ],
        { onConflict: 'device_id,pppoe_interface_name' },
      );
      assert.ok(dupError, 'Postgres real debe rechazar la clave de conflicto repetida en el mismo lote');
      assert.match(dupError!.message, /affect row a second time|cannot affect row/i);

      // 2) La funcion real nunca llega a mandar ese upsert invalido: dedupea antes.
      const dupFetch = async <T>(_t: unknown, path: string): Promise<T> => {
        if (path === '/interface/macvlan') return [MACVLANS[0]] as unknown as T;
        if (path === '/interface/pppoe-client') return [
          { name: 'PPPoE-WAN031', interface: 'MAC-PPPoE_031', user: 'speedy', disabled: 'false', running: 'true' },
          { name: 'PPPoE-WAN031', interface: 'MAC-PPPoE_031', user: 'speedy', disabled: 'true', running: 'false' },
        ] as unknown as T;
        if (path === '/interface') return [] as unknown as T;
        throw new Error(`ruta no programada: ${path}`);
      };
      const { db } = createSpy(realClient as unknown as BalancerDbClient);
      await assert.doesNotReject(() => discoverAndSyncBalancerConnections(device, new Date(), db, dupFetch));

      const { data: conns } = await realClient.from('mikrotik_balancer_connections').select('disabled').eq('device_id', device.id);
      assert.equal(conns?.length, 1, 'debe quedar 1 sola fila (deduplicada), nunca el error de Postgres ni 2 filas');
      assert.equal(conns![0].disabled, true, 'prevalece la ultima aparicion, igual que el loop anterior en orden');
    });

    await t.test('fallo real de Postgres (violacion de FK): el mensaje de error es breve, identificable y no filtra credenciales', async () => {
      const bogusConnectionId = randomUUID();
      const { error } = await realClient.from('mikrotik_balancer_connection_samples').insert([
        { connection_id: bogusConnectionId, sampled_at: new Date().toISOString(), interval_seconds: 60, rx_bytes: 0, tx_bytes: 0, rx_bps: 0, tx_bps: 0, online: true },
      ]);
      assert.ok(error, 'una FK invalida debe fallar de verdad en Postgres real');
      assert.match(error!.message, /foreign key constraint|violates/i, 'el mensaje debe identificar claramente que es una violacion de FK');
      assert.ok(error!.message.length < 400, `el mensaje de Postgres no debe ser un volcado enorme (longitud real: ${error!.message.length})`);
      assert.doesNotMatch(error!.message, /fake-password|fake-user/i, 'el mensaje de error nunca debe incluir credenciales de dispositivos');
    });

    await t.test('lote de 1200 conexiones (> 500) se divide en varios chunks reales y las 1200 filas llegan completas', async () => {
      const device = await insertDevice('balanceador-escala-1200');
      const N = 1200;
      const macvlans: MacvlanRaw[] = Array.from({ length: N }, (_, i) => ({ name: `MAC-${i}`, interface: `sfp-${i}`, disabled: 'false', running: 'true' }));
      const pppoeClients: PppoeClientRaw[] = Array.from({ length: N }, (_, i) => ({ name: `PPPoE-WAN-${i}`, interface: `MAC-${i}`, user: 'speedy', disabled: 'false', running: 'true' }));
      const interfaceCounters = Array.from({ length: N }, (_, i) => ({ name: `PPPoE-WAN-${i}`, 'rx-byte': '100', 'tx-byte': '50' }));
      const bigFetch = async <T>(_t: unknown, path: string): Promise<T> => {
        if (path === '/interface/macvlan') return macvlans as unknown as T;
        if (path === '/interface/pppoe-client') return pppoeClients as unknown as T;
        if (path === '/interface') return interfaceCounters as unknown as T;
        throw new Error(`ruta no programada: ${path}`);
      };

      const { db, calls } = createSpy(realClient as unknown as BalancerDbClient);
      await discoverAndSyncBalancerConnections(device, new Date('2026-11-18T12:00:00.000Z'), db, bigFetch);

      const connectionUpsertCalls = calls.filter((c) => c.table === 'mikrotik_balancer_connections').length; // select + 3 chunks(500,500,200) + select = 5
      assert.equal(connectionUpsertCalls, 5, `1200 filas / 500 por chunk = 3 llamadas de upsert + 2 selects = 5 (real: ${connectionUpsertCalls})`);

      const { count: connCount } = await realClient.from('mikrotik_balancer_connections').select('id', { count: 'exact', head: true }).eq('device_id', device.id);
      assert.equal(connCount, N, 'las 1200 filas deben llegar completas a Postgres, repartidas en varios chunks');

      // Un .in() con 1200 ids por GET generaria una URL gigante (limite real
      // de PostgREST/HTTP) -- se cuenta por SQL directo contra el mismo
      // Postgres aislado, evitando ese limite ajeno a lo que se prueba aqui.
      const sampleCountOut = sh(
        'docker',
        ['exec', '-i', pgName, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'],
        `select count(*) from public.mikrotik_balancer_connection_samples s join public.mikrotik_balancer_connections c on c.id = s.connection_id where c.device_id = '${device.id}';`,
      ).trim();
      assert.equal(Number(sampleCountOut), N, 'las 1200 muestras tambien deben llegar completas');
    });

    // Fase 174c (18/11/2026, alternativa C): la capa de coordinacion bajo
    // demanda (mikrotikBalancerOnDemand.ts) tambien se valida contra
    // Postgres/PostgREST reales -- con latencia de red real, la ventana de
    // "algo ya esta en vuelo" importa mucho mas que contra el cliente falso.
    await t.test('bajo demanda contra Postgres/PostgREST reales: 2 solicitudes concurrentes comparten UN solo ciclo real', async () => {
      const { ensureFreshBalancerData, resetBalancerOnDemandStateForTests } = await import('../src/services/mikrotikBalancerOnDemand');
      resetBalancerOnDemandStateForTests();
      const device = await insertDevice('balanceador-ondemand-concurrencia');
      const { db, calls } = createSpy(realClient as unknown as BalancerDbClient);

      const fetchCalls = { count: 0 };
      const baseFetch = makeFetch();
      const countingFetch = async <T>(t: unknown, path: string): Promise<T> => {
        fetchCalls.count += 1;
        return baseFetch<T>(t, path);
      };

      await Promise.all([
        ensureFreshBalancerData(device, db, countingFetch, 0),
        ensureFreshBalancerData(device, db, countingFetch, 0),
      ]);

      assert.equal(fetchCalls.count, 3, 'las 2 solicitudes simultaneas deben compartir un unico ciclo real (3 llamadas al router, nunca 6)');
      const { data: conns } = await realClient.from('mikrotik_balancer_connections').select('id').eq('device_id', device.id);
      assert.equal(conns?.length, 5, 'el ciclo compartido debe haber escrito las 5 conexiones una sola vez (nunca duplicadas)');
    });

    await t.test('bajo demanda contra Postgres/PostgREST reales: la ventana de frescura evita un segundo ciclo real inmediato', async () => {
      const { ensureFreshBalancerData, resetBalancerOnDemandStateForTests } = await import('../src/services/mikrotikBalancerOnDemand');
      resetBalancerOnDemandStateForTests();
      const device = await insertDevice('balanceador-ondemand-frescura');
      const { db, calls } = createSpy(realClient as unknown as BalancerDbClient);

      await ensureFreshBalancerData(device, db, makeFetch(), 9999);
      const callsAfterFirst = calls.length;
      await ensureFreshBalancerData(device, db, makeFetch(), 9999);
      assert.equal(calls.length, callsAfterFirst, 'ninguna llamada real nueva a Supabase dentro de la ventana de frescura');
    });
  } finally {
    for (const name of [pgrestName, pgName]) {
      try { sh('docker', ['rm', '-f', name]); } catch { /* ya no existia */ }
    }
    try { sh('docker', ['network', 'rm', network]); } catch { /* ya no existia */ }
  }
});
