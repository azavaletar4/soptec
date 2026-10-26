import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../trafficAnalyticsService';

// Fase 175 — withTimeout es el guardia nuevo de sampleTrafficUsage(): sin
// el, una llamada a Supabase que se cuelga (sin AbortSignal propio, a
// diferencia de mikrotikRequest) deja `running` en true para siempre en
// trafficAnalyticsScheduler.ts — exactamente el patron que explica el
// corte real de muestras del 2026-10-15 (ver migracion/diagnostico de esta
// sesion). Estas pruebas son puras, sin red ni Postgres.

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

test('withTimeout: si la promesa original resuelve antes del limite, devuelve su valor', async () => {
  const fast = Promise.resolve('ok');
  const result = await withTimeout(fast, 1000, 'no deberia dispararse');
  assert.equal(result, 'ok');
});

test('withTimeout: si la promesa original rechaza antes del limite, propaga ese error (no el del timeout)', async () => {
  const failing = Promise.reject(new Error('fallo real'));
  await assert.rejects(() => withTimeout(failing, 1000, 'no deberia dispararse'), /fallo real/);
});

test('withTimeout: si la promesa original nunca resuelve, se interrumpe con el mensaje de timeout en vez de colgarse para siempre', async () => {
  await assert.rejects(() => withTimeout(neverResolves(), 50, 'se colgó la conexión'), /se colgó la conexión/);
});

test('withTimeout: una promesa colgada que rechaza DESPUES del timeout no genera un unhandled rejection', async () => {
  let rejectLate: (e: Error) => void = () => {};
  const late = new Promise<string>((_resolve, reject) => {
    rejectLate = reject;
  });
  await assert.rejects(() => withTimeout(late, 20, 'timeout'), /timeout/);
  // La promesa original rechaza DESPUES de que withTimeout ya resolvio por
  // el otro lado — withTimeout le agrega un catch vacio, asi que esto no
  // debe hacer explotar el proceso de pruebas.
  rejectLate(new Error('llego tarde'));
  await new Promise((resolve) => setTimeout(resolve, 20));
});
