import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStatusAlert, detectSignalAlert } from '../oltAlerts';

const THRESHOLD = -27;

test('caida: online -> offline (habilitada) dispara "offline"', () => {
  assert.equal(
    detectStatusAlert({ status: 'online', adminState: 'enable' }, { status: 'offline', adminState: 'enable' }),
    'offline',
  );
});

test('recuperacion: offline -> online dispara "recovered"', () => {
  assert.equal(
    detectStatusAlert({ status: 'offline', adminState: 'enable' }, { status: 'online', adminState: 'enable' }),
    'recovered',
  );
});

test('repeticion de ciclos: una vez persistido, el siguiente ciclo (sin cambio real) no vuelve a alertar', () => {
  // Ciclo 1: transicion real.
  assert.equal(detectStatusAlert({ status: 'online', adminState: 'enable' }, { status: 'offline', adminState: 'enable' }), 'offline');
  // Ciclo 2: "before" ya es 'offline' (lo que quedo persistido), "after" sigue 'offline' -> sin alerta nueva.
  assert.equal(detectStatusAlert({ status: 'offline', adminState: 'enable' }, { status: 'offline', adminState: 'enable' }), null);
});

test('primer ciclo sin referencia previa (status "unknown", fila recien creada): nunca alerta', () => {
  assert.equal(detectStatusAlert({ status: 'unknown', adminState: 'enable' }, { status: 'offline', adminState: 'enable' }), null);
  assert.equal(detectStatusAlert({ status: 'unknown', adminState: 'enable' }, { status: 'online', adminState: 'enable' }), null);
});

test('ONU deshabilitada administrativamente: nunca se confunde con una caida', () => {
  assert.equal(detectStatusAlert({ status: 'online', adminState: 'enable' }, { status: 'offline', adminState: 'disable' }), null);
});

test('sin cambio de estado: nunca alerta (online->online, offline->offline)', () => {
  assert.equal(detectStatusAlert({ status: 'online', adminState: 'enable' }, { status: 'online', adminState: 'enable' }), null);
  assert.equal(detectStatusAlert({ status: 'offline', adminState: 'enable' }, { status: 'offline', adminState: 'enable' }), null);
});

test('potencia baja: cruce de OK a bajo el umbral dispara "lowSignal"', () => {
  assert.equal(detectSignalAlert(-20, -30, THRESHOLD), 'lowSignal');
});

test('potencia baja: cruce de vuelta a OK dispara "signalRecovered"', () => {
  assert.equal(detectSignalAlert(-30, -20, THRESHOLD), 'signalRecovered');
});

test('sin referencia previa (ONT nueva, primera lectura): nunca alerta aunque ya nazca baja', () => {
  assert.equal(detectSignalAlert(null, -30, THRESHOLD), null);
});

test('error de lectura (afterRx undefined, puerto fallido o ciclo sin senal): nunca se interpreta como caida de senal', () => {
  assert.equal(detectSignalAlert(-20, undefined, THRESHOLD), null);
  assert.equal(detectSignalAlert(-30, undefined, THRESHOLD), null);
});

test('se mantiene baja (o se mantiene OK) sin cruzar: no repite la alerta', () => {
  assert.equal(detectSignalAlert(-30, -31, THRESHOLD), null);
  assert.equal(detectSignalAlert(-20, -21, THRESHOLD), null);
});
