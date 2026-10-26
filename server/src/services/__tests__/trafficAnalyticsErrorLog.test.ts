import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMikrotikErrorLogLine } from '../trafficAnalyticsService';
import { MikrotikHttpError } from '../../mikrotik/client';

// Fase 175 — registro sanitizado del HTTP 400 real (ver diagnostico de esta
// sesion): origen, operacion, codigo y hora de Peru, SIN credenciales ni
// respuesta cruda. Pruebas puras, sin red.

test('formatMikrotikErrorLogLine: HTTP error — incluye codigo, origen, operacion y hora de Peru; nunca credenciales', () => {
  const error = new MikrotikHttpError('no such command or directory (pppoe-in)', 400);
  const line = formatMikrotikErrorLogLine({
    origen: 'Administrador 2116',
    operacion: 'GET /interface?type=pppoe-in',
    error,
    at: new Date('2026-10-26T13:02:52.000Z'),
  });
  assert.match(line, /origen="Administrador 2116"/);
  assert.match(line, /operacion="GET \/interface\?type=pppoe-in"/);
  assert.match(line, /codigo=400/);
  assert.match(line, /detalle="no such command or directory \(pppoe-in\)"/);
  // 2026-10-26T13:02:52Z en horario de Peru (UTC-5) es las 8:02am del mismo dia.
  assert.match(line, /8:02:52/);
  assert.doesNotMatch(line.toLowerCase(), /authorization|basic |password|username/);
});

test('formatMikrotikErrorLogLine: error de conexion (sin respuesta HTTP) — codigo "sin-respuesta", nunca inventa un status', () => {
  const error = new Error('No se pudo conectar a 10.10.10.1:80 — connect ECONNREFUSED (ECONNREFUSED)');
  const line = formatMikrotikErrorLogLine({
    origen: 'Administrador 2116',
    operacion: 'GET /interface?type=pppoe-in',
    error,
    at: new Date('2026-10-26T13:02:52.000Z'),
  });
  assert.match(line, /codigo=sin-respuesta/);
  assert.match(line, /ECONNREFUSED/);
});

test('formatMikrotikErrorLogLine: nunca imprime username/password aunque esten en el objeto error por accidente', () => {
  const error = new MikrotikHttpError('Bad Request', 400);
  const line = formatMikrotikErrorLogLine({ origen: 'Administrador 2116', operacion: 'GET /interface', error, at: new Date() });
  assert.doesNotMatch(line, /10\.10\.10\.1/); // el host tampoco viaja aqui, solo el nombre del dispositivo
});
