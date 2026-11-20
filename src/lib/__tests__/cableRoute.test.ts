import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FoCable, LatLngPoint } from '../../types/domain';
import { canEditCableRoute, cloneRoute, persistCableRoute, routeLocks, translateRoute, validateRoute, CableRouteConflictError } from '../cableRoute';
import { networkBasemap, satelliteConfigured } from '../mapBasemaps';
const cable = { id: 'synthetic', codigo: 'SYNTHETIC', path: [[-8, -79], [-8.01, -79.01], [-8.02, -79.02]], updated_at: '2026-11-20T10:00:00.123456Z', metraje: 500, hilos_total: 12, origen_infra_id: 'nap', destino_infra_id: 'mufa', origen_olt_id: null, destino_olt_id: null, map_removed_at: null } as FoCable;
const newPath: LatLngPoint[] = [[-8, -79], [-8.03, -79.01], [-8.02, -79.02]];
function transport(data: unknown, error: unknown = null) {
  const calls: [string, ...unknown[]][] = [];
  const chain = {
    update(payload: unknown) { calls.push(['update', payload]); return this; },
    eq(k: string, v: unknown) { calls.push(['eq', k, v]); return this; },
    is(k: string, v: unknown) { calls.push(['is', k, v]); return this; },
    select() { return this; }, async maybeSingle() { return { data, error }; },
  };
  const client = { from(table: string) { calls.push(['from', table]); return chain; } } as unknown as SupabaseClient;
  return { client, calls };
}
test('edits only path, preserves recorded length/identity, compares exact version and logical removal', async () => {
  const saved = { ...cable, path: newPath, updated_at: '2026-11-20T10:00:01.123456Z' };
  const t = transport(saved);
  assert.equal(await persistCableRoute(t.client, cable, newPath, 'ADMIN'), saved);
  assert.deepEqual(t.calls, [['from', 'fo_cables'], ['update', { path: newPath }], ['eq', 'id', cable.id], ['eq', 'updated_at', cable.updated_at], ['eq', 'path', JSON.stringify(cable.path)], ['is', 'map_removed_at', null]]);
  assert.equal(cable.metraje, 500); assert.deepEqual(cable.path, [[-8, -79], [-8.01, -79.01], [-8.02, -79.02]]);
});
test('concurrent edit or removal never triggers fallback/overwrite', async () => {
  const t = transport(null);
  await assert.rejects(persistCableRoute(t.client, cable, newPath, 'SUPERADMIN'), CableRouteConflictError);
  assert.equal(t.calls.filter(c => c[0] === 'update').length, 1);
});
test('fixed connected ends cannot be moved, including whole-route translation', async () => {
  const t = transport(null); const moved = translateRoute(cable.path, [0.001, 0.001]);
  await assert.rejects(persistCableRoute(t.client, cable, moved, 'ADMIN'), /extremos conectados/);
  assert.equal(t.calls.length, 0);
});
test('unconnected route can be translated without changing vertex count', () => {
  assert.deepEqual(routeLocks({ ...cable, origen_infra_id: null, destino_infra_id: null }), { start: false, end: false });
  const moved = translateRoute(cable.path, [0.001, 0.001]);
  assert.equal(moved.length, cable.path.length); assert.deepEqual(moved[0], [-7.999, -78.999]);
  const cloned = cloneRoute(cable.path); cloned[0][0] = 0; assert.equal(cable.path[0][0], -8);
});
test('invalid or collapsed geometry is rejected before any transport', async () => {
  for (const p of [[], [[0, 0]], [[0, 0], [0, 0]], [[91, 0], [0, 0]], [[0, 181], [0, 0]], [[NaN, 0], [0, 0]], [[1, 2, 3], [0, 0]]]) assert.throws(() => validateRoute(p));
  assert.throws(() => translateRoute([[89, 0], [89, 1]], [5, 0]));
});
test('unknown/null role and retired rows cannot write', async () => {
  const t = transport(null);
  for (const role of [null, '', 'GUEST', 'CLIENTE']) await assert.rejects(persistCableRoute(t.client, cable, newPath, role), /permiso/);
  await assert.rejects(persistCableRoute(t.client, { ...cable, map_removed_at: '2026-11-20T12:00:00Z' }, newPath, 'ADMIN'), /Recarga/);
  assert.equal(t.calls.length, 0);
  for (const r of ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION']) assert.equal(canEditCableRoute(r), true);
});
test('permission errors or unconfirmed server replies preserve caller draft', async () => {
  const error = new Error('RLS_DENIED'); const t = transport(null, error);
  await assert.rejects(persistCableRoute(t.client, cable, newPath, 'ADMIN'), /RLS_DENIED/);
  await assert.rejects(persistCableRoute(transport({ ...cable, path: cable.path }).client, cable, newPath, 'ADMIN'), /confirmar/);
  assert.deepEqual(newPath[1], [-8.03, -79.01]);
});
test('satellite requires both an account key and explicit license activation', () => {
  assert.equal(satelliteConfigured('', 'true'), false); assert.equal(satelliteConfigured('synthetic', ''), false);
  assert.throws(() => networkBasemap('satellite'), /proveedor/);
  assert.throws(() => networkBasemap('hybrid', 'synthetic', 'false'), /proveedor/);
  assert.throws(() => networkBasemap('hybrid', 'https://private.invalid', 'true'), /proveedor/);
});
test('official public endpoints and visible attributions, no dependency on a private tile server', () => {
  assert.equal(networkBasemap('streets').url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(networkBasemap('satellite', 'synthetic', 'true').url, /maps\/satellite-v4\/256\//);
  const hybrid = networkBasemap('hybrid', 'synthetic', 'true'); assert.match(hybrid.url, /hybrid-v4/); assert.match(hybrid.attribution, /MapTiler/); assert.match(hybrid.attribution, /OpenStreetMap/);
});
