import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMikrotikErrorMessage } from '../client';

// Fase 175 — diagnostico del HTTP 400 de /interface en trafficAnalyticsService.
// El bug real no era el router ni el endpoint: era que este cliente
// mostraba `message` (la frase generica del codigo HTTP) en vez de
// `detail` (la razon especifica) cuando RouterOS manda ambos — asi que
// cada 400 real se veia igual ("Bad Request") en los logs, sin forma de
// saber POR QUE. Confirmado contra el router real de produccion
// (Administrador 2116): {"detail":"no such command or directory
// (pppoe-in)","error":400,"message":"Bad Request"}.

test('extractMikrotikErrorMessage: con detail Y message, usa detail (la razon especifica, no la generica)', () => {
  const data = { detail: 'no such command or directory (pppoe-in)', error: 400, message: 'Bad Request' };
  assert.equal(extractMikrotikErrorMessage(data, 400), 'no such command or directory (pppoe-in)');
});

test('extractMikrotikErrorMessage: si solo viene message (sin detail), lo usa igual', () => {
  const data = { message: 'Unauthorized' };
  assert.equal(extractMikrotikErrorMessage(data, 401), 'Unauthorized');
});

test('extractMikrotikErrorMessage: si solo viene detail (sin message), lo usa', () => {
  const data = { detail: 'invalid value for argument type' };
  assert.equal(extractMikrotikErrorMessage(data, 400), 'invalid value for argument type');
});

test('extractMikrotikErrorMessage: sin detail ni message, cae al generico con el status', () => {
  assert.equal(extractMikrotikErrorMessage({ foo: 'bar' }, 500), 'MikroTik respondio 500');
  assert.equal(extractMikrotikErrorMessage(null, 503), 'MikroTik respondio 503');
  assert.equal(extractMikrotikErrorMessage('texto plano', 400), 'MikroTik respondio 400');
});
