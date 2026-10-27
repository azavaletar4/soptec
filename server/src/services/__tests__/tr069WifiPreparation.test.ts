import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { prepareWifiSsid, readWifiInventory, WIFI_TEST_DEVICE, WIFI_TEST_SERIAL } from '../tr069WifiPreparation';
import { wifiPreparationRoutes } from '../../routes/tr069WifiPreparation';
import { tr069PreparationOnly } from '../../middleware/tr069PreparationOnly';
import { compareWifiPlan } from '../../../../src/lib/tr069WifiPlan';
import type { AuthUser } from '../../middleware/auth';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const path = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5';
const timestamp = '2026-10-27T19:45:10.554Z';
function device(serial = '485754431D3691B7', id = WIFI_TEST_DEVICE) {
  return { _id: id, _deviceId: { _SerialNumber: serial }, InternetGatewayDevice: { LANDevice: { 1: { WLANConfiguration: {
    1: { SSID: { _value: 'Red uno', _timestamp: timestamp, _writable: true }, KeyPassphrase: { _value: 'SYNTHETIC_SECRET' } },
    5: { SSID: { _value: 'Red cinco', _timestamp: timestamp, _writable: true } },
  } } } } };
}
function nbi(rows = [device()]) {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, 'GET', 'Ningún POST/refresh/tarea permitido');
    assert.ok(!String(url).includes('tasks'));
    calls.push(String(url));
    return Response.json(rows);
  };
  return calls;
}
const payload = () => ({ deviceId: WIFI_TEST_DEVICE, path, ssid: 'Red nueva', expectedSsid: 'Red cinco', expectedTimestamp: timestamp, confirmed: true });
function appFor(role?: AuthUser['role']) {
  const app = new Hono();
  app.use('*', async (c, next) => { if (role) c.set('user', { id: 'synthetic-user', role }); await next(); });
  app.route('/wifi', wifiPreparationRoutes);
  for (const route of ['/pppoe/:serial', '/provision/:serial', '/proxy/devices/:id/tasks']) app.post(route, tr069PreparationOnly);
  return app;
}

test('serial ASCII y hexadecimal identifican la misma ONT completa; Enable ausente conserva ambas redes sin secretos', async () => {
  const calls = nbi();
  const inventory = await readWifiInventory('http://nbi.invalid', WIFI_TEST_SERIAL);
  assert.equal(inventory.deviceId, WIFI_TEST_DEVICE);
  assert.deepEqual(inventory.networks.map(n => [n.ssid, n.enabled]), [['Red uno', null], ['Red cinco', null]]);
  assert.ok(!JSON.stringify(inventory).includes('SYNTHETIC_SECRET'));
  const query = JSON.parse(new URL(calls[0]).searchParams.get('query')!);
  assert.deepEqual(query['_deviceId._SerialNumber'].$in, [WIFI_TEST_SERIAL, '485754431D3691B7']);
  assert.equal((await readWifiInventory('http://nbi.invalid', '485754431D3691B7')).serial, WIFI_TEST_SERIAL);
});
test('serial inválido no consulta NBI', async () => {
  const calls = nbi(); await assert.rejects(readWifiInventory('http://nbi.invalid', '1D3691B7')); assert.equal(calls.length, 0);
});
test('rechaza coincidencia ambigua incluso entre representaciones equivalentes', async () => {
  nbi([device(), device(WIFI_TEST_SERIAL, 'otro-id')]);
  await assert.rejects(readWifiInventory('http://nbi.invalid', WIFI_TEST_SERIAL), /ambigua/);
});
test('no acepta respuesta NBI de otra ONT aunque el servidor ignore query', async () => {
  nbi([device('HWTC00000000', 'otro-id')]);
  assert.equal((await readWifiInventory('http://nbi.invalid', WIFI_TEST_SERIAL)).found, false);
  await assert.rejects(prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, payload()));
});
test('prepara solo la instancia elegida, respalda SSID anterior y no escribe', async () => {
  const calls = nbi();
  const plan = await prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, payload());
  assert.equal(plan.path, path); assert.equal(plan.before, 'Red cinco'); assert.equal(plan.after, 'Red nueva');
  assert.equal(plan.mode, 'preparation_only'); assert.equal(calls.length, 1);
});
test('rechaza otra ONT o id GenieACS cambiado', async () => {
  const calls = nbi();
  await assert.rejects(prepareWifiSsid('http://nbi.invalid', 'HWTC00000000', payload())); assert.equal(calls.length, 0);
  await assert.rejects(prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, { ...payload(), deviceId: 'otra-ont' }));
});
test('rechaza path inventado, WAN de gestión y otra instancia inexistente', async () => {
  nbi();
  for (const wrong of ['', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANIPConnection.1', path+'.SSID', path.replace('.5', '.9')]) {
    await assert.rejects(prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, { ...payload(), path: wrong }));
  }
});
test('rechaza cambio de caché posterior a la confirmación', async () => {
  nbi();
  for (const override of [{ expectedSsid: 'viejo' }, { expectedTimestamp: '2020-01-01' }, { confirmed: false }]) {
    await assert.rejects(prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, { ...payload(), ...override }));
  }
});
test('rechaza contraseñas/PPPoE, multibyte largo, controles, vacío y SSID sin cambio', async () => {
  nbi();
  for (const override of [{ password: 'synthetic' }, { pppoeUsername: 'synthetic' }, { ssid: '😀'.repeat(9) }, { ssid: 'a\nb' }, { ssid: ' ' }, { ssid: 'Red cinco' }]) {
    await assert.rejects(prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, { ...payload(), ...override }));
  }
});
test('red desactivada/no escribible se muestra, pero no se prepara; sin valor o fecha tampoco hay respaldo válido', async () => {
  for (const node of [
    { SSID: { _value: 'Red cinco', _timestamp: timestamp, _writable: false } },
    { SSID: { _value: 'Red cinco', _timestamp: timestamp }, Enable: { _value: false } },
    { SSID: { _timestamp: timestamp } },
    { SSID: { _value: 'Red cinco' } },
  ]) {
    const row = device();
    row.InternetGatewayDevice.LANDevice[1].WLANConfiguration[5] = node as typeof row.InternetGatewayDevice.LANDevice[1]['WLANConfiguration'][5];
    nbi([row]);
    assert.equal((await readWifiInventory('http://nbi.invalid', WIFI_TEST_SERIAL)).networks.length, 2);
    await assert.rejects(prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, payload()));
  }
});
for (const role of ['ADMIN', 'SUPERADMIN'] as const) test(`${role}: ruta real permite preparación, nunca escritura directa/PPPoE/provision/proxy`, async () => {
  nbi(); const app = appFor(role);
  assert.equal((await app.request('/wifi/'+WIFI_TEST_SERIAL+'/prepare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) })).status, 200);
  for (const route of ['/wifi/'+WIFI_TEST_SERIAL, '/pppoe/x', '/provision/x', '/proxy/devices/x/tasks']) {
    assert.equal((await app.request(route, { method: 'POST' })).status, 423);
  }
});
for (const role of ['TECNICO_RED', 'SOPORTE', 'CLIENTE', undefined] as const) test(`${role ?? 'sin identidad'}: requireRole real bloquea preparación y vías alternativas sin contactar NBI`, async () => {
  const calls = nbi(); const app = appFor(role);
  for (const route of ['/wifi/'+WIFI_TEST_SERIAL+'/prepare', '/wifi/x', '/pppoe/x', '/provision/x', '/proxy/devices/x/tasks']) {
    assert.equal((await app.request(route, { method: 'POST', body: '{}' })).status, 403);
  }
  assert.equal(calls.length, 0);
});
test('comparación posterior exige identidad, instancia y timestamp más nuevo; no confunde caché con aceptación física', async () => {
  nbi(); const plan = await prepareWifiSsid('http://nbi.invalid', WIFI_TEST_SERIAL, payload());
  const inv = await readWifiInventory('http://nbi.invalid', WIFI_TEST_SERIAL);
  assert.match(compareWifiPlan(plan, inv), /Sin evidencia/);
  assert.match(compareWifiPlan(plan, { ...inv, deviceId: 'otro' }), /Identidad distinta/);
  inv.networks.find(n => n.path === path)!.timestamp = new Date(Date.parse(plan.preparedAt)+1000).toISOString();
  inv.networks.find(n => n.path === path)!.ssid = plan.after;
  assert.match(compareWifiPlan(plan, inv), /falta confirmación/);
});

test('routers completos: JWT firmado y perfil ficticios, requireAuth/requireRole reales; proxy y PPPoE no pueden eludir bloqueo', async () => {
  globalThis.fetch = originalFetch;
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'wifi-fixture', alg: 'ES256', use: 'sig' };
  const roles: Record<string, string> = { admin: 'ADMIN', super: 'SUPERADMIN', tecnico: 'TECNICO_RED', soporte: 'SOPORTE' };
  let nbiGets = 0;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method !== 'GET') { res.statusCode = 500; res.end('{}'); return; }
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname === '/auth/v1/.well-known/jwks.json') { res.end(JSON.stringify({ keys: [jwk] })); return; }
    if (url.pathname === '/rest/v1/profiles') {
      const role = roles[(url.searchParams.get('id') ?? '').replace('eq.', '')];
      res.end(JSON.stringify([{ role, active: true }])); return;
    }
    if (url.pathname === '/devices/') { nbiGets++; res.end(JSON.stringify([device()])); return; }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const old = { url: process.env.VITE_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, nbi: process.env.GENIEACS_NBI };
  process.env.VITE_SUPABASE_URL = base; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-fixture-only'; process.env.GENIEACS_NBI = base;
  try {
    const { genieacsSyncRoutes } = await import('../../routes/genieacsSync');
    const { genieacsRoutes } = await import('../../routes/genieacs');
    const app = new Hono(); app.route('/api/genieacs-sync', genieacsSyncRoutes); app.route('/api/genieacs', genieacsRoutes);
    assert.equal((await app.request('/api/genieacs-sync/wifi/'+WIFI_TEST_SERIAL)).status, 401);
    for (const [id, role] of Object.entries(roles)) {
      const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'wifi-fixture' }).setSubject(id)
        .setIssuer(base+'/auth/v1').setAudience('authenticated').setExpirationTime('5m').sign(privateKey);
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const allowed = role === 'ADMIN' || role === 'SUPERADMIN';
      const before = nbiGets;
      const prepared = await app.request('/api/genieacs-sync/wifi/'+WIFI_TEST_SERIAL+'/prepare', { method: 'POST', headers, body: JSON.stringify(payload()) });
      assert.equal(prepared.status, allowed ? 200 : 403);
      assert.equal(nbiGets-before, allowed ? 1 : 0);
      for (const route of ['/api/genieacs-sync/wifi/'+WIFI_TEST_SERIAL, '/api/genieacs-sync/pppoe/x', '/api/genieacs-sync/provision/x', '/api/genieacs/devices/x/tasks']) {
        assert.equal((await app.request(route, { method: 'POST', headers, body: '{}' })).status, allowed ? 423 : 403);
      }
    }
  } finally {
    for (const [key, value] of Object.entries({ VITE_SUPABASE_URL: old.url, SUPABASE_SERVICE_ROLE_KEY: old.key, GENIEACS_NBI: old.nbi })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
