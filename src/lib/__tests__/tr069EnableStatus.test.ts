import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTr069EnableStatus, canManageTr069, shouldKeepPollingTr069 } from '../tr069EnableStatus';

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

test('recien habilitado, sin ningun match todavia y dentro del margen de 10 min -> configurado', () => {
  const enabledAt = new Date(NOW - 2 * 60 * 1000).toISOString();
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: null, enabledAt, nowMs: NOW });
  assert.equal(s, 'configurado');
});

test('sin fecha de habilitacion conocida y sin match -> configurado por defecto (nunca se asume "mucho tiempo" sin el dato real)', () => {
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: null, nowMs: NOW });
  assert.equal(s, 'configurado');
});

test('habilitado hace mas de 10 min, sigue sin ningun match -> esperando_conexion', () => {
  const enabledAt = new Date(NOW - 11 * 60 * 1000).toISOString();
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: null, enabledAt, nowMs: NOW });
  assert.equal(s, 'esperando_conexion');
});

test('exactamente en el margen de 10 min todavia es "configurado"; un instante despues ya es "esperando_conexion"', () => {
  const justAt = new Date(NOW - 10 * 60 * 1000).toISOString();
  assert.equal(deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: null, enabledAt: justAt, nowMs: NOW }), 'configurado');
  const justAfter = new Date(NOW - 10 * 60 * 1000 - 1).toISOString();
  assert.equal(deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: null, enabledAt: justAfter, nowMs: NOW }), 'esperando_conexion');
});

test('habilitado y con Inform reciente (5 min), identidad exacta -> conectado a GenieACS', () => {
  const lastSeen = new Date(NOW - 5 * 60 * 1000).toISOString();
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'HWTC1D3691B7', last_seen_at: lastSeen }, nowMs: NOW });
  assert.equal(s, 'conectado');
});

test('hubo match antes pero el ultimo Inform es viejo (mas de 30 min) -> "sin_comunicacion_reciente", NUNCA "esperando_conexion" (son casos distintos: aqui SI hubo contacto real)', () => {
  const lastSeen = new Date(NOW - 45 * 60 * 1000).toISOString();
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'HWTC1D3691B7', last_seen_at: lastSeen }, nowMs: NOW });
  assert.equal(s, 'sin_comunicacion_reciente');
});

test('caso real reportado: GenieACS registro la Huawei una vez y luego se quedo en silencio — ya no se confunde con "nunca contacto"', () => {
  // Esta es exactamente la situacion real: hubo un match con last_seen_at
  // real, horas despues sigue sin cambiar. Antes de esta correccion esto
  // caia en el mismo "esperando_conexion" que un equipo que nunca contacto.
  const lastSeen = '2026-10-29T20:11:52.625Z';
  const laterNow = Date.parse('2026-10-29T22:57:00.000Z'); // ~2h45min despues
  const s = deriveTr069EnableStatus({
    tr069Enabled: true, requestInFlight: false, lastError: null,
    matchedDevice: { cpe_serial: '485754431D3691B7', last_seen_at: lastSeen },
    enabledAt: '2026-10-27T18:30:25.048Z', nowMs: laterNow,
  });
  assert.equal(s, 'sin_comunicacion_reciente');
  assert.notEqual(s, 'esperando_conexion', 'nunca se mezcla con el caso de "nunca contactó"');
});

test('limite exacto de 30 min: todavia conectado; un instante despues, sin_comunicacion_reciente', () => {
  const justAt = new Date(NOW - 30 * 60 * 1000).toISOString();
  assert.equal(deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'x', last_seen_at: justAt }, nowMs: NOW }), 'conectado');
  const justAfter = new Date(NOW - 30 * 60 * 1000 - 1).toISOString();
  assert.equal(deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'x', last_seen_at: justAfter }, nowMs: NOW }), 'sin_comunicacion_reciente');
});

test('umbrales configurables explícitamente (staleAfterMs / firstContactGraceMs), sin depender solo de los valores por defecto', () => {
  const lastSeen = new Date(NOW - 2 * 60 * 1000).toISOString();
  assert.equal(deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'x', last_seen_at: lastSeen }, nowMs: NOW, staleAfterMs: 60_000 }), 'sin_comunicacion_reciente');
  const enabledAt = new Date(NOW - 2 * 60 * 1000).toISOString();
  assert.equal(deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: null, enabledAt, nowMs: NOW, firstContactGraceMs: 60_000 }), 'esperando_conexion');
});

test('fecha de Inform invalida en el match se trata como ausencia de confirmacion util, nunca como "conectado"', () => {
  const s = deriveTr069EnableStatus({ tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'x', last_seen_at: 'no-es-una-fecha' }, nowMs: NOW });
  assert.notEqual(s, 'conectado');
});

test('canManageTr069: solo true cuando el estado es exactamente "conectado" — ni siquiera con un contacto viejo', () => {
  assert.equal(canManageTr069('conectado'), true);
  assert.equal(canManageTr069('configurado'), false);
  assert.equal(canManageTr069('esperando_conexion'), false);
  assert.equal(canManageTr069('sin_comunicacion_reciente'), false);
  assert.equal(canManageTr069('habilitando'), false);
  assert.equal(canManageTr069('error'), false);
  assert.equal(canManageTr069('no_habilitado'), false);
});

test('shouldKeepPollingTr069: sigue comprobando mientras no hubo contacto o se está habilitando; deja de sondear si ya hubo contacto (reciente o viejo), error o nunca habilitado', () => {
  assert.equal(shouldKeepPollingTr069('habilitando'), true);
  assert.equal(shouldKeepPollingTr069('configurado'), true);
  assert.equal(shouldKeepPollingTr069('esperando_conexion'), true);
  assert.equal(shouldKeepPollingTr069('conectado'), false);
  assert.equal(shouldKeepPollingTr069('sin_comunicacion_reciente'), false, 'ya tuvo su oportunidad; no se sondea solo por abrir la ficha');
  assert.equal(shouldKeepPollingTr069('error'), false);
  assert.equal(shouldKeepPollingTr069('no_habilitado'), false);
});

// Esta máquina de estados nunca recibe ni consulta tareas pendientes de
// GenieACS (eso es un concepto de Hosts, archivo distinto) — se prueba
// explícitamente que un "match" con last_seen_at reciente siempre resuelve
// a "conectado" basándose solo en identidad + fecha, nunca en si hay o no
// alguna tarea en cola (que ni siquiera es un campo de este input).
test('la derivación nunca depende de tareas pendientes de GenieACS (no es un campo de este input) — solo identidad y fechas reales', () => {
  const lastSeen = new Date(NOW - 1000).toISOString();
  const input = { tr069Enabled: true, requestInFlight: false, lastError: null, matchedDevice: { cpe_serial: 'x', last_seen_at: lastSeen }, nowMs: NOW };
  assert.ok(!('pendingTasks' in input));
  assert.equal(deriveTr069EnableStatus(input), 'conectado');
});
