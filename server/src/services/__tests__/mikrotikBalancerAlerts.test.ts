import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideWanLinkAlertTransition, wanLinkAlertKey } from '../../mikrotik/balancerAlerts';

test('decideWanLinkAlertTransition: "down" sin alerta activa -- dispara una nueva', () => {
  assert.deepEqual(decideWanLinkAlertTransition('down', false), { shouldFire: true, shouldResolve: false });
});

test('decideWanLinkAlertTransition: "down" con alerta YA activa -- nunca duplica', () => {
  assert.deepEqual(decideWanLinkAlertTransition('down', true), { shouldFire: false, shouldResolve: false });
});

test('decideWanLinkAlertTransition: "up" con alerta activa -- la resuelve (recuperada)', () => {
  assert.deepEqual(decideWanLinkAlertTransition('up', true), { shouldFire: false, shouldResolve: true });
});

test('decideWanLinkAlertTransition: "up" sin alerta activa -- no hace nada', () => {
  assert.deepEqual(decideWanLinkAlertTransition('up', false), { shouldFire: false, shouldResolve: false });
});

test('decideWanLinkAlertTransition: "disabled" NUNCA dispara, aunque no haya alerta activa (deshabilitada no es averia)', () => {
  assert.deepEqual(decideWanLinkAlertTransition('disabled', false), { shouldFire: false, shouldResolve: false });
});

test('decideWanLinkAlertTransition: "disabled" con una alerta de caida ya activa -- la resuelve (no se queda mostrando averia de algo deshabilitado a proposito)', () => {
  assert.deepEqual(decideWanLinkAlertTransition('disabled', true), { shouldFire: false, shouldResolve: true });
});

test('wanLinkAlertKey: combina kind+name de forma estable para indexar por enlace', () => {
  assert.equal(wanLinkAlertKey({ kind: 'pppoe_connection', name: 'PPPoE-WAN031' }), 'pppoe_connection:PPPoE-WAN031');
  assert.equal(wanLinkAlertKey({ kind: 'physical_port', name: 'sfp-sfpplus2' }), 'physical_port:sfp-sfpplus2');
});
