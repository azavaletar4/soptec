import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleMapTilesClient, googleNativeZoom, googleSessionOptions, googleTilesEnabled, normalizeGoogleViewport } from '../googleMapTiles';
const configuration = { key: 'synthetic-key', authorized: 'true' };
const view = { north: -8, south: -8.2, west: -79.2, east: -79, zoom: 17 };
const info = { copyright: 'SYNTHETIC attribution', maxZoomRects: [{ north: 90, south: -90, west: -180, east: 180, maxZoom: 19 }] };
const token = { session: 'synthetic-session', expiry: 7200, tileWidth: 256, tileHeight: 256 };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const signal = () => new AbortController().signal;
function fake(fn: (url: string, init?: RequestInit) => Promise<Response>) { return fn as typeof fetch; }

test('no key or authorization: no service request is sent', async () => {
  let calls = 0;
  for (const config of [{ key: '', authorized: 'true' }, { key: 'synthetic-key', authorized: '' }, { key: 'https://private.invalid', authorized: 'true' }]) {
    assert.equal(googleTilesEnabled(config), false);
    const client = new GoogleMapTilesClient(config, fake(async () => { calls++; return response(token); }));
    await assert.rejects(client.session('streets', signal()), /autorización/);
  }
  assert.equal(calls, 0);
});
test('official roadmap, satellite and blended hybrid session options', () => {
  assert.equal(googleSessionOptions('streets').mapType, 'roadmap');
  assert.equal(googleSessionOptions('satellite').mapType, 'satellite');
  assert.deepEqual(googleSessionOptions('hybrid').layerTypes, ['layerRoadmap']);
  assert.equal(googleSessionOptions('hybrid').overlay, false);
  assert.equal(googleSessionOptions('hybrid').language, 'es-419');
});
test('session reuse and renewal obey provider expiry, without persistent storage', async () => {
  let now = 0, calls = 0;
  const client = new GoogleMapTilesClient(configuration, fake(async () => { calls++; return response({ ...token, expiry: (now / 1000) + 7200 }); }), () => now);
  assert.deepEqual(await client.session('streets', signal()), await client.session('streets', signal()));
  assert.equal(calls, 1);
  now = 7200 * 1000;
  await client.session('streets', signal()); assert.equal(calls, 2);
  client.clear(); await client.session('streets', signal()); assert.equal(calls, 3);
});
test('official session endpoint/body and viewport-specific attribution precede tiles', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = new GoogleMapTilesClient(configuration, fake(async (url, init) => { calls.push({ url, init }); return response(url.includes('createSession') ? token : info); }), () => 0);
  const session = await client.session('hybrid', signal()); await client.viewport(session, view, signal());
  assert.equal(new URL(calls[0].url).origin, 'https://tile.googleapis.com');
  assert.equal(new URL(calls[0].url).pathname, '/v1/createSession');
  assert.equal(calls[0].init?.method, 'POST'); assert.equal(JSON.parse(calls[0].init?.body as string).overlay, false);
  const viewport = new URL(calls[1].url); assert.equal(viewport.pathname, '/tile/v1/viewport');
  for (const [k, v] of Object.entries(view)) assert.equal(viewport.searchParams.get(k), String(v));
  assert.equal(calls[0].init?.credentials, 'omit');
  assert.match(client.tileTemplate(session), /^https:\/\/tile.googleapis.com\/v1\/2dtiles\/\{z\}\/\{x\}\/\{y\}/);
});
test('invalid session response cannot produce imagery URLs', async () => {
  for (const invalid of [null, {}, { ...token, expiry: 0 }, { ...token, tileWidth: 512 }, { ...token, session: '' }]) {
    const client = new GoogleMapTilesClient(configuration, fake(async () => response(invalid)), () => 0);
    await assert.rejects(client.session('streets', signal()), /inválida/);
  }
});
test('missing copyright or coverage is rejected before displaying a tile layer', async () => {
  for (const invalid of [null, {}, { ...info, copyright: '' }, { ...info, maxZoomRects: [] }, { ...info, maxZoomRects: [{ maxZoom: NaN }] }]) {
    const client = new GoogleMapTilesClient(configuration, fake(async () => response(invalid)));
    await assert.rejects(client.viewport(token, view, signal()), /atribución/);
  }
});
test('native zoom honors declared coverage without changing map zoom', () => {
  assert.equal(googleNativeZoom(info, view), 19);
  assert.throws(() => googleNativeZoom({ ...info, maxZoomRects: [] }, view), /cobertura/);
});
test('errors never expose API keys, tokens or provider response bodies', async () => {
  const privateText = 'DO_NOT_LOG_KEY_OR_TOKEN';
  const client = new GoogleMapTilesClient({ key: privateText, authorized: 'true' }, fake(async () => new Response(privateText, { status: 403 })));
  await assert.rejects(client.session('streets', signal()), error => error instanceof Error && !error.message.includes(privateText) && /acceso, cuota/.test(error.message));
});
test('cancelled initialization sends no request', async () => {
  let calls = 0; const abort = new AbortController(); abort.abort();
  const client = new GoogleMapTilesClient(configuration, fake(async () => { calls++; return response(token); }));
  await assert.rejects(client.session('streets', abort.signal), { name: 'AbortError' }); assert.equal(calls, 0);
});
test('cancelled in-flight response never becomes a cached session', async () => {
  let calls = 0; const abort = new AbortController();
  const client = new GoogleMapTilesClient(configuration, fake(async () => { calls++; abort.abort(); return response(token); }), () => 0);
  await assert.rejects(client.session('streets', abort.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('world wrap and fractional zoom are normalized without altering editor geometry', () => {
  assert.deepEqual(normalizeGoogleViewport({ north: 90, south: -90, west: -200, east: 200, zoom: 17.2 }), { north: 85.05112878, south: -85.05112878, west: -180, east: 180, zoom: 17 });
  assert.equal(normalizeGoogleViewport({ ...view, west: 170, east: 190 }).east, -170);
});
