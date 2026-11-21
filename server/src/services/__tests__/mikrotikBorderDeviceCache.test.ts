import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfiguredBorderDevices, invalidateConfiguredBorderDevicesCache } from '../mikrotikBorderTrafficService';

// Diagnostico de consumo de logs de Supabase (21/11/2026): esta cache evito
// ~17.900 solicitudes/dia a /rest/v1/mikrotik_devices (la mayor fuente
// individual de ingesta de logs del proyecto, confirmada via logs de la
// API) -- el scheduler de borde consultaba esa tabla sin cache en CADA
// ciclo de 5s. Ver el comentario junto a getConfiguredBorderDevices en
// mikrotikBorderTrafficService.ts para la evidencia completa.

function fakeDb(rows: unknown[]) {
  let calls = 0;
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: async () => {
              calls++;
              return { data: rows, error: null };
            },
          }),
        }),
      }),
    }),
  };
  return { db: db as never, getCalls: () => calls };
}

test('primera llamada consulta Supabase; llamadas repetidas dentro del TTL reusan la cache sin volver a consultar', async () => {
  invalidateConfiguredBorderDevicesCache();
  const { db, getCalls } = fakeDb([{ id: 'r1', host: '10.0.0.1' }]);
  const first = await getConfiguredBorderDevices(db);
  const second = await getConfiguredBorderDevices(db);
  const third = await getConfiguredBorderDevices(db);
  assert.equal(getCalls(), 1, 'solo la primera llamada debe tocar Supabase');
  assert.deepEqual(first, [{ id: 'r1', host: '10.0.0.1' }]);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test('invalidateConfiguredBorderDevicesCache fuerza una relectura real en la siguiente llamada (alta/edicion/baja de un router)', async () => {
  invalidateConfiguredBorderDevicesCache();
  const { db: dbOld, getCalls: callsOld } = fakeDb([{ id: 'r1', host: '10.0.0.1' }]);
  await getConfiguredBorderDevices(dbOld);
  assert.equal(callsOld(), 1);

  invalidateConfiguredBorderDevicesCache();
  const { db: dbNew, getCalls: callsNew } = fakeDb([{ id: 'r2', host: '10.0.0.2' }]);
  const afterInvalidate = await getConfiguredBorderDevices(dbNew);
  assert.equal(callsNew(), 1, 'tras invalidar, la siguiente llamada SI debe consultar de nuevo');
  assert.deepEqual(afterInvalidate, [{ id: 'r2', host: '10.0.0.2' }]);
});
