import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTr069EnableStatus, canManageTr069 } from '../tr069EnableStatus';

const NOW = Date.parse('2026-10-27T12:00:00Z');

test('solicitud en curso -> habilitando, sin importar el resto', () => {
  const s = deriveTr069EnableStatus({ tr069Enabled: false, requestInFlight: true, lastError: null, matchedDevice: null, nowMs: NOW });
  assert.equal(s, 'habilitando');
});

test('hay un error conocido -> error (y no se confunde con "no habilitado")', () => {
  const s = deriveTr069EnableStatus({ tr069Enabled: false, requestInFlight: false, lastError: 'Timeout OLT', matchedDevice: null, nowMs: NOW });
  assert.equal(s, 'error');
});

test('nunca se habilito -> no_habilitado', () => {
  const s = deriveTr069EnableStatus({ tr069Enabled: false, requestInFlight: false, lastError: null, matchedDevice: null, nowMs: NOW });
  assert.equal(s, 'no_habilitado');
});

test('habilitado pero sin ningun Inform todavia -> esperando_conexion', () => {
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: null, nowMs: NOW });
  assert.equal(s, 'esperando_conexion');
});

test('habilitado y con Inform reciente (5 min) -> conectado', () => {
  const lastSeen = new Date(NOW - 5 * 60 * 1000).toISOString();
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'HWTC1D3691B7', last_seen_at: lastSeen }, nowMs: NOW });
  assert.equal(s, 'conectado');
});

test('habilitado pero el ultimo Inform es viejo (mas de 30 min) -> vuelve a esperando_conexion, nunca se queda "conectado" para siempre', () => {
  const lastSeen = new Date(NOW - 45 * 60 * 1000).toISOString();
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'HWTC1D3691B7', last_seen_at: lastSeen }, nowMs: NOW });
  assert.equal(s, 'esperando_conexion');
});

test('canManageTr069: solo true cuando el estado es exactamente "conectado"', () => {
  assert.equal(canManageTr069('conectado'), true);
  assert.equal(canManageTr069('esperando_conexion'), false);
  assert.equal(canManageTr069('habilitando'), false);
  assert.equal(canManageTr069('error'), false);
  assert.equal(canManageTr069('no_habilitado'), false);
});
