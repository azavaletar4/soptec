import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { aggregatePppoeProfiles, createDashboardPppoeReader, readPppoeAdminProfiles,
  PPPOE_ACTIVE_PATH, PPPOE_SECRET_PATH, PPPOE_RESOURCE_PATH, type PppoeAdminDevice } from '../dashboardPppoeProfiles';
import { createDashboardPppoeHandler } from '../dashboardPppoeHandler';
import { formatPppoeReading, PPPOE_DASHBOARD_PROFILES } from '../../../../src/lib/pppoeProfileCounts';
import type { AuthUser } from '../../middleware/auth';

const admin: PppoeAdminDevice = { id: 'admin', device_role: 'pppoe_admin', is_active: true,
  host: 'router.invalid', port: 443, use_tls: true, username: 'private-admin', password: 'private-password' };
const secret = (name: string, profile = 'Profile_Dedicado', extra = {}) => ({ '.id': name, name, profile, service: 'pppoe', ...extra });
const active = (name: string, extra = {}) => ({ name, service: 'pppoe', ...extra });
function fixture() {
  let now = Date.parse('2026-11-12T18:00:00Z');
  let secrets: unknown = [secret('private-customer')];
  let sessions: unknown = [active('private-customer')];
  let fail = false;
  let lookups = 0;
  const paths: string[] = [];
  const deps = {
    now: () => now,
    findAdmins: async () => { lookups++; return [admin]; },
    read: async (target: unknown, path: string) => {
      assert.equal((target as any).host, admin.host); paths.push(path);
      if (fail) throw Error('private-customer private-password connection failure');
      if (path === PPPOE_RESOURCE_PATH) return { 'board-name': 'CCR2116-12G-4S+' };
      if (path === PPPOE_SECRET_PATH) return secrets;
      if (path === PPPOE_ACTIVE_PATH) return sessions;
      throw Error('UNAUTHORIZED_ROUTER_READ');
    },
  };
  return { deps, paths, reader: createDashboardPppoeReader(deps),
    advance: (ms: number) => { now += ms; }, setFail: (value: boolean) => { fail = value; },
    replace: (nextSecrets: unknown, nextSessions: unknown) => { secrets = nextSecrets; sessions = nextSessions; },
    lookups: () => lookups };
}

test('perfiles exactos; secrets deshabilitados cuentan; Morosos y variantes excluidos', () => {
  const secrets = PPPOE_DASHBOARD_PROFILES.map((row, i) => secret(`user-${i}`, row.profile, { disabled: 'true' }));
  secrets.push(secret('moroso', 'Profile_Morosos'), secret('case', 'profile_dedicado'), secret('suffix', 'Profile_Dedicado_extra'));
  const result = aggregatePppoeProfiles(secrets, secrets.map(row => active(row.name)));
  assert.equal(result.profiles.length, 4);
  assert.deepEqual(result.profiles.map(row => [row.registered, row.connected]), [[1,1],[1,1],[1,1],[1,1]]);
  assert.doesNotMatch(JSON.stringify(result), /Morosos|moroso|password|user-/);
  assert.equal(result.partial, false);
});
test('conectados son usuarios PPPoE unicos; service any admitido; otras sesiones no cuentan', () => {
  const result = aggregatePppoeProfiles([secret('one', undefined, { service: 'any' }), secret('two')],
    [active('one'), active('one'), active('two', { service: 'pptp' })]);
  assert.equal(result.profiles[0]!.registered, 2); assert.equal(result.profiles[0]!.connected, 1);
});
test('secreto ausente, incompatible o ambiguo se identifica como lectura parcial sin inventar perfil', () => {
  const result = aggregatePppoeProfiles([secret('ambiguous'), secret('ambiguous', 'Profile_Gamer_04', { '.id': 'another' }),
    secret('incompatible', undefined, { service: 'pptp' })], [active('absent'), active('ambiguous'), active('incompatible')]);
  assert.equal(result.partial, true);
  assert.ok(result.profiles.every(row => row.connected === 0));
});
test('RADIUS no se asigna al perfil del secret local, incluso si hay otra sesion con el mismo nombre', () => {
  for (const radius of [true, 'true', 'yes']) {
    const result = aggregatePppoeProfiles([secret('radius')], [active('radius'), active('radius', { radius })]);
    assert.equal(result.partial, true); assert.equal(result.profiles[0]!.connected, 0);
  }
});
test('el mismo ID de secret no se duplica; respuestas contradictorias o malformadas no son un cero valido', () => {
  assert.equal(aggregatePppoeProfiles([secret('one'), secret('one')], []).profiles[0]!.registered, 1);
  assert.throws(() => aggregatePppoeProfiles([secret('one'), secret('two', undefined, { '.id': 'one' })], []));
  for (const value of [null, {}, [{ name: 'bad' }]]) assert.throws(() => aggregatePppoeProfiles(value, []));
  assert.throws(() => aggregatePppoeProfiles([], [{}]));
  assert.ok(aggregatePppoeProfiles([], []).profiles.every(row => row.registered === 0 && row.connected === 0));
});
test('TTL 60s; 25 solicitudes concurrentes comparten un lote; cache contiene solo agregados y se copia', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 25 }, () => f.reader()));
  assert.equal(f.lookups(), 1); assert.equal(f.paths.length, 3);
  assert.equal(results[0]!.status, 'fresh');
  assert.doesNotMatch(JSON.stringify(results), /private-|router.invalid|secret|password/);
  results[0]!.profiles[0]!.connected = 999;
  f.advance(59_999); assert.equal((await f.reader()).profiles[0]!.connected, 1);
  assert.equal(f.paths.length, 3);
  f.advance(1); await f.reader(); assert.equal(f.paths.length, 6); assert.equal(f.lookups(), 2);
});
test('una nueva lectura reemplaza todo; no acumula perfiles ni usuarios anteriores', async () => {
  const f = fixture(); const first = await f.reader();
  f.advance(60_000); f.replace([secret('new', 'Profile_Gamer_05')], [active('new')]);
  const next = await f.reader();
  assert.notEqual(next.lastSuccessAt, first.lastSuccessAt);
  assert.equal(next.profiles[0]!.connected, 0); assert.equal(next.profiles[3]!.connected, 1);
});
test('fallo conserva ultimo exito y timestamp; stale explicito; evita tormenta de reintentos y se recupera', async () => {
  const f = fixture(); const first = await f.reader();
  f.advance(60_000); f.setFail(true);
  const failed = await f.reader();
  assert.equal(failed.status, 'stale'); assert.equal(failed.lastSuccessAt, first.lastSuccessAt);
  assert.deepEqual(failed.profiles, first.profiles);
  assert.doesNotMatch(JSON.stringify(failed), /private-customer|private-password/);
  const attempts = f.paths.length;
  await Promise.all(Array.from({ length: 20 }, () => f.reader())); assert.equal(f.paths.length, attempts);
  f.advance(60_000); f.setFail(false);
  assert.equal((await f.reader()).status, 'fresh');
});
test('primer fallo o respuesta invalida: unavailable con null, no falsos ceros', async () => {
  for (const invalid of [false, true]) {
    const f = fixture();
    if (invalid) f.replace({ error: 'bad response' }, []); else f.setFail(true);
    const result = await f.reader();
    assert.equal(result.status, 'unavailable'); assert.equal(result.lastSuccessAt, null);
    assert.ok(result.profiles.every(row => row.registered === null && row.connected === null));
  }
});
test('ningun borde se consulta: rechaza administradores ausentes/multiples/inactivos o hardware distinto', async () => {
  for (const devices of [[], [admin, admin], [{ ...admin, device_role: 'borde_dedicado' }], [{ ...admin, is_active: false }]]) {
    let reads = 0;
    await assert.rejects(readPppoeAdminProfiles({ findAdmins: async () => devices, read: async () => { reads++; return []; } }));
    assert.equal(reads, 0);
  }
  const paths: string[] = [];
  await assert.rejects(readPppoeAdminProfiles({ findAdmins: async () => [admin], read: async (_, path) => { paths.push(path); return { 'board-name': 'CCR1036' }; } }));
  assert.deepEqual(paths, [PPPOE_RESOURCE_PATH]);
});
test('HTTP mantiene permisos dashboard, no-store; anonimo y otros roles no disparan lectura', async () => {
  for (const role of [null, 'CLIENTE', 'FACTURACION', 'ADMIN', 'SUPERADMIN', 'SOPORTE', 'TECNICO_RED'] as const) {
    const app = new Hono(); let calls = 0;
    app.use('*', async (c, next) => { if (role) c.set('user', { id: 'synthetic', role } as AuthUser); await next(); });
    const f = fixture();
    app.get('/', createDashboardPppoeHandler(async () => { calls++; return f.reader(); }));
    const response = await app.request('/');
    const permitted = role && !['CLIENTE', 'FACTURACION'].includes(role);
    assert.equal(response.status, permitted ? 200 : role ? 403 : 401);
    assert.equal(calls, permitted ? 1 : 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
test('ultima lectura se presenta en Peru, independientemente de la zona del navegador', () => {
  assert.match(formatPppoeReading('2026-11-12T18:04:05Z'), /12\/11\/2026.*13:04:05/);
  assert.equal(formatPppoeReading(null), 'Sin lectura exitosa');
});
